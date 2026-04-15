import { describe, expect, test } from "bun:test";
import {
  buildDisplayLines,
  buildGutter,
  buildRowOffsets,
  computeDiffStats,
  type DisplayLineKind,
  diffLineBg,
  diffLineColor,
  diffLinePrefix,
  expandWithContinuations,
  findLineAtRow,
  formatHunkHeader,
  gutterWidth,
  padLineNo,
} from "../src/components/dialogs/diff-utils";
import { parseBlameOutput, parseUnifiedDiff } from "../src/git/repo";

describe("parseUnifiedDiff", () => {
  test("parses a simple single-hunk diff", () => {
    const stdout = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,7 @@ function main() {
   const a = 1;
   const b = 2;
+  const c = 3;
   return a + b;
 }
 
`;
    const result = parseUnifiedDiff(stdout, "src/app.ts");

    expect(result.filePath).toBe("src/app.ts");
    expect(result.isBinary).toBe(false);
    expect(result.hunks).toHaveLength(1);

    const hunk = result.hunks[0];
    expect(hunk.oldStart).toBe(10);
    expect(hunk.oldCount).toBe(6);
    expect(hunk.newStart).toBe(10);
    expect(hunk.newCount).toBe(7);
    expect(hunk.header).toContain("@@ -10,6 +10,7 @@");

    // 2 context + 1 add + 1 context + empty context + empty context
    const addLines = hunk.lines.filter(l => l.type === "add");
    expect(addLines).toHaveLength(1);
    expect(addLines[0].content).toBe("  const c = 3;");
    expect(addLines[0].newLineNo).toBe(12);

    const contextLines = hunk.lines.filter(l => l.type === "context");
    expect(contextLines.length).toBeGreaterThanOrEqual(2);
    expect(contextLines[0].content).toBe("  const a = 1;");
    expect(contextLines[0].oldLineNo).toBe(10);
    expect(contextLines[0].newLineNo).toBe(10);
  });

  test("parses a diff with additions and deletions", () => {
    const stdout = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,4 +1,4 @@
 line1
-old line2
+new line2
 line3
 line4
`;
    const result = parseUnifiedDiff(stdout, "file.txt");

    expect(result.hunks).toHaveLength(1);
    const hunk = result.hunks[0];

    const delLines = hunk.lines.filter(l => l.type === "delete");
    expect(delLines).toHaveLength(1);
    expect(delLines[0].content).toBe("old line2");
    expect(delLines[0].oldLineNo).toBe(2);

    const addLines = hunk.lines.filter(l => l.type === "add");
    expect(addLines).toHaveLength(1);
    expect(addLines[0].content).toBe("new line2");
    expect(addLines[0].newLineNo).toBe(2);
  });

  test("parses multi-hunk diff", () => {
    const stdout = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
@@ -10,3 +11,4 @@ function foo() {
 line10
+another
 line11
 line12
`;
    const result = parseUnifiedDiff(stdout, "file.txt");

    expect(result.hunks).toHaveLength(2);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[0].newStart).toBe(1);
    expect(result.hunks[1].oldStart).toBe(10);
    expect(result.hunks[1].newStart).toBe(11);

    expect(result.hunks[0].lines.filter(l => l.type === "add")).toHaveLength(1);
    expect(result.hunks[1].lines.filter(l => l.type === "add")).toHaveLength(1);
  });

  test("detects binary files", () => {
    const stdout = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`;
    const result = parseUnifiedDiff(stdout, "image.png");

    expect(result.isBinary).toBe(true);
    expect(result.hunks).toHaveLength(0);
  });

  test("handles empty output", () => {
    const result = parseUnifiedDiff("", "empty.txt");

    expect(result.filePath).toBe("empty.txt");
    expect(result.isBinary).toBe(false);
    expect(result.hunks).toHaveLength(0);
  });

  test("handles hunk with count=1 implicit (no comma)", () => {
    const stdout = `diff --git a/new.txt b/new.txt
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+single line
`;
    const result = parseUnifiedDiff(stdout, "new.txt");

    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldStart).toBe(0);
    expect(result.hunks[0].oldCount).toBe(0);
    expect(result.hunks[0].newStart).toBe(1);
    expect(result.hunks[0].newCount).toBe(1);
    expect(result.hunks[0].lines).toHaveLength(1);
    expect(result.hunks[0].lines[0].type).toBe("add");
    expect(result.hunks[0].lines[0].content).toBe("single line");
  });

  test("handles 'No newline at end of file' marker", () => {
    const stdout = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 line1
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const result = parseUnifiedDiff(stdout, "file.txt");

    expect(result.hunks).toHaveLength(1);
    // The backslash lines should be skipped
    const allTypes = result.hunks[0].lines.map(l => l.type);
    expect(allTypes).toEqual(["context", "delete", "add"]);
  });

  test("correctly tracks line numbers across add/delete sequences", () => {
    const stdout = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -5,7 +5,8 @@ header
 ctx1
-del1
-del2
+add1
+add2
+add3
 ctx2
 ctx3
`;
    const result = parseUnifiedDiff(stdout, "file.txt");

    expect(result.hunks).toHaveLength(1);
    const hunk = result.hunks[0];

    // ctx1: old=5, new=5
    expect(hunk.lines[0]).toEqual({
      type: "context",
      content: "ctx1",
      oldLineNo: 5,
      newLineNo: 5,
    });
    // del1: old=6
    expect(hunk.lines[1]).toEqual({
      type: "delete",
      content: "del1",
      oldLineNo: 6,
    });
    // del2: old=7
    expect(hunk.lines[2]).toEqual({
      type: "delete",
      content: "del2",
      oldLineNo: 7,
    });
    // add1: new=6
    expect(hunk.lines[3]).toEqual({
      type: "add",
      content: "add1",
      newLineNo: 6,
    });
    // add2: new=7
    expect(hunk.lines[4]).toEqual({
      type: "add",
      content: "add2",
      newLineNo: 7,
    });
    // add3: new=8
    expect(hunk.lines[5]).toEqual({
      type: "add",
      content: "add3",
      newLineNo: 8,
    });
    // ctx2: old=8, new=9
    expect(hunk.lines[6]).toEqual({
      type: "context",
      content: "ctx2",
      oldLineNo: 8,
      newLineNo: 9,
    });
  });

  test("new file diff (--- /dev/null)", () => {
    const stdout = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,3 @@
+line1
+line2
+line3
`;
    const result = parseUnifiedDiff(stdout, "new.txt");

    expect(result.isBinary).toBe(false);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldStart).toBe(0);
    expect(result.hunks[0].oldCount).toBe(0);
    expect(result.hunks[0].newStart).toBe(1);
    expect(result.hunks[0].newCount).toBe(3);
    expect(result.hunks[0].lines).toHaveLength(3);
    expect(result.hunks[0].lines.every(l => l.type === "add")).toBe(true);
  });

  test("deleted file diff (+++ /dev/null)", () => {
    const stdout = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index abc1234..0000000
--- a/old.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2
-line3
`;
    const result = parseUnifiedDiff(stdout, "old.txt");

    expect(result.isBinary).toBe(false);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[0].oldCount).toBe(3);
    expect(result.hunks[0].newStart).toBe(0);
    expect(result.hunks[0].newCount).toBe(0);
    expect(result.hunks[0].lines).toHaveLength(3);
    expect(result.hunks[0].lines.every(l => l.type === "delete")).toBe(true);
  });

  test("sets truncated flag when diff exceeds 5000 lines", () => {
    // Build a diff with 6000 add lines (well over MAX_DIFF_LINES = 5000)
    const addLines = Array.from({ length: 6000 }, (_, i) => `+line${i + 1}`).join("\n");
    const stdout = `diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -0,0 +1,6000 @@\n${addLines}\n`;
    const result = parseUnifiedDiff(stdout, "big.txt");

    // Should have capped at 5000 stored lines
    const storedLines = result.hunks.flatMap(h => h.lines).length;
    expect(storedLines).toBe(5000);

    // truncated flag should be set
    expect(result.truncated).toBe(true);
  });

  test("does not set truncated flag for diffs under the limit", () => {
    const stdout = `diff --git a/small.txt b/small.txt\n--- a/small.txt\n+++ b/small.txt\n@@ -1,1 +1,2 @@\n context\n+added\n`;
    const result = parseUnifiedDiff(stdout, "small.txt");
    expect(result.truncated).toBeUndefined();
  });
});

describe("parseBlameOutput", () => {
  test("parses a simple blame output", () => {
    const stdout = `abc123456789012345678901234567890123abc0 1 1 3
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary Initial commit
filename file.txt
\tline one content
abc123456789012345678901234567890123abc0 2 2
\tline two content
abc123456789012345678901234567890123abc0 3 3
\tline three content
`;
    const result = parseBlameOutput(stdout);

    expect(result).toHaveLength(3);

    expect(result[0].commitHash).toBe("abc123456789012345678901234567890123abc0");
    expect(result[0].shortHash).toBe("abc1234");
    expect(result[0].author).toBe("Alice");
    expect(result[0].lineNo).toBe(1);
    expect(result[0].content).toBe("line one content");

    expect(result[1].lineNo).toBe(2);
    expect(result[1].content).toBe("line two content");
    // Subsequent lines from the same commit may not repeat author
    // (git blame --porcelain only shows full headers for first occurrence)

    expect(result[2].lineNo).toBe(3);
    expect(result[2].content).toBe("line three content");
  });

  test("parses blame with multiple commits", () => {
    const stdout = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Alice
filename file.txt
\tfirst line
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 2
author Bob
filename file.txt
\tsecond line
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 3 3
\tthird line
`;
    const result = parseBlameOutput(stdout);

    expect(result).toHaveLength(3);
    expect(result[0].author).toBe("Alice");
    expect(result[0].commitHash).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    expect(result[1].author).toBe("Bob");
    expect(result[1].commitHash).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result[1].lineNo).toBe(2);

    // Third line is from same commit as second, but in porcelain format
    // the author is only listed on first occurrence
    expect(result[2].commitHash).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result[2].lineNo).toBe(3);
  });

  test("handles empty output", () => {
    expect(parseBlameOutput("")).toEqual([]);
    expect(parseBlameOutput("  \n  ")).toEqual([]);
  });

  test("handles tab in content", () => {
    const stdout = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Dev
filename main.ts
\t\tindented with tab
`;
    const result = parseBlameOutput(stdout);

    expect(result).toHaveLength(1);
    // The leading tab is stripped (porcelain format), but the content tab remains
    expect(result[0].content).toBe("\tindented with tab");
  });

  test("handles empty content lines", () => {
    const stdout = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Dev
filename file.txt
\t
`;
    const result = parseBlameOutput(stdout);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("");
  });
});

