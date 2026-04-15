import type { Renderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSXElement } from "solid-js";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { DETAIL_PANEL_WIDTH_FRACTION, isUncommittedHash, UNCOMMITTED_PLACEHOLDER } from "../constants";
import { useAppState } from "../context/state";
import type { Commit, GraphRow } from "../git/types";
import { useBannerScroll } from "../hooks/use-banner-scroll";
import { useClipboard } from "../hooks/use-clipboard";
import { type CopyableField, useDetailCursor } from "../hooks/use-detail-cursor";
import { useStashState } from "../hooks/use-stash-state";
import { useT } from "../hooks/use-t";
import { ActionsDetailTab } from "../providers/github-actions/detail-tab";
import { formatDate } from "../utils/date";
import { isCursored as _isCursored, itemHighlightBg as _itemHighlightBg } from "../utils/detail-cursor";
import Badge from "./badge";
import type { DetailNavRef, DetailViewProps } from "./detail-types";
import {
  BADGE_PADDING,
  DIR_INDICATOR_WIDTH,
  ENTRY_PADDING_LEFT,
  HASH_BADGE_GAP,
  PANEL_PADDING_X,
  SHORT_HASH_LEN,
  STAT_GAP,
  STAT_PADDING_LEFT,
  STATUS_COL_WIDTH,
} from "./detail-types";
import FileListView from "./file-list-view";
import type { StashFileRowData } from "./stash-entry";
import { StashEntry } from "./stash-entry";

