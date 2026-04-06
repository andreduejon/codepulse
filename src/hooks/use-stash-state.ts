import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal } from "solid-js";
import { computeFileWidths } from "../components/detail-types";
import { useAppState } from "../context/state";
import { getStashFiles } from "../git/repo";
import type { Commit, FileChange } from "../git/types";
import type { FileTreeRow } from "../utils/file-tree";
import { buildFileTree, flattenFileTree } from "../utils/file-tree";

export interface StashFileWidths {
  totalAdd: number;
  totalDel: number;
  addColWidth: number;
  delColWidth: number;
}

export interface StashState {
  /** Stash entries for the currently selected commit. */
  stashEntries: Accessor<Commit[]>;
  /** Set of expanded stash hashes. */
  expandedStashes: Accessor<Set<string>>;
  /** Cached stash files keyed by stash hash. */
  stashFileCache: Accessor<Map<string, FileChange[]>>;
  /** Collapsed dirs per stash: stashHash → Set of collapsed dir paths. */
  stashCollapsedDirs: Accessor<Map<string, Set<string>>>;
  /** Toggle expand/collapse and lazily load files. */
  toggleStash: (stashHash: string) => Promise<void>;
  /** Toggle a directory within a stash's file tree. */
  toggleStashDir: (stashHash: string, dirPath: string) => void;
  /** Build flat file tree rows for a stash. */
  getStashFileTreeRows: (stashHash: string) => FileTreeRow[];
  /** Get column widths for a stash's file stats. */
  getStashFileWidths: (stashHash: string) => StashFileWidths;
}

/**
 * Manages stash section state for the commit detail panel.
 *
 * Accepts the currently selected commit as a reactive accessor. Resets all
 * state when the commit changes and handles lazy file loading on expand.
 */
export function useStashState(commit: Accessor<Commit | null | undefined>): StashState {
  const { state } = useAppState();

  const stashEntries = createMemo((): Commit[] => {
    const c = commit();
    if (!c) return [];
    return state.stashByParent().get(c.hash) ?? [];
  });

  const [expandedStashes, setExpandedStashes] = createSignal(new Set<string>());
  const [stashFileCache, setStashFileCache] = createSignal(new Map<string, FileChange[]>());
  const [stashCollapsedDirs, setStashCollapsedDirs] = createSignal(new Map<string, Set<string>>());

  // Reset stash state when selected commit changes
  createEffect(() => {
    commit();
    setExpandedStashes(new Set<string>());
    setStashFileCache(new Map<string, FileChange[]>());
    setStashCollapsedDirs(new Map<string, Set<string>>());
  });

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
      setStashFileCache(prev => {
        const m = new Map(prev);
        m.set(stashHash, files);
        return m;
      });
    }
  };

  const toggleStashDir = (stashHash: string, dirPath: string) => {
    setStashCollapsedDirs(prev => {
      const m = new Map(prev);
      const dirs = new Set(m.get(stashHash) ?? []);
      if (dirs.has(dirPath)) dirs.delete(dirPath);
      else dirs.add(dirPath);
      m.set(stashHash, dirs);
      return m;
    });
  };

  const getStashFileTreeRows = (stashHash: string): FileTreeRow[] => {
    const files = stashFileCache().get(stashHash);
    if (!files || files.length === 0) return [];
    const tree = buildFileTree(files);
    const collapsed = stashCollapsedDirs().get(stashHash) ?? new Set<string>();
    return flattenFileTree(tree, collapsed);
  };

  const getStashFileWidths = (stashHash: string): StashFileWidths => {
    const files = stashFileCache().get(stashHash);
    if (!files) return { totalAdd: 0, totalDel: 0, addColWidth: 2, delColWidth: 2 };
    return computeFileWidths(files);
  };

  return {
    stashEntries,
    expandedStashes,
    stashFileCache,
    stashCollapsedDirs,
    toggleStash,
    toggleStashDir,
    getStashFileTreeRows,
    getStashFileWidths,
  };
}