describe("formatHunkHeader", () => {
  test("formats a standard hunk header with both ranges", () => {
    const result = formatHunkHeader("@@ -5,6 +12,8 @@");
    expect(result).toBe("Lines 5\u201310 \u2192 12\u201319");
  });

  test("includes function context when present", () => {
    const result = formatHunkHeader("@@ -10,6 +10,7 @@ function main() {");
    expect(result).toBe("Lines 10\u201315 \u2192 10\u201316 \u00b7 function main() {");
  });

  test("handles count of 1 (single line)", () => {
    const result = formatHunkHeader("@@ -3,1 +3,1 @@");
    expect(result).toBe("Lines 3 \u2192 3");
  });

  test("handles implicit count of 1 (no comma)", () => {
    const result = formatHunkHeader("@@ -3 +3 @@");
    expect(result).toBe("Lines 3 \u2192 3");
  });

  test("handles count of 0 (empty range)", () => {
    const result = formatHunkHeader("@@ -5,0 +5,2 @@");
    expect(result).toBe("Lines (none) \u2192 5\u20136");
  });

  test("falls back to raw string for unparseable input", () => {
    const raw = "not a hunk header";
    expect(formatHunkHeader(raw)).toBe(raw);
  });
});

// ── Windowed rendering helpers ────────────────────────────────────────