// ── Layout constants ────────────────────────────────────────────────
/** Minimum panel width in characters before padding is subtracted. */
const MIN_PANEL_WIDTH = 60;

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
  const panelUsableWidth = () =>
    Math.max(Math.floor(dimensions().width * DETAIL_PANEL_WIDTH_FRACTION), MIN_PANEL_WIDTH) - PANEL_PADDING_X;

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

  // Active tab for committed commits: "detail" | "files" | "stashes"
  const activeTab = () => state.detailActiveTab();

  // Split refs into branches (branch/remote/head) and tags
  const branchRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter(r => r.type !== "tag");
  };

  const tagRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter(r => r.type === "tag");
  };

  // The node color index for this commit's lane
  const nodeColorIndex = () => row()?.nodeColor ?? 0;

  // For non-tip commits: find the remote counterpart of branchName
  const remoteName = () => {
    const bn = row()?.branchName;
    if (!bn) return null;
    const remote = state.branches().find(b => b.isRemote && b.name.endsWith(`/${bn}`));
    return remote?.name ?? null;
  };

  /**
   * Look up upstream tracking info for a local branch name.
   * Returns null when the branch has no upstream configured.
   */
  const branchTracking = (name: string) => {
    const b = state.branches().find(br => !br.isRemote && br.name === name);
    if (!b?.upstream) return null;
    return { upstream: b.upstream, ahead: b.ahead ?? 0, behind: b.behind ?? 0 };
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
  const { interactiveItems, findItemIndex } = useDetailCursor({
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

    const item = items[idx];
    const pw = panelUsableWidth();

    switch (item.type) {
      case "section-header":
        return null; // short text, no scroll needed

      case "child":
      case "parent": {
        // Layout: paddingLeft + hash(7) + gap(1) + ` name ` badge
        const r = row();
        const entryBranch =
          item.type === "child" ? (r?.childBranches[item.index] ?? "") : (r?.parentBranches[item.index] ?? "");
        let name = entryBranch;
        if (name === "") {
          const tag = getTagForHash(item.hash);
          name = tag ?? "deleted";
        }
        const available = pw - ENTRY_PADDING_LEFT - SHORT_HASH_LEN - HASH_BADGE_GAP - BADGE_PADDING;
        if (name.length <= available) return null;
        return { text: name, visibleWidth: available };
      }

      case "stash-entry": {
        // Header shows only label + optional " (N)" file count suffix.
        // The label is the scrollable part; file count is short and appended outside scroll.
        const stash = stashEntries()[item.stashIndex];
        if (!stash) return null;
        const label = stash.refs[0]?.name ?? "stash";
        const indicatorWidth = 2; // "▸ " or "▾ "
        const available = pw - indicatorWidth;
        if (label.length <= available) return null;
        return { text: label, visibleWidth: available };
      }

      case "stash-dir": {
        // Layout: prefix + connector + dirIndicator + name
        const rows = getStashFileTreeRows(item.stashHash);
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fixedChars = treeRow.prefix.length + treeRow.connector.length + DIR_INDICATOR_WIDTH;
        const available = pw - fixedChars;
        if (treeRow.name.length <= available) return null;
        return { text: treeRow.name, visibleWidth: available };
      }

      case "stash-file": {
        // Layout: prefix + connector + name + stat columns
        const rows = getStashFileTreeRows(item.stashHash);
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fw = getStashFileWidths(item.stashHash);
        const statWidth = STAT_PADDING_LEFT + STATUS_COL_WIDTH + STAT_GAP + fw.addColWidth + STAT_GAP + fw.delColWidth;
        const fixedChars = treeRow.prefix.length + treeRow.connector.length + statWidth;
        const available = pw - fixedChars;
        if (treeRow.name.length <= available) return null;
        return { text: treeRow.name, visibleWidth: available };
      }

      case "copyable": {
        // Body uses wrapMode="word", no banner scroll
        if (item.field === "body") return null;
        const text = getCopyableText(item.field);
        const available = pw;
        if (text.length <= available) return null;
        return { text, visibleWidth: available };
      }
    }
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

  /** Highlight background for a copyable field row. */
  const copyableHighlightBg = (field: CopyableField): string | undefined => itemHighlightBg(copyableIdx(field));

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

  /**
   * Local component: renders a single copyable row with cursor highlight,
   * banner-scroll, and "✓ copied" feedback badge.
   *
   * Closes over: copyableHighlightBg, isCopyableCursored, scrolledCopyableText,
   * copiedField, t().
   */
  const CopyableRow = (rowProps: {
    field: CopyableField;
    /** Fallback content shown when not banner-scrolling. */
    children: JSXElement;
    /** Text color when not cursored. Defaults to t().foreground. */
    fg?: string;
    /** wrapMode for the text element. Defaults to "none". */
    wrapMode?: "none" | "char" | "word";
    /** Optional ref callback forwarded to the outer box for scroll-into-view. */
    ref?: (el: Renderable) => void;
  }) => (
    <box ref={rowProps.ref} flexDirection="row" backgroundColor={copyableHighlightBg(rowProps.field)}>
      <text
        flexGrow={1}
        flexShrink={1}
        fg={isCopyableCursored(rowProps.field) ? t().accent : (rowProps.fg ?? t().foreground)}
        wrapMode={rowProps.wrapMode ?? "none"}
        truncate={rowProps.wrapMode !== "word" && !isCopyableCursored(rowProps.field)}
      >
        {scrolledCopyableText(rowProps.field) ?? rowProps.children}
      </text>
      <Show when={copiedField() === rowProps.field}>
        <text flexShrink={0} bg={t().primary} fg={t().background} wrapMode="none">
          {" \u2713 copied "}
        </text>
      </Show>
    </box>
  );

  /** Render a collapsible section header with interactive highlight */
  function InteractiveSectionHeader(
    headerProps: Readonly<{
      title: string;
      count: number;
      expanded: boolean;
      section: "children" | "parents";
      ref?: (el: Renderable) => void;
    }>,
  ) {
    const itemIdx = () => findItemIndex("section-header", headerProps.section);

    return (
      <box ref={headerProps.ref} backgroundColor={itemHighlightBg(itemIdx())}>
        <text fg={t().accent} wrapMode="none">
          <strong>
            {headerProps.expanded ? "▾" : "▸"} {headerProps.title} ({headerProps.count})
          </strong>
        </text>
      </box>
    );
  }

  /** Render a child/parent entry row with interactive highlight */
  function InteractiveCommitEntry(
    entryProps: Readonly<{
      hash: string;
      entryIndex: number;
      type: "child" | "parent";
      branchName: string;
      colorIndex: number;
      ref?: (el: Renderable) => void;
    }>,
  ) {
    const itemIdx = () => findItemIndex(entryProps.type, undefined, entryProps.entryIndex);
    const cursored = () => isCursored(itemIdx());

    const tag = () => getTagForHash(entryProps.hash);

    /** Resolved badge name for this entry */
    const badgeName = () => {
      if (entryProps.branchName !== "") return entryProps.branchName;
      return tag() ?? "deleted";
    };

    /** Banner scroll props: only applied to the badge of the cursored entry */
    const badgeScrollProps = () => {
      if (!cursored()) return {};
      const info = cursoredTextInfo();
      if (!info || info.text !== badgeName()) return {};
      return { visibleWidth: info.visibleWidth, bannerOffset: bannerOffset() };
    };

    return (
      <box
        ref={entryProps.ref}
        flexDirection="row"
        flexWrap="wrap"
        gap={1}
        paddingLeft={2}
        backgroundColor={itemHighlightBg(itemIdx())}
      >
        <text fg={cursored() ? t().accent : t().foreground} wrapMode="none">
          {entryProps.hash.substring(0, SHORT_HASH_LEN)}
        </text>
        <Show
          when={entryProps.branchName !== ""}
          fallback={
            <Show when={tag()} fallback={<Badge name="deleted" colorIndex={0} dimmed />}>
              <Badge name={tag() as string} colorIndex={entryProps.colorIndex} {...badgeScrollProps()} />
            </Show>
          }
        >
          <Badge name={entryProps.branchName} colorIndex={entryProps.colorIndex} {...badgeScrollProps()} />
        </Show>
      </box>
    );
  }

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
            {/* ══════════════ Detail tab ══════════════ */}
            <Show when={activeTab() === "detail"}>
              {/* ── Branch ── */}
              <text fg={t().accent} wrapMode="none">
                <strong>Branch</strong>
              </text>
              <box flexDirection="column">
                <Show
                  when={branchRefs().length > 0}
                  fallback={
                    <Show
                      when={(row()?.branchName ?? "") !== ""}
                      fallback={(() => {
                        const tag = getTagForHash(c().hash);
                        return tag ? (
                          <Badge
                            name={tag}
                            colorIndex={nodeColorIndex()}
                            visibleWidth={panelUsableWidth() - BADGE_PADDING}
                          />
                        ) : (
                          <Badge name="deleted" colorIndex={0} dimmed />
                        );
                      })()}
                    >
                      {/* Graph-inferred branch: local badge, optional remote badge, right-aligned tracking */}
                      <box flexDirection="row" width="100%">
                        <Badge
                          name={r().branchName}
                          colorIndex={nodeColorIndex()}
                          visibleWidth={panelUsableWidth() - BADGE_PADDING}
                        />
                        {(() => {
                          const tr = branchTracking(r().branchName);
                          if (!tr) {
                            // No tracking — show remote badge if present
                            const rn = remoteName();
                            return rn ? (
                              <Badge
                                name={rn}
                                colorIndex={nodeColorIndex()}
                                visibleWidth={panelUsableWidth() - BADGE_PADDING}
                              />
                            ) : null;
                          }
                          return (
                            <>
                              <box flexGrow={1} />
                              <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                {`↑${tr.ahead} ↓${tr.behind}`}
                              </text>
                            </>
                          );
                        })()}
                      </box>
                    </Show>
                  }
                >
                  {/* Sort: locals first, remotes after */}
                  <For
                    each={[
                      ...branchRefs().filter(r => r.type !== "remote"),
                      ...branchRefs().filter(r => r.type === "remote"),
                    ]}
                  >
                    {ref => {
                      const tr = ref.type === "branch" ? branchTracking(ref.name) : null;
                      return (
                        <box flexDirection="row" width="100%">
                          <Badge
                            name={ref.name}
                            colorIndex={nodeColorIndex()}
                            dimmed={ref.type === "stash" || ref.type === "uncommitted"}
                            visibleWidth={panelUsableWidth() - BADGE_PADDING}
                          />
                          {tr ? (
                            <>
                              <box flexGrow={1} />
                              <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                {`↑${tr.ahead} ↓${tr.behind}`}
                              </text>
                            </>
                          ) : null}
                        </box>
                      );
                    }}
                  </For>
                </Show>
              </box>
              <box height={1} />

              {/* ── Tags ── */}
              <Show when={tagRefs().length > 0}>
                <text fg={t().accent} wrapMode="none">
                  <strong>Tags</strong>
                </text>
                <box flexDirection="row" flexWrap="wrap" gap={1}>
                  <For each={tagRefs()}>
                    {ref => (
                      <Badge
                        name={ref.name}
                        colorIndex={nodeColorIndex()}
                        visibleWidth={panelUsableWidth() - BADGE_PADDING}
                      />
                    )}
                  </For>
                </box>
                <box height={1} />
              </Show>

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

            {/* ══════════════ Actions tab ══════════════ */}
            <Show
              when={activeTab() === "github-actions" && !!props.githubGetCommitData && !!props.githubFetchJobsForRun}
            >
              <ActionsDetailTab
                sha={c().hash}
                // biome-ignore lint/style/noNonNullAssertion: guarded by Show when condition above
                getCommitData={props.githubGetCommitData!}
                // biome-ignore lint/style/noNonNullAssertion: guarded by Show when condition above
                fetchJobsForRun={props.githubFetchJobsForRun!}
                unavailableReason={props.githubProviderStatus !== "loading" ? props.githubProviderStatus : null}
                loading={props.githubProviderStatus === "loading"}
              />
            </Show>
          </>
        )}
      </Show>
    </box>
  );
}
