/**
 * Test: verifies the pure tree-building and flattening functions in file-tree.ts.
 *
 * Covers: buildFileTree (path splitting, sorting, single-child compaction)
 * and flattenFileTree (connector prefixes, depth tracking, directory collapsing).
 */
import { describe, expect, test } from "bun:test";
import type { FileChange } from "../src/git/types";
import { buildFileTree, flattenFileTree } from "../src/utils/file-tree";

/** Helper to create a minimal FileChange for testing. */
const file = (path: string, status: FileChange["status"] = "M"): FileChange => ({
  path,
  additions: 1,
  deletions: 0,
  status,
});

// ── buildFileTree ──────────────────────────────────────────────────────

describe("buildFileTree", () => {
  test("empty file list returns empty root", () => {
    const root = buildFileTree([]);
    expect(root.name).toBe("/");
    expect(root.children).toEqual([]);
  });

  test("single file at root level", () => {
    const root = buildFileTree([file("README.md")]);
    expect(root.children.length).toBe(1);
    expect(root.children[0].name).toBe("README.md");
    expect(root.children[0].file).toBeDefined();
    expect(root.children[0].file?.path).toBe("README.md");
    expect(root.children[0].children).toEqual([]);
  });

  test("single file in a directory", () => {
    const root = buildFileTree([file("src/index.ts")]);
    // Should compact "src" since it has a single child
    expect(root.children.length).toBe(1);
    // After compaction: the file is the only child, so the dir node
    // stays as "src" with one file child
    const dir = root.children[0];
    expect(dir.file).toBeUndefined();
    expect(dir.children.length).toBe(1);
    expect(dir.children[0].name).toBe("index.ts");
    expect(dir.children[0].file).toBeDefined();
  });

  test("directories are sorted before files", () => {
    const root = buildFileTree([file("zebra.txt"), file("src/a.ts"), file("apple.txt")]);
    // "src/" dir should come before both files
    expect(root.children[0].file).toBeUndefined(); // dir
    expect(root.children[0].name).toBe("src");
    // Files sorted alphabetically after dirs
    expect(root.children[1].name).toBe("apple.txt");
    expect(root.children[2].name).toBe("zebra.txt");
  });

  test("multiple directories are sorted alphabetically", () => {
    const root = buildFileTree([file("src/a.ts"), file("docs/b.md"), file("lib/c.ts")]);
    const dirNames = root.children.map(c => c.name);
    expect(dirNames).toEqual(["docs", "lib", "src"]);
  });

  test("files within a directory are sorted alphabetically", () => {
    const root = buildFileTree([file("src/z.ts"), file("src/a.ts"), file("src/m.ts")]);
    const dir = root.children[0];
    const fileNames = dir.children.map(c => c.name);
    expect(fileNames).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  test("single-child directory chains are compacted", () => {
    const root = buildFileTree([file("src/components/dialogs/menu.tsx")]);
    // src -> components -> dialogs -> menu.tsx
    // should compact to: "src/components/dialogs" -> "menu.tsx"
    expect(root.children.length).toBe(1);
    const compacted = root.children[0];
    expect(compacted.name).toBe("src/components/dialogs");
    expect(compacted.file).toBeUndefined();
    expect(compacted.children.length).toBe(1);
    expect(compacted.children[0].name).toBe("menu.tsx");
  });

  test("compaction stops when directory has multiple children", () => {
    const root = buildFileTree([file("src/components/app.tsx"), file("src/components/graph.tsx")]);
    // src -> components has 2 children, so src compacts with components
    // but components does NOT compact further
    const compacted = root.children[0];
    expect(compacted.name).toBe("src/components");
    expect(compacted.children.length).toBe(2);
    expect(compacted.children[0].name).toBe("app.tsx");
    expect(compacted.children[1].name).toBe("graph.tsx");
  });

  test("mixed nesting depths", () => {
    const root = buildFileTree([
      file("README.md"),
      file("src/index.ts"),
      file("src/utils/date.ts"),
      file("src/utils/file-tree.ts"),
    ]);
    // Root: src/ dir, README.md file
    expect(root.children.length).toBe(2);
    expect(root.children[0].file).toBeUndefined(); // dir first
    expect(root.children[1].name).toBe("README.md");

    // src/ has index.ts + utils/
    const src = root.children[0];
    expect(src.name).toBe("src");
    expect(src.children.length).toBe(2);
    // utils/ dir before index.ts file
    expect(src.children[0].name).toBe("utils");
    expect(src.children[0].file).toBeUndefined();
    expect(src.children[1].name).toBe("index.ts");

    // utils/ has 2 files (no compaction since src has 2 children)
    const utils = src.children[0];
    expect(utils.children.length).toBe(2);
    expect(utils.children[0].name).toBe("date.ts");
    expect(utils.children[1].name).toBe("file-tree.ts");
  });

  test("deeply nested single-child chain compacts fully", () => {
    const root = buildFileTree([file("a/b/c/d/e/f.txt")]);
    expect(root.children.length).toBe(1);
    expect(root.children[0].name).toBe("a/b/c/d/e");
    expect(root.children[0].children.length).toBe(1);
    expect(root.children[0].children[0].name).toBe("f.txt");
  });

  test("file nodes have correct fullPath", () => {
    const root = buildFileTree([file("src/utils/date.ts")]);
    const dir = root.children[0]; // compacted "src/utils"
    const leaf = dir.children[0];
    expect(leaf.fullPath).toBe("src/utils/date.ts");
    expect(leaf.file?.path).toBe("src/utils/date.ts");
  });
});

// ── flattenFileTree ────────────────────────────────────────────────────

describe("flattenFileTree", () => {
  test("empty root returns no rows", () => {
    const root = buildFileTree([]);
    const rows = flattenFileTree(root, new Set());
    expect(rows).toEqual([]);
  });

  test("single file produces one row with correct connectors", () => {
    const root = buildFileTree([file("README.md")]);
    const rows = flattenFileTree(root, new Set());
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("README.md");
    expect(rows[0].prefix).toBe("");
    expect(rows[0].connector).toBe("└─ "); // last (only) child
    expect(rows[0].isDir).toBe(false);
    expect(rows[0].depth).toBe(0);
  });

  test("multiple root-level files get correct connectors", () => {
    const root = buildFileTree([file("a.txt"), file("b.txt"), file("c.txt")]);
    const rows = flattenFileTree(root, new Set());
    expect(rows.length).toBe(3);
    expect(rows[0].connector).toBe("├─ "); // not last
    expect(rows[1].connector).toBe("├─ "); // not last
    expect(rows[2].connector).toBe("└─ "); // last
    expect(rows[0].prefix).toBe("");
    expect(rows[1].prefix).toBe("");
    expect(rows[2].prefix).toBe("");
  });

  test("nested files get correct prefixes and depths", () => {
    const root = buildFileTree([file("src/a.ts"), file("src/b.ts")]);
    const rows = flattenFileTree(root, new Set());
    // Row 0: src/ directory (compacted)
    expect(rows[0].name).toBe("src/");
    expect(rows[0].isDir).toBe(true);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].prefix).toBe("");
    expect(rows[0].connector).toBe("└─ "); // only child of root

    // Row 1-2: files inside src/
    expect(rows[1].name).toBe("a.ts");
    expect(rows[1].depth).toBe(1);
    expect(rows[1].prefix).toBe("   "); // parent was last child → space
    expect(rows[1].connector).toBe("├─ ");

    expect(rows[2].name).toBe("b.ts");
    expect(rows[2].depth).toBe(1);
    expect(rows[2].prefix).toBe("   ");
    expect(rows[2].connector).toBe("└─ ");
  });

  test("sibling directories produce │ continuation prefix", () => {
    const root = buildFileTree([file("src/a.ts"), file("lib/b.ts")]);
    const rows = flattenFileTree(root, new Set());
    // lib/ (first dir alphabetically), then src/
    expect(rows[0].name).toBe("lib/");
    expect(rows[0].connector).toBe("├─ "); // not last
    expect(rows[1].name).toBe("b.ts");
    expect(rows[1].prefix).toBe("│  "); // parent was NOT last → │
    expect(rows[1].connector).toBe("└─ ");

    expect(rows[2].name).toBe("src/");
    expect(rows[2].connector).toBe("└─ "); // last
    expect(rows[3].name).toBe("a.ts");
    expect(rows[3].prefix).toBe("   "); // parent was last → space
  });

  test("collapsing a directory hides its children", () => {
    const root = buildFileTree([file("src/a.ts"), file("src/b.ts")]);
    // Collapse the src/ directory
    const srcPath = root.children[0].fullPath;
    const rows = flattenFileTree(root, new Set([srcPath]));
    // Only the dir row should appear, not the files inside
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("src/");
    expect(rows[0].isDir).toBe(true);
  });

  test("collapsing one dir doesn't affect sibling dirs", () => {
    const root = buildFileTree([file("src/a.ts"), file("lib/b.ts")]);
    // Collapse only lib/
    const libPath = root.children[0].fullPath; // lib comes first alphabetically
    const rows = flattenFileTree(root, new Set([libPath]));
    // lib/ row (collapsed, no children), src/ row, a.ts row
    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("lib/");
    expect(rows[0].isDir).toBe(true);
    expect(rows[1].name).toBe("src/");
    expect(rows[1].isDir).toBe(true);
    expect(rows[2].name).toBe("a.ts");
  });

  test("directory row has correct dirPath", () => {
    const root = buildFileTree([file("src/utils/date.ts"), file("src/utils/file-tree.ts")]);
    const rows = flattenFileTree(root, new Set());
    // Compacted: src/utils/ dir
    const dirRow = rows[0];
    expect(dirRow.isDir).toBe(true);
    expect(dirRow.dirPath).toBe(root.children[0].fullPath);
  });

  test("file row has parent dir as dirPath", () => {
    const root = buildFileTree([file("src/a.ts"), file("src/b.ts")]);
    const rows = flattenFileTree(root, new Set());
    const fileRow = rows[1]; // a.ts
    expect(fileRow.isDir).toBe(false);
    // dirPath for files = parent dir's fullPath
    expect(fileRow.dirPath).toBe(root.children[0].fullPath);
  });

  test("deeply nested tree produces correct multi-level prefixes", () => {
    const root = buildFileTree([file("a/x.ts"), file("a/b/y.ts"), file("a/b/z.ts")]);
    const rows = flattenFileTree(root, new Set());
    // a/ dir (not last since it's only child → last)
    expect(rows[0].name).toBe("a/");
    expect(rows[0].depth).toBe(0);

    // b/ dir inside a/
    expect(rows[1].name).toBe("b/");
    expect(rows[1].depth).toBe(1);

    // x.ts at depth 1 (sibling of b/)
    // Due to sorting: dirs before files → b/ comes before x.ts
    const xRow = rows.find(r => r.name === "x.ts");
    expect(xRow).toBeDefined();
    expect(xRow?.depth).toBe(1);

    // y.ts and z.ts at depth 2
    const yRow = rows.find(r => r.name === "y.ts");
    const zRow = rows.find(r => r.name === "z.ts");
    expect(yRow?.depth).toBe(2);
    expect(zRow?.depth).toBe(2);
  });

  test("file rows carry the FileChange object", () => {
    const fc = file("src/a.ts", "A");
    const root = buildFileTree([fc]);
    const rows = flattenFileTree(root, new Set());
    const fileRow = rows.find(r => !r.isDir);
    expect(fileRow).toBeDefined();
    expect(fileRow?.file?.path).toBe("src/a.ts");
    expect(fileRow?.file?.status).toBe("A");
  });

  test("directory rows do not carry a FileChange object", () => {
    const root = buildFileTree([file("src/a.ts"), file("src/b.ts")]);
    const rows = flattenFileTree(root, new Set());
    const dirRow = rows.find(r => r.isDir);
    expect(dirRow).toBeDefined();
    expect(dirRow?.file).toBeUndefined();
  });

  test("large tree with many files produces correct row count", () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`src/file${String(i).padStart(2, "0")}.ts`));
    const root = buildFileTree(files);
    const rows = flattenFileTree(root, new Set());
    // 1 dir (src/) + 10 files = 11 rows
    expect(rows.length).toBe(11);
    expect(rows[0].isDir).toBe(true);
    expect(rows.filter(r => !r.isDir).length).toBe(10);
  });
});