function dl(kind: DisplayLineKind): { kind: DisplayLineKind } {
  return { kind };
}

describe("buildRowOffsets", () => {
  test("empty array produces single zero entry", () => {
    const offsets = buildRowOffsets([]);
    expect(offsets).toEqual([0]);
  });

  test("all regular lines (height 1 each)", () => {
    const lines = [dl("context"), dl("add"), dl("delete"), dl("hunk-header")];
    const offsets = buildRowOffsets(lines);
    expect(offsets).toEqual([0, 1, 2, 3, 4]);
  });

  test("spacer lines are 1 row", () => {
    const lines = [dl("context"), dl("spacer"), dl("add")];
    const offsets = buildRowOffsets(lines);
    // context=1row, spacer=1row, add=1row → [0, 1, 2, 3]
    expect(offsets).toEqual([0, 1, 2, 3]);
  });

  test("multiple spacers", () => {
    const lines = [dl("spacer"), dl("spacer")];
    const offsets = buildRowOffsets(lines);
    expect(offsets).toEqual([0, 1, 2]);
  });

  test("total row count is last element", () => {
    const lines = [dl("context"), dl("spacer"), dl("context"), dl("spacer"), dl("context")];
    const offsets = buildRowOffsets(lines);
    // 1 + 1 + 1 + 1 + 1 = 5
    expect(offsets[offsets.length - 1]).toBe(5);
  });
});

