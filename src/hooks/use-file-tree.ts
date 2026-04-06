import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { FileChange } from "../git/types";
import type { FileTreeNode, FileTreeRow } from "../utils/file-tree";
import { buildFileTree, flattenFileTree } from "../utils/file-tree";

interface UseFileTreeResult {
  /** The built file tree (memoized). */
  fileTree: Accessor<FileTreeNode>;
  /** Flattened renderable rows (memoized, respects collapsed dirs). */
  fileTreeRows: Accessor<FileTreeRow[]>;
  /** Set of currently-collapsed directory fullPaths. */
  collapsedDirs: Accessor<Set<string>>;
  /** Toggle a directory's collapsed state. */
  toggleDir: (dirPath: string) => void;
}

/**
 * Reactive file tree state manager.
 *
 * Builds a tree from `files`, tracks collapsed directories, and exposes
 * flattened renderable rows. Automatically resets collapsed state whenever
 * `resetOn` changes (e.g. when the active commit or tab changes).
 *
 * @param files   Reactive accessor for the flat list of file changes.
 * @param resetOn Reactive accessor whose value change triggers a reset of
 *                collapsed dirs. Typically the active commit or tab signal.
 */
export function useFileTree(files: Accessor<FileChange[]>, resetOn: Accessor<unknown>): UseFileTreeResult {
  const fileTree = createMemo((): FileTreeNode => {
    const f = files();
    if (f.length === 0) return { name: "/", fullPath: "/", children: [] };
    return buildFileTree(f);
  });

  const [collapsedDirs, setCollapsedDirs] = createSignal(new Set<string>());

  createEffect(() => {
    resetOn(); // track the reset trigger
    setCollapsedDirs(new Set<string>());
  });

  const toggleDir = (dirPath: string) => {
    const next = new Set(collapsedDirs());
    if (next.has(dirPath)) next.delete(dirPath);
    else next.add(dirPath);
    setCollapsedDirs(next);
  };

  // NOTE: fileTreeRows must be defined AFTER fileTree and collapsedDirs
  // per the createMemo TDZ rule (see AGENTS.md).
  const fileTreeRows = createMemo((): FileTreeRow[] => flattenFileTree(fileTree(), collapsedDirs()));

  return { fileTree, fileTreeRows, collapsedDirs, toggleDir };
}
