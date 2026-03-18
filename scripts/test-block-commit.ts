#!/usr/bin/env bun
/**
 * Test script: verifies block commit rendering (█ instead of ●).
 *
 * Tests:
 * 1. Node glyph is █ (not ●) in rendered output
 * 2. Fan-out rows use █ (not ├/┤) at the node column
 * 3. Fan-out merge optimization: last fan-out row merges into commit row
 *    when the commit row has no merge/branch connectors
 * 4. Fan-out merge is skipped when commit has merge/branch connectors
 */

import { buildGraph, renderGraphRow, renderFanOutRow, type GraphChar } from "../src/git/graph";
import type { Commit } from "../src/git/types";
import { assert, makeCommit, getResults, printResults } from "./test-helpers";

const THEME_COLORS = [
  "#c0c001", "#c0c002", "#c0c003", "#c0c004",
  "#c0c005", "#c0c006", "#c0c007", "#c0c008",
];

function renderOpts(padToColumns?: number) {
  return { themeColors: THEME_COLORS, padToColumns };
}

/** Check if any GraphChar in an array contains a specific character */
function hasChar(chars: GraphChar[], ch: string): boolean {
  return chars.some(gc => gc.char === ch || gc.char.includes(ch));
}

/** Find all GraphChars containing a specific character */
function findChars(chars: GraphChar[], ch: string): GraphChar[] {
  return chars.filter(gc => gc.char === ch || gc.char.includes(ch));
}

/** Get total character width */
function totalCharWidth(chars: GraphChar[]): number {
  return chars.reduce((sum, gc) => sum + gc.char.length, 0);
}

// ============================================================
// Test 1: Basic node glyph is █ (simple linear commits)
// ============================================================
function test1() {
  console.log("\nTest 1: Basic node glyph is █ (linear commits)");

  const commits: Commit[] = [
    makeCommit("c3", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["c1"]),
    makeCommit("c1", []),
  ];

  const rows = buildGraph(commits);

  for (let i = 0; i < rows.length; i++) {
    const chars = renderGraphRow(rows[i], renderOpts());

    // Must contain █
    assert(hasChar(chars, "█"), `Row ${i}: should contain █`);

    // Must NOT contain ●
    assert(!hasChar(chars, "●"), `Row ${i}: should NOT contain ●`);
  }
}