describe("findLineAtRow", () => {
  test("finds first line for row 0", () => {
    const offsets = buildRowOffsets([dl("context"), dl("add"), dl("delete")]);
    expect(findLineAtRow(offsets, 0)).toBe(0);
  });

  test("finds correct line for exact row boundary", () => {
    const offsets = buildRowOffsets([dl("context"), dl("add"), dl("delete")]);
    // Row 1 starts at line index 1
    expect(findLineAtRow(offsets, 1)).toBe(1);
    // Row 2 starts at line index 2
    expect(findLineAtRow(offsets, 2)).toBe(2);
  });

  test("finds line at spacer boundary", () => {
    // context(h=1), spacer(h=1), add(h=1) → offsets [0,1,2,3]
    const offsets = buildRowOffsets([dl("context"), dl("spacer"), dl("add")]);
    // Row 0 → line 0 (context)
    expect(findLineAtRow(offsets, 0)).toBe(0);
    // Row 1 → line 1 (spacer)
    expect(findLineAtRow(offsets, 1)).toBe(1);
    // Row 2 → line 2 (add)
    expect(findLineAtRow(offsets, 2)).toBe(2);
  });

  test("clamps to last line for row beyond total", () => {
    const offsets = buildRowOffsets([dl("context"), dl("add")]);
    // Total is 2 rows, asking for row 10 → last line index (1)
    expect(findLineAtRow(offsets, 10)).toBe(1);
  });

  test("works with single line", () => {
    const offsets = buildRowOffsets([dl("add")]);
    expect(findLineAtRow(offsets, 0)).toBe(0);
  });

  test("works with large array", () => {
    const lines: { kind: DisplayLineKind }[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(dl(i % 10 === 0 ? "spacer" : "context"));
    }
    const offsets = buildRowOffsets(lines);
    // Verify a few known positions
    // First line is spacer (h=1), second is context (h=1)
    expect(findLineAtRow(offsets, 0)).toBe(0); // spacer at row 0
    expect(findLineAtRow(offsets, 1)).toBe(1); // context at row 1

    // Total rows: all kinds are 1 row each → 1000
    expect(offsets[offsets.length - 1]).toBe(1000);

    // Last line is context (index 999), starts at row 999
    expect(findLineAtRow(offsets, 999)).toBe(999);
  });
});

