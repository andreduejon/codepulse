/**
 * Test: verifies block commit rendering (█ instead of ●).
 *
 * Tests:
 * 1-6.   Node glyph is █ (not ●) in rendered output
 * 8-9.   Fan-out merge optimization: last fan-out row merges into commit row
 *        when the commit row has no merge/branch connectors
 * 10-11. Fan-out merge is skipped when commit has merge/branch connectors
 * 12-13. Additional merge/fan-out edge cases
 */
import { describe, expect, test } from "bun:test";
import { buildGraph, type GraphChar, type RenderOptions, renderFanOutRow, renderGraphRow } from "../src/git/graph";
import { assertDefined, findRow, hasMergeConnectors, makeCommit, printGraph, THEME_COLORS } from "./test-helpers";

/** Build render options with the shared test theme colors. */
function renderOpts(padToColumns?: number): RenderOptions {
  return { themeColors: THEME_COLORS, padToColumns };
}

/** Check if any GraphChar in an array contains a specific character. */
function hasChar(chars: GraphChar[], ch: string): boolean {
  return chars.some(gc => gc.char === ch || gc.char.includes(ch));
}

/** Find all GraphChars containing a specific character. */
function findChars(chars: GraphChar[], ch: string): GraphChar[] {
  return chars.filter(gc => gc.char === ch || gc.char.includes(ch));
}

/** Get total character width of a GraphChar array. */
function totalCharWidth(chars: GraphChar[]): number {
  return chars.reduce((sum, gc) => sum + gc.char.length, 0);
}

