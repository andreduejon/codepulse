import type { FileChange } from "../git/types";

/** Tree node for building the file tree structure */
export interface FileTreeNode {
  name: string;          // segment name (directory name or file basename)
  fullPath: string;      // full path for identification
  file?: FileChange;     // present only for file nodes (leaves)
  children: FileTreeNode[];
}

/** A flattened row from the file tree, ready for rendering */
export interface FileTreeRow {
  prefix: string;        // connector prefix chars (│, spaces from ancestors)
  connector: string;     // this row's connector (├── or └──)
  name: string;          // display name
  isDir: boolean;        // true = directory, false = file
  dirPath: string;       // for dirs: the full path; for files: parent dir path
  file?: FileChange;     // present only for file rows
  depth: number;         // nesting depth (0 = root children)
}

/**
 * Build a file tree from a flat list of file changes.
 * Directories are sorted before files, both alphabetically.
 * Single-child directory chains are compacted (e.g. src/components/dialogs/).
 */
export function buildFileTree(files: FileChange[]): FileTreeNode {
  const root: FileTreeNode = { name: "/", fullPath: "/", children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/") + (isFile ? "" : "/");
      if (isFile) {
        node.children.push({ name: part, fullPath: file.path, file, children: [] });
      } else {
        let child = node.children.find((c) => !c.file && c.name === part);
        if (!child) {
          child = { name: part, fullPath, children: [] };
          node.children.push(child);
        }
        node = child;
      }
    }
  }

  // Sort: directories first (alphabetical), then files (alphabetical)
  const sortNode = (n: FileTreeNode) => {
    n.children.sort((a, b) => {
      const aIsDir = !a.file;
      const bIsDir = !b.file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of n.children) {
      if (!child.file) sortNode(child);
    }
  };
  sortNode(root);

  // Compact single-child directory chains
  // (e.g. src/ → components/ → dialogs/ becomes src/components/dialogs/)
  const compact = (n: FileTreeNode) => {
    for (let i = 0; i < n.children.length; i++) {
      const child = n.children[i];
      if (child.file) continue;
      while (child.children.length === 1 && !child.children[0].file) {
        const grandchild = child.children[0];
        child.name = child.name + "/" + grandchild.name;
        child.fullPath = grandchild.fullPath;
        child.children = grandchild.children;
      }
      compact(child);
    }
  };
  compact(root);

  return root;
}

/**
 * Flatten a file tree into renderable rows with connector prefixes.
 * Directories in `collapsedDirs` have their children hidden.
 */
export function flattenFileTree(
  root: FileTreeNode,
  collapsedDirs: ReadonlySet<string>
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];

  const walk = (node: FileTreeNode, prefix: string, depth: number) => {
    const visibleChildren = node.children;
    for (let i = 0; i < visibleChildren.length; i++) {
      const child = visibleChildren[i];
      const isLast = i === visibleChildren.length - 1;
      const connector = isLast ? "└─ " : "├─ ";
      const isDir = !child.file;

      rows.push({
        prefix,
        connector,
        name: isDir ? child.name + "/" : child.name,
        isDir,
        dirPath: isDir ? child.fullPath : node.fullPath,
        file: child.file,
        depth,
      });

      if (isDir && !collapsedDirs.has(child.fullPath)) {
        const childPrefix = prefix + (isLast ? "   " : "│  ");
        walk(child, childPrefix, depth + 1);
      }
    }
  };

  walk(root, "", 0);
  return rows;
}