describe("computeDiffStats", () => {
  test("counts additions and deletions across a single hunk", () => {
    const stats = computeDiffStats([
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 4,
        header: "@@ -1,3 +1,4 @@",
        lines: [
          { type: "context", content: "a" },
          { type: "delete", content: "b" },
          { type: "add", content: "b2" },
          { type: "add", content: "b3" },
          { type: "context", content: "c" },
        ],
      },
    ]);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
  });

  test("counts across multiple hunks", () => {
    const stats = computeDiffStats([
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 2,
        header: "@@ -1,1 +1,2 @@",
        lines: [
          { type: "add", content: "new" },
          { type: "context", content: "x" },
        ],
      },
      {
        oldStart: 10,
        oldCount: 2,
        newStart: 11,
        newCount: 1,
        header: "@@ -10,2 +11,1 @@",
        lines: [
          { type: "delete", content: "old1" },
          { type: "delete", content: "old2" },
        ],
      },
    ]);
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(2);
  });

  test("returns zeros for empty hunk list", () => {
    const stats = computeDiffStats([]);
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  test("returns zeros for hunks with only context lines", () => {
    const stats = computeDiffStats([
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 2,
        header: "@@ -1,2 +1,2 @@",
        lines: [
          { type: "context", content: "a" },
          { type: "context", content: "b" },
        ],
      },
    ]);
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  test("pure addition (new file)", () => {
    const stats = computeDiffStats([
      {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 3,
        header: "@@ -0,0 +1,3 @@",
        lines: [
          { type: "add", content: "line1" },
          { type: "add", content: "line2" },
          { type: "add", content: "line3" },
        ],
      },
    ]);
    expect(stats.additions).toBe(3);
    expect(stats.deletions).toBe(0);
  });

  test("pure deletion (deleted file)", () => {
    const stats = computeDiffStats([
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 0,
        newCount: 0,
        header: "@@ -1,2 +0,0 @@",
        lines: [
          { type: "delete", content: "gone1" },
          { type: "delete", content: "gone2" },
        ],
      },
    ]);
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(2);
  });
});

describe("expandWithContinuations", () => {
  /** Build a minimal DisplayLine-like object for testing. */
  const line = (kind: DisplayLineKind, content: string) => ({ kind, content });

  test("zero-length content emits 1 row", () => {
    const result = expandWithContinuations([line("context", "")], 10);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("context");
  });

  test("content shorter than maxWidth emits 1 row", () => {
    const result = expandWithContinuations([line("add", "short")], 10);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("short");
  });

  test("content exactly fitting maxWidth emits 1 row", () => {
    const result = expandWithContinuations([line("delete", "1234567890")], 10);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("1234567890");
  });

  test("content 1 char over maxWidth emits 2 rows (1 real + 1 continuation)", () => {
    const result = expandWithContinuations([line("context", "12345678901")], 10);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("context");
    expect(result[0].content).toBe("1234567890");
    expect(result[1].kind).toBe("continuation");
    expect((result[1] as { originalKind: DisplayLineKind }).originalKind).toBe("context");
    expect(result[1].content).toBe("1");
  });

  test("content requiring 3 rows emits 1 real + 2 continuations", () => {
    const result = expandWithContinuations([line("add", "abcdefghijklmnopqrstu")], 7);
    // 21 chars / 7 = 3 rows exactly
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("abcdefg");
    expect(result[1].kind).toBe("continuation");
    expect(result[1].content).toBe("hijklmn");
    expect(result[2].kind).toBe("continuation");
    expect(result[2].content).toBe("opqrstu");
  });

  test("hunk-header is always 1 row regardless of length", () => {
    const longHeader = "@@ -1,100 +1,200 @@ ".padEnd(200, "x");
    const result = expandWithContinuations([line("hunk-header", longHeader)], 10);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("hunk-header");
  });

  test("spacer is always 1 row regardless of content", () => {
    const result = expandWithContinuations([line("spacer", "x".repeat(100))], 10);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("spacer");
  });

  test("mixed lines: short, long, hunk-header produces correct total rows", () => {
    const input = [
      line("hunk-header", "@@ -1,2 +1,2 @@"),
      line("context", "short"), // 1 row
      line("add", "a".repeat(25)), // 3 rows at width=10 (10+10+5)
      line("delete", "b".repeat(10)), // 1 row (exact fit)
    ];
    const result = expandWithContinuations(input, 10);
    // 1 (hunk-header) + 1 (context) + 3 (add expanded) + 1 (delete exact) = 6
    expect(result).toHaveLength(6);
    expect(result[0].kind).toBe("hunk-header");
    expect(result[1].kind).toBe("context");
    expect(result[2].kind).toBe("add");
    expect(result[3].kind).toBe("continuation");
    expect(result[4].kind).toBe("continuation");
    expect(result[5].kind).toBe("delete");
  });
});

