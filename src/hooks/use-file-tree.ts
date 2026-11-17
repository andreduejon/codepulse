import type { Accessor } from "solid-js";
import { createMemo } from "solid-js";
import { createRememberedSignal, type DetailMemory } from "../components/detail-memory";
import type { FileChange } from "../core/git/types";
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
 * flattened renderable rows. Every folder opens again when `subject` changes
 * (the commit, or the uncommitted view's tab).
 *
 * @param files   Reactive accessor for the flat list of file changes.
 * @param subject What the files belong to.
 * @param memory  Keeps collapsed folders while the list is not shown (another tab, the other layout).
 */
export function useFileTree(
  files: Accessor<FileChange[]>,
  subject: Accessor<string>,
  memory?: DetailMemory,
): UseFileTreeResult {
  const fileTree = createMemo((): FileTreeNode => {
    const f = files();
    if (f.length === 0) return { name: "/", fullPath: "/", children: [] };
    return buildFileTree(f);
  });

  const [collapsedDirs, setCollapsedDirs] = createRememberedSignal(
    memory,
    "files.collapsed",
    subject,
    () => new Set<string>(),
  );

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
