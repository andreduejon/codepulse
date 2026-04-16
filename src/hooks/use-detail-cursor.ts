/**
 * useDetailCursor — manages the interactive cursor in the CommitDetailView.
 *
 * Owns:
 *   - `interactiveItems` memo (flat list of focusable items for the current tab)
 *   - Cursor clamping + jump-navigation positioning effect
 *   - `activateItem` / `activateCurrentItem` (enter-key action dispatch)
 *   - `itemIndexMap` / `findItemIndex` (O(1) index lookup)
 *   - Cursor-action hint effect (keeps detailCursorAction in sync)
 *   - navRef sync effect (keeps DetailNavRef in sync)
 *
 * Receives state and all collaborators as parameters so that it can be called
 * during a component's setup phase without relying on useContext() (see AGENTS.md rule 5).
 */
import type { Renderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import type { DetailNavRef, DetailViewProps } from "../components/detail-types";
import { isUncommittedHash } from "../constants";
import type { createAppState } from "../context/state";
import type { Commit, CommitDetail, FileChange, GraphRow } from "../git/types";
import type { StashState } from "../hooks/use-stash-state";
import { buildDiffTarget } from "../utils/diff-target";
import type { FileTreeRow } from "../utils/file-tree";

export type CopyableField = "hash" | "author" | "date" | "committer" | "commitDate" | "subject" | "body";

export type InteractiveItem =
  | { type: "section-header"; section: "children" | "parents" }
  | { type: "copyable"; field: CopyableField }
  | { type: "child"; hash: string; index: number }
  | { type: "parent"; hash: string; index: number }
  | { type: "stash-entry"; stashHash: string; stashIndex: number }
  | { type: "stash-dir"; stashHash: string; dirPath: string; index: number }
  | { type: "stash-file"; stashHash: string; filePath: string; index: number };

type AppState = ReturnType<typeof createAppState>["state"];
type AppActions = ReturnType<typeof createAppState>["actions"];

interface UseDetailCursorOptions {
  state: AppState;
  actions: AppActions;
  navRef: DetailNavRef | undefined;
  itemRefs: Renderable[];
  row: () => GraphRow | null | undefined;
  commit: () => Commit | null | undefined;
  detail: () => CommitDetail | null | undefined;
  activeTab: () => string;
  filteredChildren: () => Array<{ hash: string; branch: string; color: number }>;
  childrenExpanded: () => boolean;
  parentsExpanded: () => boolean;
  stashEntries: () => Commit[];
  expandedStashes: () => Set<string>;
  stashFileCache: () => Map<string, FileChange[]>;
  stashCollapsedDirs: () => Map<string, Set<string>>;
  getStashFileTreeRows: (stashHash: string) => FileTreeRow[];
  toggleStash: StashState["toggleStash"];
  toggleStashDir: StashState["toggleStashDir"];
  setChildrenExpanded: (v: boolean) => void;
  setParentsExpanded: (v: boolean) => void;
  copyToClipboard: (text: string, field: CopyableField) => void;
  getCopyableText: (field: CopyableField) => string;
  onJumpToCommit?: DetailViewProps["onJumpToCommit"];
  onOpenDiff?: DetailViewProps["onOpenDiff"];
}

export function useDetailCursor({
  state,
  actions,
  navRef,
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
  onJumpToCommit,
  onOpenDiff,
}: UseDetailCursorOptions) {
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
              const treeRow = rows[fi];
              if (treeRow.isDir) {
                items.push({
                  type: "stash-dir",
                  stashHash: stash.hash,
                  dirPath: treeRow.dirPath,
                  index: fi,
                });
              } else {
                items.push({
                  type: "stash-file",
                  stashHash: stash.hash,
                  filePath: treeRow.file?.path ?? "",
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

  // Clamp cursor when interactive items change, and position cursor after jump.
  // IMPORTANT: When the files tab is active, FileListView owns cursor clamping.
  // Skip this effect on the files tab to avoid resetting the cursor to 0 based
  // on detail.tsx's empty interactiveItems() (which has no "files" branch).
  createEffect(() => {
    if (activeTab() === "files") return;
    const items = interactiveItems();
    const count = items.length;

    // If we navigated via child/parent jump, position cursor on the matching entry.
    // pendingJumpDirection is a mutable ref set by handleJumpToCommit. Unlike a signal,
    // it persists across multiple interactiveItems recomputations — so even if this
    // effect fires multiple times (e.g., once when commit changes, again when commitDetail
    // is cleared to null), it consistently re-positions the cursor on the target entry.
    // The ref is only cleared on the next non-jump navigation (in the app.tsx commit-change effect).
    const jumpDir = navRef?.pendingJumpDirection;
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

  /** Memo'd index map for O(1) lookup of interactive item positions.
   *  Keys are "section-header:children", "child:0", "stash-entry:abc123", etc. */
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
        if (onJumpToCommit) onJumpToCommit(item.hash, item.type);
        break;
      case "stash-entry":
        toggleStash(item.stashHash);
        break;
      case "stash-dir":
        toggleStashDir(item.stashHash, item.dirPath);
        break;
      case "stash-file":
        if (onOpenDiff && item.filePath) {
          const stashFiles = stashFileCache().get(item.stashHash);
          if (stashFiles) {
            onOpenDiff(buildDiffTarget(item.stashHash, item.filePath, "stash", stashFiles));
          } else {
            // Cache miss — open with single-file list (no left/right navigation)
            onOpenDiff({
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

  // Keep navRef updated whenever interactive items change.
  // IMPORTANT: When the files tab is active, FileListView owns navRef exclusively.
  // When the github-actions tab is active, ActionsDetailTab owns navRef exclusively.
  // We must not overwrite it here in those cases.
  createEffect(() => {
    if (navRef && activeTab() !== "files" && activeTab() !== "github-actions") {
      navRef.itemCount = interactiveItems().length;
      navRef.activateCurrentItem = activateCurrentItem;
      navRef.itemRefs = itemRefs;
      navRef.scrollToFile = (filePath: string) => {
        const tab = activeTab();
        if (tab === "stashes") {
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

  // Keep the footer's contextual enter-key hint in sync with the cursor position.
  // IMPORTANT: FileListView owns this on the files tab via its own createEffect.
  // ActionsDetailTab owns this on the github-actions tab via its own createEffect.
  createEffect(() => {
    if (activeTab() === "files" || activeTab() === "github-actions") return;
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
      case "stash-file":
        actions.setDetailCursorAction("diff");
        break;
    }
  });

  return { interactiveItems, findItemIndex, activateItem, activateCurrentItem };
}