// ── Gutter helpers ────────────────────────────────────────────────────

describe("gutterWidth", () => {
  test("width of 0 is 1 (string '0' has length 1)", () => {
    expect(gutterWidth(0)).toBe(1);
  });

  test("width of 9 is 1", () => {
    expect(gutterWidth(9)).toBe(1);
  });

  test("width of 10 is 2", () => {
    expect(gutterWidth(10)).toBe(2);
  });

  test("width of 99 is 2", () => {
    expect(gutterWidth(99)).toBe(2);
  });

  test("width of 100 is 3", () => {
    expect(gutterWidth(100)).toBe(3);
  });

  test("width of 1000 is 4", () => {
    expect(gutterWidth(1000)).toBe(4);
  });
});

describe("padLineNo", () => {
  test("pads single digit to width 3", () => {
    expect(padLineNo(5, 3)).toBe("  5");
  });

  test("exact width — no padding added", () => {
    expect(padLineNo(42, 2)).toBe("42");
  });

  test("returns spaces when lineNo is undefined", () => {
    expect(padLineNo(undefined, 4)).toBe("    ");
  });

  test("width 1, lineNo 1", () => {
    expect(padLineNo(1, 1)).toBe("1");
  });

  test("width 0 with defined value produces unpadded number string", () => {
    expect(padLineNo(7, 0)).toBe("7");
  });
});

describe("buildGutter", () => {
  test("both line numbers present", () => {
    const result = buildGutter({ oldLineNo: 3, newLineNo: 5 }, 2, 2);
    expect(result).toBe(" 3  5");
  });

  test("only old line number (delete line)", () => {
    const result = buildGutter({ oldLineNo: 10, newLineNo: undefined }, 2, 2);
    expect(result).toBe("10   ");
  });

  test("only new line number (add line)", () => {
    const result = buildGutter({ oldLineNo: undefined, newLineNo: 10 }, 2, 2);
    expect(result).toBe("   10");
  });

  test("neither line number (hunk header / spacer)", () => {
    // padLineNo(undefined, 3) + " " + padLineNo(undefined, 3) = "   " + " " + "   " = 7 spaces
    const result = buildGutter({ oldLineNo: undefined, newLineNo: undefined }, 3, 3);
    expect(result).toBe("       ");
  });

  test("asymmetric widths", () => {
    const result = buildGutter({ oldLineNo: 5, newLineNo: 123 }, 1, 3);
    expect(result).toBe("5 123");
  });
});

// ── Per-line style helpers ─────────────────────────────────────────────

const mockColors = {
  diffAdded: "#00ff00",
  diffRemoved: "#ff0000",
  accent: "#8888ff",
  foreground: "#ffffff",
  diffAddedBg: "#002200",
  diffRemovedBg: "#220000",
};

describe("diffLineColor", () => {
  test("add returns diffAdded color", () => {
    expect(diffLineColor("add", mockColors)).toBe("#00ff00");
  });

  test("delete returns diffRemoved color", () => {
    expect(diffLineColor("delete", mockColors)).toBe("#ff0000");
  });

  test("hunk-header returns accent color", () => {
    expect(diffLineColor("hunk-header", mockColors)).toBe("#8888ff");
  });

  test("context returns foreground color", () => {
    expect(diffLineColor("context", mockColors)).toBe("#ffffff");
  });

  test("spacer returns foreground color", () => {
    expect(diffLineColor("spacer", mockColors)).toBe("#ffffff");
  });

  test("continuation returns foreground color", () => {
    expect(diffLineColor("continuation", mockColors)).toBe("#ffffff");
  });
});

