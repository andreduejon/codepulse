import { MouseButton, type MouseEvent, type Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { isUncommittedHash, UNCOMMITTED_PLACEHOLDER } from "../constants";
import { useAppState } from "../context/state";
import type { Commit, GraphRow } from "../git/types";
import { useBannerScroll } from "../hooks/use-banner-scroll";
import { useClipboard } from "../hooks/use-clipboard";
import { type CopyableField, useDetailCursor } from "../hooks/use-detail-cursor";
import { useStashState } from "../hooks/use-stash-state";
import { useT } from "../hooks/use-t";
import { formatDate } from "../utils/date";
import { isCursored as _isCursored, itemHighlightBg as _itemHighlightBg } from "../utils/detail-cursor";
import { ProviderDetailTabs } from "./detail-provider-tabs";
import { DetailRefs } from "./detail-refs";
import { CopyableRow, type DetailRowsView, InteractiveCommitEntry, InteractiveSectionHeader } from "./detail-rows";
import { cursoredItemText } from "./detail-scroll";
import type { DetailNavRef, DetailViewProps } from "./detail-types";
import { detailUsableWidth } from "./detail-types";
import FileListView from "./file-list-view";
import type { StashFileRowData } from "./stash-entry";
import { StashEntry } from "./stash-entry";

export default function CommitDetailView(props: Readonly<DetailViewProps>) {
  const { state, actions } = useAppState();
  const t = useT();
  const dimensions = useTerminalDimensions();

  const commit = () => state.selectedCommit();
  const detail = () => state.commitDetail();
  const row = () => state.selectedRow();
  /** Non-null row accessor — safe inside <Show when={commit()}>
   *  since selectedRow and selectedCommit are derived from the same index. */
  // biome-ignore lint/style/noNonNullAssertion: safe inside <Show when={commit()}> guard
  const r = (): GraphRow => row()!;

  // Hash → Commit lookup for tag fallback on parent/child badges
  const commitMap = createMemo(() => {
    const map = new Map<string, Commit>();
    for (const r of state.graphRows()) {
      map.set(r.commit.hash, r.commit);
    }
    return map;
  });

  /** Get the first tag name for a commit hash, or null if none */
  const getTagForHash = (hash: string): string | null => {
    const c = commitMap().get(hash);
    if (!c) return null;
    const tag = c.refs.find(r => r.type === "tag");
    return tag?.name ?? null;
  };

  // ── Cursor-aware banner scroll for long text ──────────────────────
  // Only the currently-cursored item scrolls when its text overflows.
  const panelUsableWidth = () => detailUsableWidth(props.contentWidth, dimensions().width);

  // Collapsible section state — reset to expanded when commit changes
  const [childrenExpanded, setChildrenExpanded] = createSignal(true);
  const [parentsExpanded, setParentsExpanded] = createSignal(true);

  createEffect(() => {
    // Reset collapse state when selected commit changes
    commit();
    row();
    setChildrenExpanded(true);
    setParentsExpanded(true);
  });

  /** Children excluding the synthetic uncommitted node (shown in graph, not in detail). */
  const filteredChildren = createMemo(() => {
    const gr = row();
    if (!gr) return [];
    return gr.children
      .map((hash, i) => ({
        hash,
        branch: gr.childBranches[i],
        color: gr.childColors[i],
      }))
      .filter(c => !isUncommittedHash(c.hash));
  });

  // Active tab for committed commits: "info" | "files" | "stashes"
  const activeTab = () => state.detailActiveTab();
  /** Provider tab state across tab switches (a mutable ref per key; this view outlives its tabs). */
  const providerMemory = new Map<string, unknown>();
  const memory = <T,>(key: string, create: () => T): T => {
    if (!providerMemory.has(key)) providerMemory.set(key, create());
    return providerMemory.get(key) as T;
  };

  // Whether to show committer info (only when different from author)
  const showCommitter = () => {
    const c = commit();
    if (!c) return false;
    return c.committer !== c.author || c.committerEmail !== c.authorEmail;
  };

  // Whether the selected commit is the synthetic uncommitted-changes node
  const isUncommitted = () => isUncommittedHash(commit()?.hash ?? "");

  // ── Clipboard copy with "✓ copied" feedback ────────────────────────
  const { copiedId: copiedField, copyToClipboard } = useClipboard<CopyableField>();

  /** Get the text to copy for a given copyable field. */
  const getCopyableText = (field: CopyableField): string => {
    const c = commit();
    if (!c) return "";
    switch (field) {
      case "hash":
        return c.hash;
      case "author":
        return `${c.author} <${c.authorEmail}>`;
      case "date":
        return formatDate(c.authorDate);
      case "committer":
        return `${c.committer} <${c.committerEmail}>`;
      case "commitDate":
        return formatDate(c.commitDate);
      case "subject":
        return c.subject;
      case "body":
        return detail()?.body ?? "";
    }
  };

  // ── Stash section state ─────────────────────────────────────────────
  const {
    stashEntries,
    expandedStashes,
    stashFileCache,
    stashCollapsedDirs,
    toggleStash,
    toggleStashDir,
    getStashFileTreeRows,
    getStashFileWidths,
  } = useStashState(commit);

  // Element refs for each interactive item, indexed by flat item position.
  // Populated via ref callbacks on each rendered interactive item, used by
  // use-keyboard-navigation to call scrollElementIntoView after cursor moves.
  const itemRefs: Renderable[] = [];

  // ── Cursor management (delegated to useDetailCursor) ─────────────────
  // IMPORTANT: useDetailCursor must be called AFTER all the state it depends on
  // (stashEntries, expandedStashes, getStashFileTreeRows, etc.) is initialized,
  // because it contains createMemo calls that evaluate eagerly.
  const { interactiveItems, findItemIndex, activateCurrentItem } = useDetailCursor({
    state,
    actions,
    navRef: props.navRef,
    itemRefs,
    row,
    commit,
    detail,
    activeTab,
    filteredChildren,
    childrenExpanded,
    parentsExpanded,
    stashEntries,
    expandedStashes,
    stashFileCache,
    stashCollapsedDirs,
    getStashFileTreeRows,
    toggleStash,
    toggleStashDir,
    setChildrenExpanded,
    setParentsExpanded,
    copyToClipboard,
    getCopyableText,
    onJumpToCommit: props.onJumpToCommit,
    onOpenDiff: props.onOpenDiff,
  });

  // Track interactive item indices for each rendered section/entry
  // These are derived from the interactiveItems memo

  // ── Cursor-aware banner scroll (deferred part) ────────────────────
  // Must be defined after interactiveItems and stash state.

  /** Compute the visible width and text for the currently-cursored item.
   *  Returns null if the item doesn't need scrolling (section-header or text fits). */
  const cursoredTextInfo = createMemo((): { text: string; visibleWidth: number } | null => {
    if (!state.detailFocused()) return null;
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (idx < 0 || idx >= items.length) return null;
    return cursoredItemText(items[idx], panelUsableWidth(), {
      row: row(),
      getTagForHash,
      stashLabel: index => {
        const stash = stashEntries()[index];
        return stash ? (stash.refs[0]?.name ?? "stash") : null;
      },
      stashTreeRows: getStashFileTreeRows,
      stashFileWidths: getStashFileWidths,
      copyableText: getCopyableText,
    });
  });

  // Drive banner scroll via shared hook — overflow is derived from cursoredTextInfo
  const bannerOverflow = createMemo(() => {
    const info = cursoredTextInfo();
    if (!info) return 0;
    return Math.max(0, info.text.length - info.visibleWidth);
  });
  const bannerOffset = useBannerScroll(bannerOverflow);

  // Highlight helpers — thin wrappers binding local state/theme
  const itemHighlightBg = (itemIndex: number) => _itemHighlightBg(state, t(), itemIndex);
  const isCursored = (itemIndex: number) => _isCursored(state, itemIndex);

  // ── Copyable field rendering helpers ────────────────────────────────
  /** Get the interactive item index for a copyable field. */
  const copyableIdx = (field: CopyableField) => findItemIndex("copyable", field);

  /** Whether a copyable field is the currently-cursored item. */
  const isCopyableCursored = (field: CopyableField) => isCursored(copyableIdx(field));

  const activateMouseItem = (event: MouseEvent, itemIndex: number) => {
    if (!props.mouseEnabled || event.button !== MouseButton.LEFT || itemIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    props.onMouseFocus?.();
    actions.setDetailCursorIndex(itemIndex);
    activateCurrentItem();
  };

  /** Banner-scrolled text for a copyable field (or null if not scrolling). */
  const scrolledCopyableText = (field: CopyableField): string | null => {
    if (!isCopyableCursored(field)) return null;
    const info = cursoredTextInfo();
    if (!info) return null;
    const text = getCopyableText(field);
    if (info.text !== text) return null;
    const off = bannerOffset();
    return text.substring(off, off + info.visibleWidth);
  };

  const rowsView: DetailRowsView = {
    mouseEnabled: () => props.mouseEnabled,
    findItemIndex,
    isCursored,
    highlightBg: itemHighlightBg,
    activate: activateMouseItem,
    copiedField,
    scrolledCopyableText,
    bannerScroll: text => {
      const info = cursoredTextInfo();
      return info && info.text === text ? { visibleWidth: info.visibleWidth, bannerOffset: bannerOffset() } : null;
    },
    getTagForHash,
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show
        when={commit()}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={t().foregroundMuted}>No commit selected</text>
          </box>
        }
      >
        {c => (
          <>
            {/* ══════════════ Info tab ══════════════ */}
            <Show when={activeTab() === "info"}>
              <DetailRefs commit={c()} row={r()} panelWidth={panelUsableWidth()} getTagForHash={getTagForHash} />

              {/* ── Metadata block (subheaders with copyable values) ── */}
              <text fg={t().accent} wrapMode="none">
                <strong>Commit</strong>
              </text>
              <Show
                when={!isUncommitted()}
                fallback={
                  <text fg={t().foregroundMuted} wrapMode="none">
                    {UNCOMMITTED_PLACEHOLDER}
                  </text>
                }
              >
                <CopyableRow
                  view={rowsView}
                  field="hash"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("copyable", "hash")] = el;
                  }}
                >
                  {c().hash}
                </CopyableRow>
              </Show>

              <box height={1} />
              <text fg={t().accent} wrapMode="none">
                <strong>Author</strong>
              </text>
              <Show
                when={!isUncommitted()}
                fallback={
                  <text fg={t().foregroundMuted} wrapMode="none">
                    {UNCOMMITTED_PLACEHOLDER}
                  </text>
                }
              >
                <CopyableRow
                  view={rowsView}
                  field="author"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("copyable", "author")] = el;
                  }}
                >
                  {c().author} {"<"}
                  {c().authorEmail}
                  {">"}
                </CopyableRow>
              </Show>

              <box height={1} />
              <text fg={t().accent} wrapMode="none">
                <strong>Date</strong>
              </text>
              <Show
                when={!isUncommitted()}
                fallback={
                  <text fg={t().foregroundMuted} wrapMode="none">
                    {UNCOMMITTED_PLACEHOLDER}
                  </text>
                }
              >
                <CopyableRow
                  view={rowsView}
                  field="date"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("copyable", "date")] = el;
                  }}
                >
                  {formatDate(c().authorDate)}
                </CopyableRow>
              </Show>

              <Show when={!isUncommitted() && showCommitter()}>
                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Committer</strong>
                </text>
                <CopyableRow
                  view={rowsView}
                  field="committer"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("copyable", "committer")] = el;
                  }}
                >
                  {c().committer} {"<"}
                  {c().committerEmail}
                  {">"}
                </CopyableRow>

                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Commit Date</strong>
                </text>
                <CopyableRow
                  view={rowsView}
                  field="commitDate"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("copyable", "commitDate")] = el;
                  }}
                >
                  {formatDate(c().commitDate)}
                </CopyableRow>
              </Show>

              <box height={1} />

              {/* ── Subject + Body ── */}
              <text fg={t().accent} wrapMode="none">
                <strong>Subject</strong>
              </text>
              <Show
                when={!isUncommitted()}
                fallback={
                  <text fg={t().foregroundMuted} wrapMode="word">
                    Staged and unstaged changes in working tree
                  </text>
                }
              >
                <CopyableRow
                  view={rowsView}
                  field="subject"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("copyable", "subject")] = el;
                  }}
                >
                  {c().subject}
                </CopyableRow>
              </Show>

              <Show when={!isUncommitted() && detail()?.body}>
                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Body</strong>
                </text>
                <CopyableRow
                  view={rowsView}
                  field="body"
                  fg={t().foregroundMuted}
                  wrapMode="word"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("copyable", "body")] = el;
                  }}
                >
                  {detail()?.body}
                </CopyableRow>
              </Show>

              <box height={1} />

              {/* ── Children (collapsible) ── */}
              <Show when={filteredChildren().length > 0}>
                <InteractiveSectionHeader
                  view={rowsView}
                  title="Children"
                  count={filteredChildren().length}
                  expanded={childrenExpanded()}
                  section="children"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("section-header", "children")] = el;
                  }}
                />
                <Show when={childrenExpanded()}>
                  <For each={filteredChildren()}>
                    {(child, i) => (
                      <InteractiveCommitEntry
                        view={rowsView}
                        hash={child.hash}
                        entryIndex={i()}
                        type="child"
                        branchName={child.branch}
                        colorIndex={child.color}
                        ref={(el: Renderable) => {
                          itemRefs[findItemIndex("child", undefined, i())] = el;
                        }}
                      />
                    )}
                  </For>
                </Show>
                <box height={1} />
              </Show>

              {/* ── Parents (collapsible) ── */}
              <Show when={r().parentHashes.length > 0}>
                <InteractiveSectionHeader
                  view={rowsView}
                  title="Parents"
                  count={r().parentHashes.length}
                  expanded={parentsExpanded()}
                  section="parents"
                  ref={(el: Renderable) => {
                    itemRefs[findItemIndex("section-header", "parents")] = el;
                  }}
                />
                <Show when={parentsExpanded()}>
                  <For each={r().parentHashes}>
                    {(parentHash, i) => (
                      <InteractiveCommitEntry
                        view={rowsView}
                        hash={parentHash}
                        entryIndex={i()}
                        type="parent"
                        branchName={r().parentBranches[i()]}
                        colorIndex={r().parentColors[i()]}
                        ref={(el: Renderable) => {
                          itemRefs[findItemIndex("parent", undefined, i())] = el;
                        }}
                      />
                    )}
                  </For>
                </Show>
                <box height={1} />
              </Show>
            </Show>

            {/* ══════════════ Files tab ══════════════ */}
            <Show when={activeTab() === "files"}>
              <FileListView
                contentWidth={props.contentWidth}
                mouseEnabled={props.mouseEnabled}
                onMouseFocus={props.onMouseFocus}
                files={() => detail()?.files ?? []}
                loading={() => state.detailLoading()}
                commitHash={() => commit()?.hash ?? ""}
                diffSource={() => "commit"}
                resetTrigger={commit}
                navRef={props.navRef as DetailNavRef}
                onOpenDiff={props.onOpenDiff}
              />
            </Show>

            {/* ══════════════ Stashes tab ══════════════ */}
            <Show when={activeTab() === "stashes"}>
              <For each={stashEntries()}>
                {(stash, si) => {
                  const itemIdx = () => findItemIndex("stash-entry", stash.hash);
                  const cursored = () => isCursored(itemIdx());
                  const expanded = () => expandedStashes().has(stash.hash);
                  const label = () => stash.refs[0]?.name ?? "stash";

                  /** Banner scroll for the stash header label when cursored */
                  const scrolledHeaderText = () => {
                    if (!cursored()) return null;
                    const info = cursoredTextInfo();
                    if (!info) return null;
                    const headerLabel = label();
                    if (info.text !== headerLabel) return null;
                    const off = bannerOffset();
                    return headerLabel.substring(off, off + info.visibleWidth);
                  };

                  const stashFileRows = () => getStashFileTreeRows(stash.hash);
                  const stashFw = () => getStashFileWidths(stash.hash);

                  /** Pre-compute per-file row display data for StashEntry */
                  const fileRowsData = (): StashFileRowData[] =>
                    stashFileRows().map((treeRow, fi) => {
                      const fileItemIdx = findItemIndex(treeRow.isDir ? "stash-dir" : "stash-file", stash.hash, fi);
                      const fileCursored = isCursored(fileItemIdx);
                      const fileCollapsed =
                        treeRow.isDir && (stashCollapsedDirs().get(stash.hash)?.has(treeRow.dirPath) ?? false);
                      const scrolledFileName = (): string | null => {
                        if (!fileCursored) return null;
                        const info = cursoredTextInfo();
                        if (!info || info.text !== treeRow.name) return null;
                        const off = bannerOffset();
                        return treeRow.name.substring(off, off + info.visibleWidth);
                      };
                      return {
                        row: treeRow,
                        itemIndex: fileItemIdx,
                        cursored: fileCursored,
                        collapsed: fileCollapsed,
                        highlightBg: itemHighlightBg(fileItemIdx),
                        scrolledName: scrolledFileName(),
                        ref: (el: Renderable) => {
                          itemRefs[fileItemIdx] = el;
                        },
                      };
                    });

                  return (
                    <StashEntry
                      mouseEnabled={props.mouseEnabled}
                      headerItemIndex={itemIdx()}
                      onActivate={index => {
                        if (!props.mouseEnabled || index < 0) return;
                        props.onMouseFocus?.();
                        actions.setDetailCursorIndex(index);
                        activateCurrentItem();
                      }}
                      stash={stash}
                      showSpacer={si() > 0}
                      expanded={expanded()}
                      headerHighlightBg={itemHighlightBg(itemIdx())}
                      scrolledHeaderText={scrolledHeaderText()}
                      fileRows={fileRowsData()}
                      fileCount={stashFileCache().get(stash.hash)?.length}
                      addColWidth={stashFw().addColWidth}
                      delColWidth={stashFw().delColWidth}
                      totalAdd={stashFw().totalAdd}
                      totalDel={stashFw().totalDel}
                      headerRef={(el: Renderable) => {
                        itemRefs[itemIdx()] = el;
                      }}
                    />
                  );
                }}
              </For>

              {/* Show "no stashes" message when stash tab is empty */}
              <Show when={stashEntries().length === 0}>
                <box flexGrow={1} alignItems="center" justifyContent="center">
                  <text fg={t().foregroundMuted}>No stashes on this commit</text>
                </box>
              </Show>
            </Show>

            {/* ══════════════ Provider tabs ══════════════ */}
            <ProviderDetailTabs view={props} sha={c().hash} memory={memory} />
          </>
        )}
      </Show>
    </box>
  );
}
