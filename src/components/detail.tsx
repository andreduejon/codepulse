import { Show, For, createSignal, createEffect, createMemo, untrack } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import type { Commit, GraphRow, FileChange } from "../git/types";
import { buildFileTree, flattenFileTree } from "../utils/file-tree";
import type { FileTreeNode, FileTreeRow } from "../utils/file-tree";
import { useBannerScroll } from "../hooks/use-banner-scroll";
import { getStashFiles } from "../git/repo";
import { DETAIL_PANEL_WIDTH_FRACTION, UNCOMMITTED_HASH } from "../constants";
import DetailBadge from "./detail-badge";
import type { DetailNavRef, DetailViewProps } from "./detail-types";
import {
  PANEL_PADDING_X, SHORT_HASH_LEN, HASH_BADGE_GAP, BADGE_PADDING,
  ENTRY_PADDING_LEFT, DIR_INDICATOR_WIDTH, STAT_PADDING_LEFT, STAT_GAP,
  computeFileWidths,
} from "./detail-types";

// ── Layout constants ────────────────────────────────────────────────
/** Minimum panel width in characters before padding is subtracted. */
const MIN_PANEL_WIDTH = 60;

/** Types for interactive items in the detail panel */
type InteractiveItem =
  | { type: "section-header"; section: "children" | "parents" }
  | { type: "child"; hash: string; index: number }
  | { type: "parent"; hash: string; index: number }
  | { type: "file-dir"; dirPath: string; index: number }
  | { type: "file"; filePath: string; index: number }
  | { type: "stash-entry"; stashHash: string; stashIndex: number }
  | { type: "stash-dir"; stashHash: string; dirPath: string; index: number }
  | { type: "stash-file"; stashHash: string; filePath: string; index: number };

