import { useTerminalDimensions } from "@opentui/solid";
import type { JSXElement } from "solid-js";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { DETAIL_PANEL_WIDTH_FRACTION, isUncommittedHash, UNCOMMITTED_PLACEHOLDER } from "../constants";
import { useAppState } from "../context/state";
import type { Commit, GraphRow } from "../git/types";
import { useBannerScroll } from "../hooks/use-banner-scroll";
import { useClipboard } from "../hooks/use-clipboard";
import { useFileTree } from "../hooks/use-file-tree";
import { useStashState } from "../hooks/use-stash-state";
import { useT } from "../hooks/use-t";
import { formatDate } from "../utils/date";
import { isCursored as _isCursored, itemHighlightBg as _itemHighlightBg } from "../utils/detail-cursor";
import { buildDiffTarget } from "../utils/diff-target";
import DetailBadge from "./detail-badge";
import type { DetailViewProps } from "./detail-types";
import {
  BADGE_PADDING,
  computeFileWidths,
  DIR_INDICATOR_WIDTH,
  ENTRY_PADDING_LEFT,
  HASH_BADGE_GAP,
  PANEL_PADDING_X,
  SHORT_HASH_LEN,
  STAT_GAP,
  STAT_PADDING_LEFT,
  STATUS_COL_WIDTH,
} from "./detail-types";
import { FileTreeEntry } from "./file-tree-entry";
import type { StashFileRowData } from "./stash-entry";
import { StashEntry } from "./stash-entry";
import { TotalLinesChangedRow } from "./total-lines-changed-row";

// ── Layout constants ────────────────────────────────────────────────
/** Minimum panel width in characters before padding is subtracted. */
const MIN_PANEL_WIDTH = 60;

/** Types for interactive items in the detail panel */
type CopyableField = "hash" | "author" | "date" | "committer" | "commitDate" | "subject" | "body";