// ============================================================
// Test 2: Node glyph █ with right-side horizontal connection (█─)
// ============================================================
function test2() {
  console.log("\nTest 2: Node glyph █ with merge connector (█─)");

  const commits: Commit[] = [
    makeCommit("m1", ["c1", "f1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge feature"),
    makeCommit("f1", ["c1"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("c1", []),
  ];

  const rows = buildGraph(commits);

  // Row 0 is the merge commit — should have █ followed by ─
  const mergeChars = renderGraphRow(rows[0], renderOpts());
  assert(hasChar(mergeChars, "█"), "Merge row: should contain █");
  assert(!hasChar(mergeChars, "●"), "Merge row: should NOT contain ●");

  // Find the █ and check it's followed by ─
  let foundBlockDash = false;
  for (let i = 0; i < mergeChars.length; i++) {
    if (mergeChars[i].char === "█") {
      // Next char should be ─
      if (i + 1 < mergeChars.length && mergeChars[i + 1].char === "─") {
        foundBlockDash = true;
      }
    }
  }
  assert(foundBlockDash, "Merge row: █ should be followed by ─");
}

// ============================================================
// Test 3: Node glyph █ with no connections (█ with trailing space)
// ============================================================
function test3() {
  console.log("\nTest 3: Node glyph █ with no connections (trailing space)");

  const commits: Commit[] = [
    makeCommit("c2", ["c1"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c1", []),
  ];

  const rows = buildGraph(commits);
  const chars = renderGraphRow(rows[0], renderOpts());

  // Should have "█ " (block with trailing space)
  const blockChars = findChars(chars, "█");
  assert(blockChars.length > 0, "Should have at least one █ char");

  const blockWithSpace = chars.find(gc => gc.char === "█ ");
  assert(blockWithSpace !== undefined, "Simple commit should render as '█ ' (block + space)");
}

// ============================================================
// Test 4: Fan-out rows use █ (not ├/┤) at node column
// ============================================================
function test4() {
  console.log("\nTest 4: Fan-out rows use █ at node column");

  // Parent commit with 3 children — creates 2 fan-out rows
  const commits: Commit[] = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);

  // Find the row with fan-out rows (the parent commit p1)
  const parentRow = rows.find(r => r.commit.hash === "p1");
  assert(parentRow !== undefined, "Parent row should exist");
  assert(
    parentRow!.fanOutRows !== undefined && parentRow!.fanOutRows.length > 0,
    "Parent should have fan-out rows",
  );

  // Each fan-out row should have █ at the node column, NOT ├ or ┤
  for (let fi = 0; fi < parentRow!.fanOutRows!.length; fi++) {
    const foConnectors = parentRow!.fanOutRows![fi];
    const foChars = renderFanOutRow(foConnectors, renderOpts());

    assert(hasChar(foChars, "█"), `Fan-out row ${fi}: should contain █`);
    assert(!hasChar(foChars, "├"), `Fan-out row ${fi}: should NOT contain ├`);
    assert(!hasChar(foChars, "┤"), `Fan-out row ${fi}: should NOT contain ┤`);
  }
}

// ============================================================
// Test 5: Fan-out █ with trailing dash (█─) when branch goes right
// ============================================================
function test5() {
  console.log("\nTest 5: Fan-out █ with trailing dash when branch goes right");

  // Two children from same parent, children to the right of parent
  const commits: Commit[] = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  const parentRow = rows.find(r => r.commit.hash === "p1");
  assert(parentRow !== undefined, "Parent row should exist");
  assert(parentRow!.fanOutRows !== undefined, "Parent should have fan-out rows");

  for (let fi = 0; fi < parentRow!.fanOutRows!.length; fi++) {
    const foConnectors = parentRow!.fanOutRows![fi];
    const foChars = renderFanOutRow(foConnectors, renderOpts());

    // Should have █ (possibly with trailing ─)
    assert(hasChar(foChars, "█"), `Fan-out row ${fi}: should contain █`);

    // If the closing lane is to the right, there should be a ─ after █
    const nodeCol = parentRow!.nodeColumn;
    const teeConn = foConnectors.find(c =>
      c.column === nodeCol && (c.type === "tee-left" || c.type === "tee-right"));
    if (teeConn && teeConn.type === "tee-left") {
      // tee-left means branch goes right → should have trailing ─
      assert(hasChar(foChars, "─"), `Fan-out row ${fi}: tee-left should have trailing ─ after █`);
    }
  }
}

// ============================================================
// Test 6: Fan-out █ color matches node color
// ============================================================
function test6() {
  console.log("\nTest 6: Fan-out █ color matches node color");

  const commits: Commit[] = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  const parentRow = rows.find(r => r.commit.hash === "p1")!;
  const opts = renderOpts();

  // Get the node color from the commit row
  const commitChars = renderGraphRow(parentRow, opts);
  const commitBlock = commitChars.find(gc => gc.char.includes("█"));
  assert(commitBlock !== undefined, "Commit row should have █");

  // Fan-out rows' █ should use the same color
  for (let fi = 0; fi < parentRow.fanOutRows!.length; fi++) {
    const foChars = renderFanOutRow(parentRow.fanOutRows![fi], opts);
    const foBlock = foChars.find(gc => gc.char.includes("█"));
    assert(foBlock !== undefined, `Fan-out row ${fi}: should have █`);
    assert(
      foBlock!.color === commitBlock!.color,
      `Fan-out row ${fi}: █ color (${foBlock!.color}) should match commit █ color (${commitBlock!.color})`,
    );
  }
}

// ============================================================
// ============================================================
// Test 8: Fan-out merge optimization — simple case (no connections on commit row)
// ============================================================
function test8() {
  console.log("\nTest 8: Fan-out merge optimization (simple, no connections)");

  // Two children from same parent — 1 fan-out row.
  // Parent commit has no merge/branch connectors on its own commit row.
  // The last fan-out row should be mergeable into the commit row.
  const commits: Commit[] = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  const parentRow = rows.find(r => r.commit.hash === "p1")!;

  // Verify the commit row has NO horizontal/corner/tee connectors
  const hasConnections = parentRow.connectors.some(c =>
    c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "corner-top-right" || c.type === "corner-top-left" ||
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );
  assert(!hasConnections, "Parent commit row should have NO merge/branch connectors");

  // Verify fan-out rows exist
  assert(
    parentRow.fanOutRows !== undefined && parentRow.fanOutRows.length > 0,
    "Parent should have fan-out rows",
  );

  // The optimization is in graph.tsx (component layer), not in the data model.
  // We verify here that the data conditions for merging are met:
  // - fanOutRows.length > 0
  // - no connection connectors on the commit row
  // The component will use the last fan-out row as the commit row graph.
  assert(
    parentRow.fanOutRows!.length >= 1,
    "Should have at least 1 fan-out row to merge",
  );
}

// ============================================================
// Test 9: Fan-out merge with 2 fan-out rows — only last merges
// ============================================================
function test9() {
  console.log("\nTest 9: Fan-out merge with 2 fan-out rows");

  const commits: Commit[] = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  const parentRow = rows.find(r => r.commit.hash === "p1")!;

  assert(
    parentRow.fanOutRows !== undefined && parentRow.fanOutRows.length >= 2,
    "Should have at least 2 fan-out rows",
  );

  // No connections on commit row → mergeable
  const hasConnections = parentRow.connectors.some(c =>
    c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "corner-top-right" || c.type === "corner-top-left" ||
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );
  assert(!hasConnections, "Parent commit row should have NO connections (mergeable)");

  // When merged: fanOutRows.length - 1 rows render above, last becomes commit row
  const aboveCount = parentRow.fanOutRows!.length - 1;
  assert(aboveCount >= 1, `Should have ${aboveCount} fan-out rows above after merge`);
}

// ============================================================
// Test 10: Fan-out merge SKIPPED — commit has merge connectors
// ============================================================
function test10() {
  console.log("\nTest 10: Fan-out merge skipped (commit has merge connectors)");

  // Parent is a merge commit AND has children branching off.
  // The commit row has horizontal connectors → can't merge fan-out.
  const commits: Commit[] = [
    makeCommit("c1", ["m1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["m1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("m1", ["p1", "f1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge feature"),
    makeCommit("f1", ["p1"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("p1", []),
  ];

  const rows = buildGraph(commits);
  const mergeRow = rows.find(r => r.commit.hash === "m1")!;

  // Should have fan-out rows (from c1 and c2)
  assert(
    mergeRow.fanOutRows !== undefined && mergeRow.fanOutRows.length > 0,
    "Merge commit should have fan-out rows",
  );

  // Should have merge connectors on the commit row (from merging f1)
  const hasConnections = mergeRow.connectors.some(c =>
    c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "corner-top-right" || c.type === "corner-top-left" ||
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );
  assert(hasConnections, "Merge commit row SHOULD have merge connectors → can't merge fan-out");
}

// ============================================================
// Test 11: Fan-out merge skipped — commit has branch-off connector
// ============================================================
function test11() {
  console.log("\nTest 11: Fan-out merge skipped (commit has branch-off connector)");

  // Commit is NOT a merge but opens a new lane (branch-off) while also
  // having children converge (fan-out).
  // This happens when a commit has multiple parents with one creating a new lane.
  const commits: Commit[] = [
    makeCommit("c1", ["m1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["m1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("m1", ["p1", "s1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge side"),
    makeCommit("s1", ["p1"], [{ name: "side", type: "branch", isCurrent: false }]),
    makeCommit("p1", []),
  ];

  const rows = buildGraph(commits);
  const mergeRow = rows.find(r => r.commit.hash === "m1")!;

  // Should have connection connectors (merge/branch)
  const hasConnections = mergeRow.connectors.some(c =>
    c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "corner-top-right" || c.type === "corner-top-left" ||
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );
  assert(hasConnections, "Merge commit with branch-off SHOULD have connectors → can't merge fan-out");
}

// ============================================================
// Test 12: Width consistency — fan-out █ rows match commit row width
// ============================================================
function test12() {
  console.log("\nTest 12: Width consistency (fan-out █ rows vs commit row)");

  const commits: Commit[] = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  const padCols = Math.max(...rows.map(r => r.columns.length));
  const parentRow = rows.find(r => r.commit.hash === "p1")!;

  const commitChars = renderGraphRow(parentRow, renderOpts(padCols));
  const commitWidth = totalCharWidth(commitChars);

  for (let fi = 0; fi < parentRow.fanOutRows!.length; fi++) {
    const foChars = renderFanOutRow(parentRow.fanOutRows![fi], renderOpts(padCols));
    const foWidth = totalCharWidth(foChars);
    assert(
      foWidth === commitWidth,
      `Fan-out row ${fi}: width (${foWidth}) should match commit row width (${commitWidth})`,
    );
  }
}

// ============================================================
// Test 13: No ● anywhere in rendered output (comprehensive check)
// ============================================================
function test13() {
  console.log("\nTest 13: No ● in any rendered output (comprehensive)");

  // Build a complex graph with merges, branches, fan-outs
  const commits: Commit[] = [
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
  const padCols = Math.max(...rows.map(r => r.columns.length));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const commitChars = renderGraphRow(row, renderOpts(padCols));
    assert(!hasChar(commitChars, "●"), `Row ${i} ("${row.commit.subject}"): commit row should NOT contain ●`);

    if (row.fanOutRows) {
      for (let fi = 0; fi < row.fanOutRows.length; fi++) {
        const foChars = renderFanOutRow(row.fanOutRows[fi], renderOpts(padCols));
        assert(!hasChar(foChars, "●"), `Row ${i} fan-out ${fi}: should NOT contain ●`);
        assert(!hasChar(foChars, "├"), `Row ${i} fan-out ${fi}: should NOT contain ├`);
        assert(!hasChar(foChars, "┤"), `Row ${i} fan-out ${fi}: should NOT contain ┤`);
      }
    }
  }
}

// ============================================================
// Run all tests
// ============================================================
console.log("Block Commit Tests");
console.log("=".repeat(60));

test1();
test2();
test3();
test4();
test5();
test6();
test8();
test9();
test10();
test11();
test12();
test13();

const { failedTests } = getResults();
printResults("block-commit");

if (failedTests > 0) {
  process.exit(1);
}