export default function CommitDetailView(props: Readonly<DetailViewProps>) {
  const { state, actions } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();
  const renderer = useRenderer();

  const commit = () => state.selectedCommit();
  const detail = () => state.commitDetail();
  const row = () => state.selectedRow();
  /** Non-null row accessor — safe inside <Show when={commit()}>
   *  since selectedRow and selectedCommit are derived from the same index. */
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
    const tag = c.refs.find((r) => r.type === "tag");
    return tag?.name ?? null;
  };

  // ── Cursor-aware banner scroll for long text ──────────────────────
  // Only the currently-cursored item scrolls when its text overflows.
  const panelUsableWidth = () => Math.max(Math.floor(renderer.width * DETAIL_PANEL_WIDTH_FRACTION), MIN_PANEL_WIDTH) - PANEL_PADDING_X;


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

  // Active tab for committed commits: "detail" | "files" | "stashes"
  const activeTab = () => state.detailActiveTab();

  // ── Build flat list of interactive items (tab-aware) ──
  const interactiveItems = createMemo((): InteractiveItem[] => {
    const r = row();
    const c = commit();
    if (!r || !c) return [];

    const tab = activeTab();
    const items: InteractiveItem[] = [];

    if (tab === "detail") {
      // Children section (only if children exist)
      if (r.children.length > 0) {
        items.push({ type: "section-header", section: "children" });
        if (childrenExpanded()) {
          for (let i = 0; i < r.children.length; i++) {
            items.push({ type: "child", hash: r.children[i], index: i });
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
            items.push({ type: "file", filePath: row.file!.path, index: i });
          }
        }
      }
    } else if (tab === "stashes") {
      // Stash entries (each stash is its own collapsible header)
      const stashes = stashEntries();
      if (stashes.length > 0) {
        for (let si = 0; si < stashes.length; si++) {
          const stash = stashes[si];
          items.push({ type: "stash-entry", stashHash: stash.hash, stashIndex: si });

          // If this stash is expanded, add its file tree items
          if (expandedStashes().has(stash.hash)) {
            const rows = getStashFileTreeRows(stash.hash);
            for (let fi = 0; fi < rows.length; fi++) {
              const row = rows[fi];
              if (row.isDir) {
                items.push({ type: "stash-dir", stashHash: stash.hash, dirPath: row.dirPath, index: fi });
              } else {
                items.push({ type: "stash-file", stashHash: stash.hash, filePath: row.file!.path, index: fi });
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

    // If we navigated from another commit, position cursor based on jump direction.
    // Read origin without tracking so this effect only fires when interactiveItems changes
    // (not when originHash is set before the commit has changed).
    const origin = untrack(() => state.detailOriginHash());
    if (origin && count > 0 && props.navRef) {
      const direction = props.navRef.lastJumpFrom;
      actions.setDetailOriginHash(null);
      props.navRef.lastJumpFrom = null;

      // When jumping from a parent entry → continue walking parents (first parent)
      // When jumping from a child entry → continue walking children (first child)
      const targetType = direction === "parent" ? "parent" : "child";
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
      // No entries — fall back to first item
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
      case "child":
      case "parent":
        if (props.onJumpToCommit) props.onJumpToCommit(item.hash, item.type);
        break;
      case "file-dir":
        toggleDir(item.dirPath);
        break;
      case "file":
        // No action for files — just highlight
        break;
      case "stash-entry":
        toggleStash(item.stashHash);
        break;
      case "stash-dir":
        toggleStashDir(item.stashHash, item.dirPath);
        break;
      case "stash-file":
        // No action for stash files — just highlight
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
        const expanded =
          item.section === "children" ? childrenExpanded() : parentsExpanded();
        actions.setDetailCursorAction(expanded ? "collapse" : "expand");
        break;
      }
      case "file-dir":
        actions.setDetailCursorAction(collapsedDirs().has(item.dirPath) ? "expand" : "collapse");
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
        actions.setDetailCursorAction(null);
        break;
    }
  });

  // Split refs into branches (branch/remote/head) and tags
  const branchRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter((r) => r.type !== "tag");
  };

  const tagRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter((r) => r.type === "tag");
  };

  // The node color index for this commit's lane
  const nodeColorIndex = () => row()?.nodeColor ?? 0;

  // For non-tip commits: find the remote counterpart of branchName
  const remoteName = () => {
    const bn = row()?.branchName;
    if (!bn) return null;
    const remote = state.branches().find(
      (b) => b.isRemote && b.name.endsWith("/" + bn)
    );
    return remote?.name ?? null;
  };

  // Whether to show committer info (only when different from author)
  const showCommitter = () => {
    const c = commit();
    if (!c) return false;
    return c.committer !== c.author || c.committerEmail !== c.authorEmail;
  };

  // Whether the selected commit is the synthetic uncommitted-changes node
  const isUncommitted = () => commit()?.hash === UNCOMMITTED_HASH;

  // Column widths for file changes — derived from totals (always >= per-file values)
  const fileWidths = createMemo(() => {
    const d = detail();
    if (!d) return { totalAdd: 0, totalDel: 0, addColWidth: 2, delColWidth: 2 };
    return computeFileWidths(d.files);
  });

  // Build file tree from flat file paths
  const fileTree = createMemo((): FileTreeNode => {
    const d = detail();
    if (!d) return { name: "/", fullPath: "/", children: [] };
    return buildFileTree(d.files);
  });

  // Collapsed directory paths (tracked by fullPath)
  const [collapsedDirs, setCollapsedDirs] = createSignal(new Set<string>());

  // Reset collapsed dirs when commit changes
  createEffect(() => {
    commit();
    setCollapsedDirs(new Set<string>());
  });

  // ── Stash section state ─────────────────────────────────────────────
  /** Stash entries for the currently selected commit (from stashByParent map). */
  const stashEntries = createMemo((): Commit[] => {
    const c = commit();
    if (!c) return [];
    return state.stashByParent().get(c.hash) ?? [];
  });

  /** Which stash hashes are expanded in the detail panel. */
  const [expandedStashes, setExpandedStashes] = createSignal(new Set<string>());
  /** Cached stash file data: stashHash → FileChange[]. */
  const [stashFileCache, setStashFileCache] = createSignal(new Map<string, FileChange[]>());
  /** Collapsed dirs per stash: stashHash → Set of collapsed dir paths. */
  const [stashCollapsedDirs, setStashCollapsedDirs] = createSignal(new Map<string, Set<string>>());

  // Reset stash state when selected commit changes
  createEffect(() => {
    commit();
    setExpandedStashes(new Set<string>());
    setStashFileCache(new Map<string, FileChange[]>());
    setStashCollapsedDirs(new Map<string, Set<string>>());
  });

  /** Toggle a stash's expanded state and lazily load files. */
  const toggleStash = async (stashHash: string) => {
    const next = new Set(expandedStashes());
    if (next.has(stashHash)) {
      next.delete(stashHash);
      setExpandedStashes(next);
      return;
    }
    next.add(stashHash);
    setExpandedStashes(next);

    // Lazy load files if not cached
    if (!stashFileCache().has(stashHash)) {
      const files = await getStashFiles(state.repoPath(), stashHash);
      setStashFileCache((prev) => {
        const m = new Map(prev);
        m.set(stashHash, files);
        return m;
      });
    }
  };

  /** Toggle a directory within a stash's file tree. */
  const toggleStashDir = (stashHash: string, dirPath: string) => {
    setStashCollapsedDirs((prev) => {
      const m = new Map(prev);
      const dirs = new Set(m.get(stashHash) ?? []);
      if (dirs.has(dirPath)) dirs.delete(dirPath);
      else dirs.add(dirPath);
      m.set(stashHash, dirs);
      return m;
    });
  };

  /** Build file tree rows for a specific stash. */
  const getStashFileTreeRows = (stashHash: string): FileTreeRow[] => {
    const files = stashFileCache().get(stashHash);
    if (!files || files.length === 0) return [];
    const tree = buildFileTree(files);
    const collapsed = stashCollapsedDirs().get(stashHash) ?? new Set<string>();
    return flattenFileTree(tree, collapsed);
  };

  /** Get column widths for a stash's file stats. */
  const getStashFileWidths = (stashHash: string) => {
    const files = stashFileCache().get(stashHash);
    if (!files) return { totalAdd: 0, totalDel: 0, addColWidth: 2, delColWidth: 2 };
    return computeFileWidths(files);
  };

  /** Toggle a directory's collapsed state */
  const toggleDir = (dirPath: string) => {
    const next = new Set(collapsedDirs());
    if (next.has(dirPath)) next.delete(dirPath);
    else next.add(dirPath);
    setCollapsedDirs(next);
  };

  // Flatten tree into renderable rows with connector prefixes
  const fileTreeRows = createMemo((): FileTreeRow[] =>
    flattenFileTree(fileTree(), collapsedDirs())
  );

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
        const entryBranch = item.type === "child"
          ? r?.childBranches[item.index] ?? ""
          : r?.parentBranches[item.index] ?? "";
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
        // Layout: paddingLeft + prefix + connector + dirIndicator + name
        const rows = fileTreeRows();
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fixedChars = ENTRY_PADDING_LEFT + treeRow.prefix.length + treeRow.connector.length + DIR_INDICATOR_WIDTH;
        const available = pw - fixedChars;
        if (treeRow.name.length <= available) return null;
        return { text: treeRow.name, visibleWidth: available };
      }

      case "file": {
        // Layout: paddingLeft + prefix + connector + name + statPaddingLeft + addCol + statGap + delCol
        const rows = fileTreeRows();
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fw = fileWidths();
        const statWidth = STAT_PADDING_LEFT + fw.addColWidth + STAT_GAP + fw.delColWidth;
        const fixedChars = ENTRY_PADDING_LEFT + treeRow.prefix.length + treeRow.connector.length + statWidth;
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
        // Same layout as file-dir but inside a stash sub-tree (extra indent for stash nesting)
        const stashIndent = ENTRY_PADDING_LEFT; // stash files are double-indented
        const rows = getStashFileTreeRows(item.stashHash);
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fixedChars = ENTRY_PADDING_LEFT + stashIndent + treeRow.prefix.length + treeRow.connector.length + DIR_INDICATOR_WIDTH;
        const available = pw - fixedChars;
        if (treeRow.name.length <= available) return null;
        return { text: treeRow.name, visibleWidth: available };
      }

      case "stash-file": {
        // Same layout as file but inside a stash sub-tree
        const stashIndent = ENTRY_PADDING_LEFT;
        const rows = getStashFileTreeRows(item.stashHash);
        const treeRow = rows[item.index];
        if (!treeRow) return null;
        const fw = getStashFileWidths(item.stashHash);
        const statWidth = STAT_PADDING_LEFT + fw.addColWidth + STAT_GAP + fw.delColWidth;
        const fixedChars = ENTRY_PADDING_LEFT + stashIndent + treeRow.prefix.length + treeRow.connector.length + statWidth;
        const available = pw - fixedChars;
        if (treeRow.name.length <= available) return null;
        return { text: treeRow.name, visibleWidth: available };
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

  // Highlight color for the cursor'd interactive item
  const highlightBgFocused = () => t().backgroundElementActive;

  /** Check if a given interactive item index should be highlighted, and return its bg color */
  const itemHighlightBg = (itemIndex: number): string | undefined => {
    if (state.detailFocused() && state.detailCursorIndex() === itemIndex) {
      return highlightBgFocused();
    }
    return undefined;
  };

  /** Check if item is the focused cursor (for accent text color) */
  const isCursored = (itemIndex: number) =>
    state.detailFocused() && state.detailCursorIndex() === itemIndex;

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
  function InteractiveSectionHeader(headerProps: Readonly<{
    title: string;
    count: number;
    expanded: boolean;
    section: "children" | "parents";
  }>) {
    const itemIdx = () => findItemIndex("section-header", headerProps.section);

    return (
      <box
        backgroundColor={itemHighlightBg(itemIdx())}
      >
        <text fg={t().accent} wrapMode="none">
          <strong>{headerProps.expanded ? "▾" : "▸"} {headerProps.title} ({headerProps.count})</strong>
        </text>
      </box>
    );
  }

  /** Render a child/parent entry row with interactive highlight */
  function InteractiveCommitEntry(entryProps: Readonly<{
    hash: string;
    entryIndex: number;
    type: "child" | "parent";
    branchName: string;
    colorIndex: number;
  }>) {
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
            <Show
              when={tag()}
              fallback={
                <DetailBadge
                  name="deleted"
                  colorIndex={0}
                  dimmed
                />
              }
            >
              <DetailBadge
                name={tag()!}
                colorIndex={entryProps.colorIndex}
                {...badgeScrollProps()}
              />
            </Show>
          }
        >
          <DetailBadge
            name={entryProps.branchName}
            colorIndex={entryProps.colorIndex}
            {...badgeScrollProps()}
          />
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
        {(c) => (
          <>
            {/* ══════════════ Detail tab ══════════════ */}
            <Show when={activeTab() === "detail"}>
              {/* ── Branch ── */}
              <text fg={t().accent} wrapMode="none">
                <strong>Branch</strong>
              </text>
              <box flexDirection="row" flexWrap="wrap" gap={1}>
                <Show
                  when={branchRefs().length > 0}
                  fallback={
                    <Show
                      when={(row()?.branchName ?? "") !== ""}
                      fallback={
                        (() => {
                          const tag = getTagForHash(c().hash);
                          return tag ? (
                            <DetailBadge
                              name={tag}
                              colorIndex={nodeColorIndex()}
                            />
                          ) : (
                            <DetailBadge
                              name="deleted"
                              colorIndex={0}
                              dimmed
                            />
                          );
                        })()
                      }
                    >
                      <DetailBadge
                        name={r().branchName}
                        colorIndex={nodeColorIndex()}
                      />
                      <Show when={remoteName()}>
                        <DetailBadge
                          name={remoteName()!}
                          colorIndex={nodeColorIndex()}
                        />
                      </Show>
                    </Show>
                  }
                >
                  <For each={branchRefs()}>
                    {(ref) => (
                      <DetailBadge
                        name={ref.name}
                        colorIndex={nodeColorIndex()}
                        dimmed={ref.type === "stash" || ref.type === "uncommitted"}
                      />
                    )}
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
                    {(ref) => (
                      <DetailBadge
                        name={ref.name}
                        colorIndex={nodeColorIndex()}
                      />
                    )}
                  </For>
                </box>
                <box height={1} />
              </Show>

              {/* ── Metadata block (subheaders with values below) ── */}
              <text fg={t().accent} wrapMode="none">
                <strong>Commit</strong>
              </text>
              <text fg={isUncommitted() ? t().foregroundMuted : t().foreground} wrapMode="none" truncate>
                {isUncommitted() ? "\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7" : c().hash}
              </text>

              <box height={1} />
              <text fg={t().accent} wrapMode="none">
                <strong>Author</strong>
              </text>
              <text fg={isUncommitted() ? t().foregroundMuted : t().foreground} wrapMode="none" truncate>
                {isUncommitted() ? "\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7" : <>{c().author} {"<"}{c().authorEmail}{">"}</>}
              </text>

              <box height={1} />
              <text fg={t().accent} wrapMode="none">
                <strong>Date</strong>
              </text>
              <text fg={isUncommitted() ? t().foregroundMuted : t().foreground} wrapMode="none">
                {isUncommitted() ? "\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7" : formatDate(c().authorDate)}
              </text>

              <Show when={!isUncommitted() && showCommitter()}>
                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Committer</strong>
                </text>
                <text fg={t().foreground} wrapMode="none" truncate>
                  {c().committer} {"<"}{c().committerEmail}{">"}
                </text>

                <box height={1} />
                <text fg={t().accent} wrapMode="none">
                  <strong>Commit Date</strong>
                </text>
                <text fg={t().foreground} wrapMode="none">
                  {formatDate(c().commitDate)}
                </text>
              </Show>

              <box height={1} />

              {/* ── Message (subject + body) ── */}
              <text fg={t().accent} wrapMode="none">
                <strong>Message</strong>
              </text>
              <text fg={isUncommitted() ? t().foregroundMuted : t().foreground} wrapMode="word">
                {isUncommitted() ? "Staged and unstaged changes in working tree" : c().subject}
              </text>

              <Show when={!isUncommitted() && detail()?.body}>
                <box height={1} />
                <text fg={t().foregroundMuted} wrapMode="word">
                  {detail()!.body}
                </text>
              </Show>

              <Show when={interactiveItems().length > 0}>
                <box width="100%" border={["top"]} borderStyle="single" borderColor={t().border} />
              </Show>

              {/* ── Children (collapsible) ── */}
              <Show when={r().children.length > 0}>
                <InteractiveSectionHeader
                  title="Children"
                  count={r().children.length}
                  expanded={childrenExpanded()}
                  section="children"
                />
                <Show when={childrenExpanded()}>
                  <For each={r().children}>
                    {(childHash, i) => (
                      <InteractiveCommitEntry
                        hash={childHash}
                        entryIndex={i()}
                        type="child"
                        branchName={r().childBranches[i()]}
                        colorIndex={r().childColors[i()]}
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
            <Show when={activeTab() === "files" && detail() && detail()!.files.length > 0}>
              <box flexDirection="row" paddingLeft={2}>
                <box flexGrow={1}>
                  <text fg={t().foregroundMuted} wrapMode="none">
                    total lines changed
                  </text>
                </box>
                <box flexShrink={0} paddingLeft={2}>
                  <text fg={t().diffAdded} wrapMode="none">
                    +{fileWidths().totalAdd}
                  </text>
                </box>
                <box flexShrink={0} paddingLeft={1}>
                  <text fg={t().diffRemoved} wrapMode="none">
                    -{fileWidths().totalDel}
                  </text>
                </box>
              </box>
              <box height={1} />
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
                    <box
                      flexDirection="row"
                      width="100%"
                      paddingLeft={2}
                      backgroundColor={itemHighlightBg(itemIdx())}
                    >
                      <box flexShrink={0}>
            <text fg={t().border} wrapMode="none">
                          {treeRow.prefix}{treeRow.connector}
                        </text>
                      </box>
                      <Show when={treeRow.isDir}>
                        <box flexShrink={0}>
                          <text fg={cursored() ? t().accent : t().foregroundMuted} wrapMode="none">
                            {collapsed() ? "▸ " : "▾ "}
                          </text>
                        </box>
                      </Show>
                      <box flexGrow={1}>
                        <text
                          fg={treeRow.isDir
                            ? (cursored() ? t().accent : t().foregroundMuted)
                            : (cursored() ? t().accent : t().foreground)}
                          wrapMode="none"
                          truncate={scrolledName() == null}
                        >
                          {scrolledName() ?? treeRow.name}
                        </text>
                      </box>
                      <Show when={treeRow.file}>
                        <box flexShrink={0} paddingLeft={2}>
                          <text fg={t().diffAdded} wrapMode="none">
                            {("+" + treeRow.file!.additions).padStart(fileWidths().addColWidth)}
                          </text>
                        </box>
                        <box flexShrink={0} paddingLeft={1}>
                          <text fg={t().diffRemoved} wrapMode="none">
                            {("-" + treeRow.file!.deletions).padStart(fileWidths().delColWidth)}
                          </text>
                        </box>
                      </Show>
                    </box>
                  );
                }}
              </For>
            </Show>

            {/* Show "no files" message when files tab has no content */}
            <Show when={activeTab() === "files" && (!detail() || detail()!.files.length === 0)}>
              <box flexGrow={1} alignItems="center" justifyContent="center">
                <text fg={t().foregroundMuted}>
                  {state.detailLoading() ? "Loading..." : "No modified files"}
                </text>
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
                  const fileCount = () => stashFileCache().get(stash.hash)?.length;

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

                  return (
                    <>
                      {/* Spacer between stash entries (not before the first one) */}
                      <Show when={si() > 0}>
                        <box height={1} />
                      </Show>

                      {/* Stash entry header — label + file count only */}
                      <box backgroundColor={itemHighlightBg(itemIdx())}>
                        <text fg={t().accent} wrapMode="none" truncate={scrolledHeaderText() == null}>
                          <strong>{expanded() ? "▾" : "▸"} {scrolledHeaderText() ?? label()}{fileCount() != null ? ` (${fileCount()})` : ""}</strong>
                        </text>
                      </box>

                      {/* Expanded area: description + total lines changed + file tree */}
                      <Show when={expanded()}>
                        {/* Stash description (subject line) */}
                        <box paddingLeft={ENTRY_PADDING_LEFT}>
                          <text fg={t().foregroundMuted} wrapMode="none" truncate>
                            {stash.subject}
                          </text>
                        </box>
                        <box height={1} />

                        {/* Total lines changed (only after files are loaded) */}
                        <Show when={stashFw().totalAdd > 0 || stashFw().totalDel > 0}>
                          <box flexDirection="row" paddingLeft={2}>
                            <box flexGrow={1}>
                              <text fg={t().foregroundMuted} wrapMode="none">
                                total lines changed
                              </text>
                            </box>
                            <box flexShrink={0} paddingLeft={2}>
                              <text fg={t().diffAdded} wrapMode="none">
                                +{stashFw().totalAdd}
                              </text>
                            </box>
                            <box flexShrink={0} paddingLeft={1}>
                              <text fg={t().diffRemoved} wrapMode="none">
                                -{stashFw().totalDel}
                              </text>
                            </box>
                          </box>
                          <box height={1} />
                        </Show>

                        <For each={stashFileRows()}>
                          {(treeRow, fi) => {
                            const fileItemIdx = () => findItemIndex(
                              treeRow.isDir ? "stash-dir" : "stash-file",
                              stash.hash,
                              fi()
                            );
                            const fileCursored = () => isCursored(fileItemIdx());
                            const fileCollapsed = () => treeRow.isDir && (stashCollapsedDirs().get(stash.hash)?.has(treeRow.dirPath) ?? false);

                            const scrolledFileName = () => {
                              if (!fileCursored()) return null;
                              const info = cursoredTextInfo();
                              if (!info || info.text !== treeRow.name) return null;
                              const off = bannerOffset();
                              return treeRow.name.substring(off, off + info.visibleWidth);
                            };

                            return (
                              <box
                                flexDirection="row"
                                width="100%"
                                paddingLeft={2}
                                backgroundColor={itemHighlightBg(fileItemIdx())}
                              >
                                <box flexShrink={0}>
                                  <text fg={t().border} wrapMode="none">
                                    {treeRow.prefix}{treeRow.connector}
                                  </text>
                                </box>
                                <Show when={treeRow.isDir}>
                                  <box flexShrink={0}>
                                    <text fg={fileCursored() ? t().accent : t().foregroundMuted} wrapMode="none">
                                      {fileCollapsed() ? "▸ " : "▾ "}
                                    </text>
                                  </box>
                                </Show>
                                <box flexGrow={1}>
                                  <text
                                    fg={treeRow.isDir
                                      ? (fileCursored() ? t().accent : t().foregroundMuted)
                                      : (fileCursored() ? t().accent : t().foreground)}
                                    wrapMode="none"
                                    truncate={scrolledFileName() == null}
                                  >
                                    {scrolledFileName() ?? treeRow.name}
                                  </text>
                                </box>
                                <Show when={treeRow.file}>
                                  <box flexShrink={0} paddingLeft={2}>
                                    <text fg={t().diffAdded} wrapMode="none">
                                      {("+" + treeRow.file!.additions).padStart(stashFw().addColWidth)}
                                    </text>
                                  </box>
                                  <box flexShrink={0} paddingLeft={1}>
                                    <text fg={t().diffRemoved} wrapMode="none">
                                      {("-" + treeRow.file!.deletions).padStart(stashFw().delColWidth)}
                                    </text>
                                  </box>
                                </Show>
                              </box>
                            );
                          }}
                        </For>
                      </Show>
                    </>
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