type InteractiveItem =
  | { type: "section-header"; section: "children" | "parents" }
  | { type: "copyable"; field: CopyableField }
  | { type: "child"; hash: string; index: number }
  | { type: "parent"; hash: string; index: number }
  | { type: "file-dir"; dirPath: string; index: number }
  | { type: "file"; filePath: string; index: number }
  | { type: "stash-entry"; stashHash: string; stashIndex: number }
  | { type: "stash-dir"; stashHash: string; dirPath: string; index: number }
  | { type: "stash-file"; stashHash: string; filePath: string; index: number };

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

  // Column widths for file changes — derived from totals (always >= per-file values)
  const fileWidths = createMemo(() => {
    const d = detail();
    if (!d) return { totalAdd: 0, totalDel: 0, addColWidth: 2, delColWidth: 2 };
    return computeFileWidths(d.files);
  });

  // File tree state — resets collapsed dirs when commit changes
  const {
    fileTree: _fileTree,
    fileTreeRows,
    collapsedDirs,
    toggleDir,
  } = useFileTree(() => detail()?.files ?? [], commit);

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

  // ── Build flat list of interactive items (tab-aware) ──
  // IMPORTANT: This memo must be defined AFTER fileTreeRows, stashEntries,
  // expandedStashes, getStashFileTreeRows, collapsedDirs, and stashCollapsedDirs
  // because createMemo evaluates eagerly (unlike createEffect).
  // Moving it earlier causes a TDZ crash.
  const interactiveItems = createMemo((): InteractiveItem[] => {
    const r = row();
    const c = commit();
    if (!r || !c) return [];

    const tab = activeTab();
    const items: InteractiveItem[] = [];

    if (tab === "detail") {
      // Copyable metadata fields (skip for uncommitted node — values are all "·······")
      if (!isUncommittedHash(c.hash)) {
        items.push({ type: "copyable", field: "hash" });
        items.push({ type: "copyable", field: "author" });
        items.push({ type: "copyable", field: "date" });
        if (c.committer !== c.author || c.committerEmail !== c.authorEmail) {
          items.push({ type: "copyable", field: "committer" });
          items.push({ type: "copyable", field: "commitDate" });
        }
        items.push({ type: "copyable", field: "subject" });
        const d = detail();
        if (d?.body) {
          items.push({ type: "copyable", field: "body" });
        }
      }

      // Children section (only if children exist; excludes synthetic uncommitted node)
      const fc = filteredChildren();
      if (fc.length > 0) {
        items.push({ type: "section-header", section: "children" });
        if (childrenExpanded()) {
          for (let i = 0; i < fc.length; i++) {
            items.push({ type: "child", hash: fc[i].hash, index: i });
          }
        }
      }

      // Parents section (only if parents exist)
      if (r.parentHashes.length > 0) {
        items.push({ type: "section-header", section: "parents" });
        if (parentsExpanded()) {
          for (let i = 0; i < r.parentHashes.length; i++) {
            items.push({ type: "parent", hash: r.parentHashes[i], index: i });
          }
        }
      }
    } else if (tab === "files") {
      // Files tab: file tree items directly (no section header)
      const d = detail();
      if (d && d.files.length > 0) {
        const rows = fileTreeRows();
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.isDir) {
            items.push({ type: "file-dir", dirPath: row.dirPath, index: i });
          } else {
            items.push({ type: "file", filePath: row.file?.path, index: i });
          }
        }
      }
    } else if (tab === "stashes") {
      // Stash entries (each stash is its own collapsible header)
      const stashes = stashEntries();
      if (stashes.length > 0) {
        for (let si = 0; si < stashes.length; si++) {
          const stash = stashes[si];
          items.push({
            type: "stash-entry",
            stashHash: stash.hash,
            stashIndex: si,
          });

          // If this stash is expanded, add its file tree items
          if (expandedStashes().has(stash.hash)) {
            const rows = getStashFileTreeRows(stash.hash);
            for (let fi = 0; fi < rows.length; fi++) {
              const row = rows[fi];
              if (row.isDir) {
                items.push({
                  type: "stash-dir",
                  stashHash: stash.hash,
                  dirPath: row.dirPath,
                  index: fi,
                });
              } else {
                items.push({
                  type: "stash-file",
                  stashHash: stash.hash,
                  filePath: row.file?.path,
                  index: fi,
                });
              }
            }
          }
        }
      }
    }

    return items;
  });

  // Clamp cursor when interactive items change, and position cursor after jump
  createEffect(() => {
    const items = interactiveItems();
    const count = items.length;

    // If we navigated via child/parent jump, position cursor on the matching entry.
    // pendingJumpDirection is a mutable ref set by handleJumpToCommit. Unlike a signal,
    // it persists across multiple interactiveItems recomputations — so even if this
    // effect fires multiple times (e.g., once when commit changes, again when commitDetail
    // is cleared to null), it consistently re-positions the cursor on the target entry.
    // The ref is only cleared on the next non-jump navigation (in the app.tsx commit-change effect).
    const jumpDir = props.navRef?.pendingJumpDirection;
    if (jumpDir && count > 0) {
      // When jumping from a parent entry → continue walking parents (first parent)
      // When jumping from a child entry → continue walking children (first child)
      const targetType = jumpDir === "parent" ? "parent" : "child";
      for (let i = 0; i < items.length; i++) {
        if (items[i].type === targetType) {
          actions.setDetailCursorIndex(i);
          return;
        }
      }
      // Fallback: try the other type
      const fallbackType = targetType === "parent" ? "child" : "parent";
      for (let i = 0; i < items.length; i++) {
        if (items[i].type === fallbackType) {
          actions.setDetailCursorIndex(i);
          return;
        }
      }
      // No parent/child entries — fall back to first item
      actions.setDetailCursorIndex(0);
      return;
    }

    // Normal clamping: keep cursor in bounds when items change (e.g., section collapse)
    const cursor = state.detailCursorIndex();
    if (count === 0) {
      actions.setDetailCursorIndex(0);
    } else if (cursor >= count) {
      actions.setDetailCursorIndex(count - 1);
    }
  });

  /** Execute the action for the currently-cursor'd item */
  const activateItem = (item: InteractiveItem) => {
    switch (item.type) {
      case "section-header":
        if (item.section === "children") setChildrenExpanded(!childrenExpanded());
        else if (item.section === "parents") setParentsExpanded(!parentsExpanded());
        break;
      case "copyable":
        copyToClipboard(getCopyableText(item.field), item.field);
        break;
      case "child":
      case "parent":
        if (props.onJumpToCommit) props.onJumpToCommit(item.hash, item.type);
        break;
      case "file-dir":
        toggleDir(item.dirPath);
        break;
      case "file":
        if (props.onOpenDiff && item.filePath) {
          const c = commit();
          const d = detail();
          if (c && d) {
            props.onOpenDiff(buildDiffTarget(c.hash, item.filePath, "commit", d.files));
          }
        }
        break;
      case "stash-entry":
        toggleStash(item.stashHash);
        break;
      case "stash-dir":
        toggleStashDir(item.stashHash, item.dirPath);
        break;
      case "stash-file":
        if (props.onOpenDiff && item.filePath) {
          const stashFiles = stashFileCache().get(item.stashHash);
          if (stashFiles) {
            props.onOpenDiff(buildDiffTarget(item.stashHash, item.filePath, "stash", stashFiles));
          } else {
            // Cache miss — open with single-file list (no left/right navigation)
            props.onOpenDiff({
              commitHash: item.stashHash,
              filePath: item.filePath,
              source: "stash",
              fileList: [item.filePath],
              fileIndex: 0,
            });
          }
        }
        break;
    }
  };

  /** Activate the item at the current cursor index. Returns true if it was a jump. */
  const activateCurrentItem = (): boolean => {
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (idx >= 0 && idx < items.length) {
      const item = items[idx];
      activateItem(item);
      return item.type === "child" || item.type === "parent";
    }
    return false;
  };

  // Keep navRef updated whenever interactive items change
  createEffect(() => {
    if (props.navRef) {
      props.navRef.itemCount = interactiveItems().length;
      props.navRef.activateCurrentItem = activateCurrentItem;
      props.navRef.scrollToFile = (filePath: string) => {
        // Find the file tree row index for this path
        const tab = activeTab();
        if (tab === "files") {
          const rows = fileTreeRows();
          const treeIdx = rows.findIndex(r => !r.isDir && r.file?.path === filePath);
          if (treeIdx >= 0) {
            const itemIdx = findItemIndex("file", undefined, treeIdx);
            if (itemIdx >= 0) actions.setDetailCursorIndex(itemIdx);
          }
        } else if (tab === "stashes") {
          // For stash files, search expanded stash file trees
          const stashes = stashEntries();
          for (const stash of stashes) {
            if (!expandedStashes().has(stash.hash)) continue;
            const rows = getStashFileTreeRows(stash.hash);
            const treeIdx = rows.findIndex(r => !r.isDir && r.file?.path === filePath);
            if (treeIdx >= 0) {
              const itemIdx = findItemIndex("stash-file", stash.hash, treeIdx);
              if (itemIdx >= 0) {
                actions.setDetailCursorIndex(itemIdx);
                return;
              }
            }
          }
        }
      };
    }
  });

  // Keep the footer's contextual enter-key hint in sync with the cursor position
  createEffect(() => {
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (!state.detailFocused() || idx < 0 || idx >= items.length) {
      actions.setDetailCursorAction(null);
      return;
    }
    const item = items[idx];
    switch (item.type) {
      case "section-header": {
        const expanded = item.section === "children" ? childrenExpanded() : parentsExpanded();
        actions.setDetailCursorAction(expanded ? "collapse" : "expand");
        break;
      }
      case "file-dir":
        actions.setDetailCursorAction(collapsedDirs().has(item.dirPath) ? "expand" : "collapse");
        break;
      case "copyable":
        actions.setDetailCursorAction("copy");
        break;
      case "child":
      case "parent":
        actions.setDetailCursorAction("navigate");
        break;
      case "stash-entry":
        actions.setDetailCursorAction(expandedStashes().has(item.stashHash) ? "collapse" : "expand");
        break;
      case "stash-dir": {
        const dirs = stashCollapsedDirs().get(item.stashHash);
        actions.setDetailCursorAction(dirs?.has(item.dirPath) ? "expand" : "collapse");
        break;
      }
      case "file":
      case "stash-file":
        actions.setDetailCursorAction("diff");
        break;
    }
  });

  // ── Cursor-aware banner scroll (deferred part) ────────────────────
  // Must be defined after interactiveItems, fileTreeRows, and fileWidths.

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

      case "file-dir": {
        // Layout: prefix + connector + dirIndicator + name
        const rows = fileTreeRows();
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fixedChars = treeRow.prefix.length + treeRow.connector.length + DIR_INDICATOR_WIDTH;
        const available = pw - fixedChars;
        if (treeRow.name.length <= available) return null;
        return { text: treeRow.name, visibleWidth: available };
      }

      case "file": {
        // Layout: prefix + connector + name + statPaddingLeft + status + statGap + addCol + statGap + delCol
        const rows = fileTreeRows();
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fw = fileWidths();
        const statWidth = STAT_PADDING_LEFT + STATUS_COL_WIDTH + STAT_GAP + fw.addColWidth + STAT_GAP + fw.delColWidth;
        const fixedChars = treeRow.prefix.length + treeRow.connector.length + statWidth;
        const available = pw - fixedChars;
        if (treeRow.name.length <= available) return null;
        return { text: treeRow.name, visibleWidth: available };
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
  const CopyableRow = (props: {
    field: CopyableField;
    /** Fallback content shown when not banner-scrolling. */
    children: JSXElement;
    /** Text color when not cursored. Defaults to t().foreground. */
    fg?: string;
    /** wrapMode for the text element. Defaults to "none". */
    wrapMode?: "none" | "char" | "word";
  }) => (
    <box flexDirection="row" backgroundColor={copyableHighlightBg(props.field)}>
      <text
        flexGrow={1}
        flexShrink={1}
        fg={isCopyableCursored(props.field) ? t().accent : (props.fg ?? t().foreground)}
        wrapMode={props.wrapMode ?? "none"}
        truncate={props.wrapMode !== "word" && !isCopyableCursored(props.field)}
      >
        {scrolledCopyableText(props.field) ?? props.children}
      </text>
      <Show when={copiedField() === props.field}>
        <text flexShrink={0} bg={t().primary} fg={t().background} wrapMode="none">
          {" \u2713 copied "}
        </text>
      </Show>
    </box>
  );

  /** Memo'd index map for O(1) lookup of interactive item positions.
   *  Keys are "section-header:children", "child:0", "file-dir:3", "stash-entry:abc123", etc. */
  const itemIndexMap = createMemo(() => {
    const map = new Map<string, number>();
    const items = interactiveItems();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      switch (item.type) {
        case "section-header":
          map.set(`section-header:${item.section}`, i);
          break;
        case "copyable":
          map.set(`copyable:${item.field}`, i);
          break;
        case "child":
        case "parent":
        case "file-dir":
        case "file":
          map.set(`${item.type}:${item.index}`, i);
          break;
        case "stash-entry":
          map.set(`stash-entry:${item.stashHash}`, i);
          break;
        case "stash-dir":
          map.set(`stash-dir:${item.stashHash}:${item.index}`, i);
          break;
        case "stash-file":
          map.set(`stash-file:${item.stashHash}:${item.index}`, i);
          break;
      }
    }
    return map;
  });

  /** Find the interactive item index for a given item (O(1) via memo'd map). */
  const findItemIndex = (type: InteractiveItem["type"], keyOrSection?: string, idx?: number): number => {
    let key: string;
    switch (type) {
      case "section-header":
        key = `section-header:${keyOrSection}`;
        break;
      case "copyable":
        key = `copyable:${keyOrSection}`;
        break;
      case "stash-entry":
        key = `stash-entry:${keyOrSection}`;
        break;
      case "stash-dir":
        key = `stash-dir:${keyOrSection}:${idx}`;
        break;
      case "stash-file":
        key = `stash-file:${keyOrSection}:${idx}`;
        break;
      default:
        key = `${type}:${idx}`;
        break;
    }
    return itemIndexMap().get(key) ?? -1;
  };

  // Track interactive item indices for each rendered section/entry
  // These are derived from the interactiveItems memo

  /** Render a collapsible section header with interactive highlight */
  function InteractiveSectionHeader(
    headerProps: Readonly<{
      title: string;
      count: number;
      expanded: boolean;
      section: "children" | "parents";
    }>,
  ) {
    const itemIdx = () => findItemIndex("section-header", headerProps.section);

    return (
      <box backgroundColor={itemHighlightBg(itemIdx())}>
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
      <box flexDirection="row" flexWrap="wrap" gap={1} paddingLeft={2} backgroundColor={itemHighlightBg(itemIdx())}>
        <text fg={cursored() ? t().accent : t().foreground} wrapMode="none">
          {entryProps.hash.substring(0, SHORT_HASH_LEN)}
        </text>
        <Show
          when={entryProps.branchName !== ""}
          fallback={
            <Show when={tag()} fallback={<DetailBadge name="deleted" colorIndex={0} dimmed />}>
              <DetailBadge name={tag() as string} colorIndex={entryProps.colorIndex} {...badgeScrollProps()} />
            </Show>
          }
        >
          <DetailBadge name={entryProps.branchName} colorIndex={entryProps.colorIndex} {...badgeScrollProps()} />
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
                          <DetailBadge name={tag} colorIndex={nodeColorIndex()} />
                        ) : (
                          <DetailBadge name="deleted" colorIndex={0} dimmed />
                        );
                      })()}
                    >
                      {/* Graph-inferred branch: local badge, optional remote badge, right-aligned tracking */}
                      <box flexDirection="row" width="100%">
                        <DetailBadge name={r().branchName} colorIndex={nodeColorIndex()} />
                        {(() => {
                          const tr = branchTracking(r().branchName);
                          if (!tr) {
                            // No tracking — show remote badge if present
                            const rn = remoteName();
                            return rn ? <DetailBadge name={rn} colorIndex={nodeColorIndex()} /> : null;
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
                          <DetailBadge
                            name={ref.name}
                            colorIndex={nodeColorIndex()}
                            dimmed={ref.type === "stash" || ref.type === "uncommitted"}
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
                  <For each={tagRefs()}>{ref => <DetailBadge name={ref.name} colorIndex={nodeColorIndex()} />}</For>
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
                <CopyableRow field="hash">{c().hash}</CopyableRow>
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
                <CopyableRow field="author">
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
                <CopyableRow field="date">{formatDate(c().authorDate)}</CopyableRow>
              </Show>

              <Show when={!isUncommitted() && showCommitter()}>
                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Committer</strong>
                </text>
                <CopyableRow field="committer">
                  {c().committer} {"<"}
                  {c().committerEmail}
                  {">"}
                </CopyableRow>

                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Commit Date</strong>
                </text>
                <CopyableRow field="commitDate">{formatDate(c().commitDate)}</CopyableRow>
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
                <CopyableRow field="subject">{c().subject}</CopyableRow>
              </Show>

              <Show when={!isUncommitted() && detail()?.body}>
                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Body</strong>
                </text>
                <CopyableRow field="body" fg={t().foregroundMuted} wrapMode="word">
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
                      />
                    )}
                  </For>
                </Show>
                <box height={1} />
              </Show>
            </Show>

            {/* ══════════════ Files tab ══════════════ */}
            <Show when={activeTab() === "files" && detail() && detail()?.files.length > 0}>
              <TotalLinesChangedRow totalAdd={fileWidths().totalAdd} totalDel={fileWidths().totalDel} />
              <For each={fileTreeRows()}>
                {(treeRow, i) => {
                  const itemIdx = () => findItemIndex(treeRow.isDir ? "file-dir" : "file", undefined, i());
                  const cursored = () => isCursored(itemIdx());
                  const collapsed = () => treeRow.isDir && collapsedDirs().has(treeRow.dirPath);

                  /** When this row is cursored and overflows, apply banner scroll */
                  const scrolledName = () => {
                    if (!cursored()) return null;
                    const info = cursoredTextInfo();
                    if (!info || info.text !== treeRow.name) return null;
                    const off = bannerOffset();
                    return treeRow.name.substring(off, off + info.visibleWidth);
                  };

                  return (
                    <FileTreeEntry
                      row={treeRow}
                      cursored={cursored()}
                      collapsed={collapsed()}
                      highlightBg={itemHighlightBg(itemIdx())}
                      scrolledName={scrolledName()}
                      addColWidth={fileWidths().addColWidth}
                      delColWidth={fileWidths().delColWidth}
                    />
                  );
                }}
              </For>
            </Show>

            {/* Show "no files" message when files tab has no content */}
            <Show when={activeTab() === "files" && (!detail() || detail()?.files.length === 0)}>
              <box flexGrow={1} alignItems="center" justifyContent="center">
                <text fg={t().foregroundMuted}>{state.detailLoading() ? "Loading..." : "No modified files"}</text>
              </box>
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
          </>
        )}
      </Show>
    </box>
  );
}