describe("diffLinePrefix", () => {
  test("add returns '+'", () => {
    expect(diffLinePrefix("add")).toBe("+");
  });

  test("delete returns '-'", () => {
    expect(diffLinePrefix("delete")).toBe("-");
  });

  test("context returns space", () => {
    expect(diffLinePrefix("context")).toBe(" ");
  });

  test("hunk-header returns empty string", () => {
    expect(diffLinePrefix("hunk-header")).toBe("");
  });

  test("spacer returns empty string", () => {
    expect(diffLinePrefix("spacer")).toBe("");
  });

  test("continuation returns empty string", () => {
    expect(diffLinePrefix("continuation")).toBe("");
  });
});

describe("diffLineBg", () => {
  test("add returns diffAddedBg", () => {
    expect(diffLineBg("add", mockColors)).toBe("#002200");
  });

  test("delete returns diffRemovedBg", () => {
    expect(diffLineBg("delete", mockColors)).toBe("#220000");
  });

  test("context returns undefined", () => {
    expect(diffLineBg("context", mockColors)).toBeUndefined();
  });

  test("hunk-header returns undefined", () => {
    expect(diffLineBg("hunk-header", mockColors)).toBeUndefined();
  });

  test("spacer returns undefined", () => {
    expect(diffLineBg("spacer", mockColors)).toBeUndefined();
  });

  test("continuation returns undefined", () => {
    expect(diffLineBg("continuation", mockColors)).toBeUndefined();
  });
});

// ── buildDisplayLines ─────────────────────────────────────────────────

describe("buildDisplayLines", () => {
  test("empty diff (no hunks) returns empty array", () => {
    const result = buildDisplayLines({ filePath: "f.ts", hunks: [], isBinary: false });
    expect(result).toHaveLength(0);
  });

  test("single-hunk diff produces spacer + header + lines + trailing spacer", () => {
    const result = buildDisplayLines({
      filePath: "f.ts",
      isBinary: false,
      hunks: [
        {
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 3,
          header: "@@ -1,2 +1,3 @@",
          lines: [
            { type: "context", content: "ctx", oldLineNo: 1, newLineNo: 1 },
            { type: "add", content: "new", newLineNo: 2 },
            { type: "context", content: "ctx2", oldLineNo: 2, newLineNo: 3 },
          ],
        },
      ],
    });

    // spacer + hunk-header + 3 lines + trailing spacer = 6
    expect(result).toHaveLength(6);
    expect(result[0].kind).toBe("spacer");
    expect(result[1].kind).toBe("hunk-header");
    expect(result[1].content).toBe("@@ -1,2 +1,3 @@");
    expect(result[2].kind).toBe("context");
    expect(result[2].content).toBe("ctx");
    expect(result[2].oldLineNo).toBe(1);
    expect(result[2].newLineNo).toBe(1);
    expect(result[3].kind).toBe("add");
    expect(result[3].content).toBe("new");
    expect(result[3].newLineNo).toBe(2);
    expect(result[5].kind).toBe("spacer");
  });

  test("two hunks produce two sets of spacer+header+lines, plus trailing spacer", () => {
    const result = buildDisplayLines({
      filePath: "f.ts",
      isBinary: false,
      hunks: [
        {
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 1,
          header: "@@ -1,1 +1,1 @@",
          lines: [{ type: "delete", content: "old", oldLineNo: 1 }],
        },
        {
          oldStart: 10,
          oldCount: 1,
          newStart: 10,
          newCount: 1,
          header: "@@ -10,1 +10,1 @@",
          lines: [{ type: "add", content: "new", newLineNo: 10 }],
        },
      ],
    });

    // hunk1: spacer + header + 1 line = 3
    // hunk2: spacer + header + 1 line = 3
    // trailing spacer: 1
    // total: 7
    expect(result).toHaveLength(7);
    expect(result[0].kind).toBe("spacer");
    expect(result[1].kind).toBe("hunk-header");
    expect(result[2].kind).toBe("delete");
    expect(result[3].kind).toBe("spacer");
    expect(result[4].kind).toBe("hunk-header");
    expect(result[5].kind).toBe("add");
    expect(result[6].kind).toBe("spacer");
  });
});