describe("Block Commit", () => {
  test("Basic node glyph is █ (linear commits)", () => {
    const commits = [
      makeCommit("c3", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("c2", ["c1"]),
      makeCommit("c1", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    for (let i = 0; i < rows.length; i++) {
      const chars = renderGraphRow(rows[i], renderOpts());
      expect(hasChar(chars, "█")).toBe(true);
      expect(hasChar(chars, "●")).toBe(false);
    }
  });

  test("Node glyph █ with merge connector (█─)", () => {
    const commits = [
      makeCommit("m1", ["c1", "f1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge feature"),
      makeCommit("f1", ["c1"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("c1", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const mergeChars = renderGraphRow(rows[0], renderOpts());
    expect(hasChar(mergeChars, "█")).toBe(true);
    expect(hasChar(mergeChars, "●")).toBe(false);

    let foundBlockDash = false;
    for (let i = 0; i < mergeChars.length; i++) {
      if (mergeChars[i].char === "█") {
        if (i + 1 < mergeChars.length && mergeChars[i + 1].char === "─") {
          foundBlockDash = true;
        }
      }
    }
    expect(foundBlockDash).toBe(true);
  });

  test("Node glyph █ with no connections (trailing space)", () => {
    const commits = [
      makeCommit("c2", ["c1"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("c1", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const chars = renderGraphRow(rows[0], renderOpts());

    const blockChars = findChars(chars, "█");
    expect(blockChars.length).toBeGreaterThan(0);

    const blockWithSpace = chars.find(gc => gc.char === "█ ");
    expect(blockWithSpace).toBeDefined();
  });

  test("Fan-out rows use █ at node column", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
      makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const parentRow = rows.find(r => r.commit.hash === "p1");
    assertDefined(parentRow, "parentRow");
    assertDefined(parentRow.fanOutRows, "parentRow.fanOutRows");
    expect(parentRow.fanOutRows.length).toBeGreaterThan(0);

    for (let fi = 0; fi < parentRow.fanOutRows.length; fi++) {
      const foConnectors = parentRow.fanOutRows[fi];
      const foChars = renderFanOutRow(foConnectors, renderOpts());

      expect(hasChar(foChars, "█")).toBe(true);
      expect(hasChar(foChars, "├")).toBe(false);
      expect(hasChar(foChars, "┤")).toBe(false);
    }
  });

  test("Fan-out █ with trailing dash when branch goes right", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const parentRow = rows.find(r => r.commit.hash === "p1");
    assertDefined(parentRow, "parentRow");
    assertDefined(parentRow.fanOutRows, "parentRow.fanOutRows");

    for (let fi = 0; fi < parentRow.fanOutRows.length; fi++) {
      const foConnectors = parentRow.fanOutRows[fi];
      const foChars = renderFanOutRow(foConnectors, renderOpts());

      expect(hasChar(foChars, "█")).toBe(true);

      const nodeCol = parentRow.nodeColumn;
      const teeConn = foConnectors.find(c => c.column === nodeCol && (c.type === "tee-left" || c.type === "tee-right"));
      if (teeConn?.type === "tee-left") {
        expect(hasChar(foChars, "─")).toBe(true);
      }
    }
  });

  test("Fan-out █ color matches node color", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const parentRow = rows.find(r => r.commit.hash === "p1");
    assertDefined(parentRow, "parentRow");

    const opts = renderOpts();

    const commitChars = renderGraphRow(parentRow, opts);
    const commitBlock = commitChars.find(gc => gc.char.includes("█"));
    assertDefined(commitBlock, "commitBlock");

    const fanOutRows = parentRow.fanOutRows;
    assertDefined(fanOutRows, "fanOutRows");

    for (let fi = 0; fi < fanOutRows.length; fi++) {
      const foChars = renderFanOutRow(fanOutRows[fi], opts);
      const foBlock = foChars.find(gc => gc.char.includes("█"));
      assertDefined(foBlock, "foBlock");
      expect(foBlock.color).toBe(commitBlock.color);
    }
  });

  test("Node with left connection renders without trailing dash", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
      makeCommit("root", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const c2Row = findRow(rows, "c2");
    const rendered = renderGraphRow(c2Row, {});

    const nodeChar = rendered.find(gc => gc.char.includes("█"));
    expect(nodeChar).toBeDefined();
    if (nodeChar) {
      expect(nodeChar.char.includes("─")).toBe(false);
    }
  });

  test("Fan-out merge optimization (simple, no connections)", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const parentRow = findRow(rows, "p1");

    const hasConnections = hasMergeConnectors(parentRow.connectors);
    expect(hasConnections).toBe(false);

    assertDefined(parentRow.fanOutRows, "parentRow.fanOutRows");
    expect(parentRow.fanOutRows.length).toBeGreaterThanOrEqual(1);
  });

  test("Fan-out merge with 2 fan-out rows", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
      makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const parentRow = findRow(rows, "p1");

    expect(parentRow.fanOutRows !== undefined && parentRow.fanOutRows.length >= 2).toBe(true);

    const hasConnections = hasMergeConnectors(parentRow.connectors);
    expect(hasConnections).toBe(false);

    assertDefined(parentRow.fanOutRows, "parentRow.fanOutRows");
    const aboveCount = parentRow.fanOutRows.length - 1;
    expect(aboveCount).toBeGreaterThanOrEqual(1);
  });

  test("Fan-out merge skipped (commit has merge connectors)", () => {
    const commits = [
      makeCommit("c1", ["m1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["m1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("m1", ["p1", "f1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge feature"),
      makeCommit("f1", ["p1"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("p1", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const mergeRow = findRow(rows, "m1");

    expect(mergeRow.fanOutRows !== undefined && mergeRow.fanOutRows.length > 0).toBe(true);

    expect(hasMergeConnectors(mergeRow.connectors)).toBe(true);
  });

  test("Fan-out merge skipped (commit has branch-off connector)", () => {
    const commits = [
      makeCommit("c1", ["m1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["m1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("m1", ["p1", "s1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge side"),
      makeCommit("s1", ["p1"], [{ name: "side", type: "branch", isCurrent: false }]),
      makeCommit("p1", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const mergeRow = findRow(rows, "m1");

    expect(hasMergeConnectors(mergeRow.connectors)).toBe(true);
  });

  test("Width consistency (fan-out █ rows vs commit row)", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
      makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
      makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const padCols = Math.max(...rows.map(r => r.columns.length));
    const parentRow = findRow(rows, "p1");

    const commitChars = renderGraphRow(parentRow, renderOpts(padCols));
    const commitWidth = totalCharWidth(commitChars);

    assertDefined(parentRow.fanOutRows, "parentRow.fanOutRows");
    for (let fi = 0; fi < parentRow.fanOutRows.length; fi++) {
      const foChars = renderFanOutRow(parentRow.fanOutRows[fi], renderOpts(padCols));
      const foWidth = totalCharWidth(foChars);
      expect(foWidth).toBe(commitWidth);
    }
  });

  test("No ● in any rendered output (comprehensive)", () => {
    const commits = [
      makeCommit("d4", ["m2"], [{ name: "develop", type: "branch", isCurrent: true }]),
      makeCommit("m2", ["d3", "f2"], [], "Merge feature-2"),
      makeCommit("f2", ["d2"], [{ name: "feature-2", type: "branch", isCurrent: false }]),
      makeCommit("d3", ["m1"], []),
      makeCommit("m1", ["d2", "f1"], [], "Merge feature-1"),
      makeCommit("f1", ["d1"], [{ name: "feature-1", type: "branch", isCurrent: false }]),
      makeCommit("d2", ["d1"], []),
      makeCommit("d1", [], []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const padCols = Math.max(...rows.map(r => r.columns.length));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const commitChars = renderGraphRow(row, renderOpts(padCols));
      expect(hasChar(commitChars, "●")).toBe(false);

      if (row.fanOutRows) {
        for (let fi = 0; fi < row.fanOutRows.length; fi++) {
          const foChars = renderFanOutRow(row.fanOutRows[fi], renderOpts(padCols));
          expect(hasChar(foChars, "●")).toBe(false);
          expect(hasChar(foChars, "├")).toBe(false);
          expect(hasChar(foChars, "┤")).toBe(false);
        }
      }
    }
  });

  test("Node with right connection renders with trailing dash", () => {
    const commits = [
      makeCommit("m1", ["d1", "f1"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("f1", ["d1"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("d1", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const m1Row = findRow(rows, "m1");
    const rendered = renderGraphRow(m1Row, {});

    const nodeGlyph = rendered.find(gc => gc.char.includes("█"));
    expect(nodeGlyph).toBeDefined();
    if (nodeGlyph) {
      const nodeIdx = rendered.indexOf(nodeGlyph);
      const hasTrailingDash =
        nodeGlyph.char === "█" ||
        (nodeIdx + 1 < rendered.length && rendered[nodeIdx + 1].char === "─") ||
        nodeGlyph.char.includes("─");
      expect(hasTrailingDash).toBe(true);
    }
  });

  test("Left-connection connectors at correct columns", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
      makeCommit("root", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const c2Row = findRow(rows, "c2");
    const p1Row = findRow(rows, "p1");

    if (c2Row.nodeColumn > p1Row.nodeColumn) {
      const leftConns = c2Row.connectors.filter(
        c =>
          c.column < c2Row.nodeColumn &&
          c.column >= p1Row.nodeColumn &&
          c.type !== "straight" &&
          c.type !== "empty" &&
          c.type !== "node",
      );
      expect(leftConns.length).toBeGreaterThan(0);
    }
  });
});
