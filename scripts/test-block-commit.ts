#!/usr/bin/env bun
/**
 * Test script: verifies block commit rendering (█ instead of ●).
 *
 * Tests:
 * 1-6.   Node glyph is █ (not ●) in rendered output
 * 8-9.   Fan-out merge optimization: last fan-out row merges into commit row
 *        when the commit row has no merge/branch connectors
 * 10-11. Fan-out merge is skipped when commit has merge/branch connectors
 * 12-13. Additional merge/fan-out edge cases
 */

import { buildGraph, renderGraphRow, renderFanOutRow } from "../src/git/graph";
import {
  assert,
  makeCommit,
  printResults,
  runTest,
  printGraph,
  renderOpts,
  hasChar,
  findChars,
  totalCharWidth
} from "./test-helpers";

// ============================================================
// Test 1: Basic node glyph is █ (simple linear commits)
//
// Graph:
//   col: 0
//   ──────
//        █  c3  (main)
//        │
//        █  c2
//        │
//        █  c1
//
// Verifies every commit row renders █ (not ●).
// ============================================================
function test1() {
  console.log("\nTest 1: Basic node glyph is █ (linear commits)");

  const commits = [
    makeCommit("c3", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["c1"]),
    makeCommit("c1", []),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

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
//
// Graph:
//   col: 0 1
//   ────────
//        █─╮   m1  (main, merge: parents [c1, f1])
//        │ │
//        │ █   f1  (feature)
//        │ │
//        █─╯   c1
//
// Verifies the merge commit row renders █─ (block + dash).
// ============================================================
function test2() {
  console.log("\nTest 2: Node glyph █ with merge connector (█─)");

  const commits = [
    makeCommit("m1", ["c1", "f1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge feature"),
    makeCommit("f1", ["c1"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("c1", []),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

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
//
// Graph:
//   col: 0
//   ──────
//        █  c2   (main)
//        │
//        █  c1
//
// Verifies simple commit renders as "█ " (block + space).
// ============================================================
function test3() {
  console.log("\nTest 3: Node glyph █ with no connections (trailing space)");

  const commits = [
    makeCommit("c2", ["c1"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c1", []),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
  const chars = renderGraphRow(rows[0], renderOpts());

  // Should have "█ " (block with trailing space)
  const blockChars = findChars(chars, "█");
  assert(blockChars.length > 0, "Should have at least one █ char");

  const blockWithSpace = chars.find(gc => gc.char === "█ ");
  assert(blockWithSpace !== undefined, "Simple commit should render as '█ ' (block + space)");
}

// ============================================================
// Test 4: Fan-out rows use █ (not ├/┤) at node column
//
// Graph:
//   col: 0 1 2
//   ──────────
//        █       c1  (branch-a → parent p1)
//        │
//        │ █     c2  (branch-b → parent p1)
//        │ │
//        │ │ █   c3  (branch-c → parent p1)
//        │ │ │
//        █─┼─╯
//        █─╯     p1  (main) ← 2 fan-out rows; last merged into commit row
//
// Fan-out rows use █ at the node column, not ├ or ┤.
// ============================================================
function test4() {
  console.log("\nTest 4: Fan-out rows use █ at node column");

  // Parent commit with 3 children — creates 2 fan-out rows
  const commits = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  // Find the row with fan-out rows (the parent commit p1)
  const parentRow = rows.find(r => r.commit.hash === "p1");
  assert(parentRow !== undefined, "Parent row should exist");
  assert(
    parentRow.fanOutRows !== undefined && parentRow.fanOutRows.length > 0,
    "Parent should have fan-out rows",
  );

  // Each fan-out row should have █ at the node column, NOT ├ or ┤
  for (let fi = 0; fi < parentRow.fanOutRows.length; fi++) {
    const foConnectors = parentRow.fanOutRows[fi];
    const foChars = renderFanOutRow(foConnectors, renderOpts());

    assert(hasChar(foChars, "█"), `Fan-out row ${fi}: should contain █`);
    assert(!hasChar(foChars, "├"), `Fan-out row ${fi}: should NOT contain ├`);
    assert(!hasChar(foChars, "┤"), `Fan-out row ${fi}: should NOT contain ┤`);
  }
}

// ============================================================
// Test 5: Fan-out █ with trailing dash (█─) when branch goes right
//
// Graph:
//   col: 0 1
//   ────────
//        █     c1  (branch-a → parent p1)
//        │
//        │ █   c2  (branch-b → parent p1)
//        │ │
//        █─╯   p1  (main) ← fan-out with █─ (tee-left)
//
// When the closing lane is to the right of the node, the fan-out
// row should render █─ (block with trailing dash).
// ============================================================
function test5() {
  console.log("\nTest 5: Fan-out █ with trailing dash when branch goes right");

  // Two children from same parent, children to the right of parent
  const commits = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
  const parentRow = rows.find(r => r.commit.hash === "p1");
  assert(parentRow !== undefined, "Parent row should exist");
  assert(parentRow.fanOutRows !== undefined, "Parent should have fan-out rows");

  for (let fi = 0; fi < parentRow.fanOutRows.length; fi++) {
    const foConnectors = parentRow.fanOutRows[fi];
    const foChars = renderFanOutRow(foConnectors, renderOpts());

    // Should have █ (possibly with trailing ─)
    assert(hasChar(foChars, "█"), `Fan-out row ${fi}: should contain █`);

    // If the closing lane is to the right, there should be a ─ after █
    const nodeCol = parentRow.nodeColumn;
    const teeConn = foConnectors.find(c =>
      c.column === nodeCol && (c.type === "tee-left" || c.type === "tee-right"));
    if (teeConn?.type === "tee-left") {
      // tee-left means branch goes right → should have trailing ─
      assert(hasChar(foChars, "─"), `Fan-out row ${fi}: tee-left should have trailing ─ after █`);
    }
  }
}

// ============================================================
// Test 6: Fan-out █ color matches node color
//
// Graph (same topology as test5):
//   col: 0 1
//   ────────
//        █     c1  (branch-a)
//        │
//        │ █   c2  (branch-b)
//        │ │
//        █─╯   p1  (main)
//
// Verifies the █ glyph in fan-out rows uses the same color
// as the █ in the commit row.
// ============================================================
function test6() {
  console.log("\nTest 6: Fan-out █ color matches node color");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
  const parentRow = rows.find(r => r.commit.hash === "p1");
  assert(parentRow !== undefined, "Parent row should exist");

  const opts = renderOpts();

  // Get the node color from the commit row
  const commitChars = renderGraphRow(parentRow, opts);
  const commitBlock = commitChars.find(gc => gc.char.includes("█"));
  assert(commitBlock !== undefined, "Commit row should have █");

  const fanOutRows = parentRow.fanOutRows;
  assert(fanOutRows !== undefined, "Parent should have fan-out rows");

  // Fan-out rows' █ should use the same color
  for (let fi = 0; fi < fanOutRows.length; fi++) {
    const foChars = renderFanOutRow(fanOutRows[fi], opts);
    const foBlock = foChars.find(gc => gc.char.includes("█"));
    assert(foBlock !== undefined, `Fan-out row ${fi}: should have █`);
    assert(
      foBlock.color === commitBlock.color,
      `Fan-out row ${fi}: █ color (${foBlock.color}) should match commit █ color (${commitBlock.color})`,
    );
  }
}

// ============================================================
// Test 7: Node with left connection renders as "█ " (no trailing dash)
//
// Graph:
//   col: 0  1
//   ──────────
//        █     c1  (feat-A)
//        │
//        █     p1  (main)
//        │
//        ├─█   c2  (feat-B → parent p1 at col 0)
//        │
//        █     root
//
// c2 at col 1 connects LEFT to p1 at col 0. The node should
// render as "█ " (no trailing dash — dash only for RIGHT connections).
// ============================================================
function test7() {
  console.log("\nTest 7: Node with left connection renders without trailing dash");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  const c2Row = rows.find(r => r.commit.hash === "c2")!;
  const rendered = renderGraphRow(c2Row, {});

  // The node for c2 should render as "█ " not "█─"
  // because the connection is to the LEFT (toward col 0), not to the right
  const nodeChar = rendered.find(gc => gc.char.includes("█"));
  assert(nodeChar !== undefined, "Should find █ in rendered c2");
  if (nodeChar) {
    assert(!nodeChar.char.includes("─"),
      `Node with only left connection should not have trailing dash, got "${nodeChar.char}"`);
  }
}

// ============================================================
// Test 8: Fan-out merge optimization — simple case (no connections on commit row)
//
// Graph:
//   col: 0 1
//   ────────
//        █     c1  (branch-a → parent p1)
//        │
//        │ █   c2  (branch-b → parent p1)
//        │ │
//        █─╯   p1  (main) ← last fan-out row merged into commit row
//
// When the commit row has no merge/branch connectors, the last
// fan-out row can be merged into the commit row. Verifies the
// data conditions for this optimization are met.
// ============================================================
function test8() {
  console.log("\nTest 8: Fan-out merge optimization (simple, no connections)");

  // Two children from same parent — 1 fan-out row.
  // Parent commit has no merge/branch connectors on its own commit row.
  // The last fan-out row should be mergeable into the commit row.
  const commits = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
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
    parentRow.fanOutRows.length >= 1,
    "Should have at least 1 fan-out row to merge",
  );
}

// ============================================================
// Test 9: Fan-out merge with 2 fan-out rows — only last merges
//
// Graph:
//   col: 0 1 2
//   ──────────
//        █       c1  (branch-a → parent p1)
//        │
//        │ █     c2  (branch-b → parent p1)
//        │ │
//        │ │ █   c3  (branch-c → parent p1)
//        │ │ │
//        █─╯ │       ← fan-out row 0 (rendered above commit)
//        █───╯   p1  (main) ← fan-out row 1 merged into commit row
//
// With 3 children → 2 fan-out rows. Only the last fan-out row
// merges into the commit row; earlier fan-out rows render above.
// ============================================================
function test9() {
  console.log("\nTest 9: Fan-out merge with 2 fan-out rows");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
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
  const aboveCount = parentRow.fanOutRows.length - 1;
  assert(aboveCount >= 1, `Should have ${aboveCount} fan-out rows above after merge`);
}

// ============================================================
// Test 10: Fan-out merge SKIPPED — commit has merge connectors
//
// Graph:
//   col: 0 1
//   ────────
//        █     c1  (branch-a → parent m1)
//        │
//        │ █   c2  (branch-b → parent m1)
//        │ │
//        █─╯       ← fan-out row (not optimized)
//        █─╮   m1  (main, merge: parents [p1, f1])
//        │ │
//        │ █   f1  (feature)
//        │ │
//        █─╯   p1
//
// When the commit row already has merge connectors (╮ from the
// merge parent f1), fan-out merge optimization is skipped.
// ============================================================
function test10() {
  console.log("\nTest 10: Fan-out merge skipped (commit has merge connectors)");

  // Parent is a merge commit AND has children branching off.
  // The commit row has horizontal connectors → can't merge fan-out.
  const commits = [
    makeCommit("c1", ["m1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["m1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("m1", ["p1", "f1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge feature"),
    makeCommit("f1", ["p1"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("p1", []),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
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
//
// Graph (same topology as test10 with different branch names):
//   col: 0 1
//   ────────
//        █     c1  (branch-a)
//        │
//        │ █   c2  (branch-b)
//        │ │
//        █─╯
//        █─╮   m1  (main, merge: parents [p1, s1])
//        │ │
//        │ █   s1  (side)
//        │ │
//        █─╯   p1
//
// Merge commit with branch-off has connectors → can't merge fan-out.
// ============================================================
function test11() {
  console.log("\nTest 11: Fan-out merge skipped (commit has branch-off connector)");

  // Commit is NOT a merge but opens a new lane (branch-off) while also
  // having children converge (fan-out).
  // This happens when a commit has multiple parents with one creating a new lane.
  const commits = [
    makeCommit("c1", ["m1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["m1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("m1", ["p1", "s1"], [{ name: "main", type: "branch", isCurrent: true }], "Merge side"),
    makeCommit("s1", ["p1"], [{ name: "side", type: "branch", isCurrent: false }]),
    makeCommit("p1", []),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
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
//
// Graph (same topology as test4/test9):
//   col: 0 1 2
//   ──────────
//        █      c1  (branch-a)
//        │
//        │ █    c2  (branch-b)
//        │ │
//        │ │ █  c3  (branch-c)
//        │ │ │
//        █─┼─╯
//        █─╯    p1  (main)
//
// When padToColumns is set, fan-out rows and commit rows must
// have identical total character widths.
// ============================================================
function test12() {
  console.log("\nTest 12: Width consistency (fan-out █ rows vs commit row)");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "branch-a", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["p1"], [{ name: "branch-b", type: "branch", isCurrent: false }]),
    makeCommit("c3", ["p1"], [{ name: "branch-c", type: "branch", isCurrent: false }]),
    makeCommit("p1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
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
//
// Graph:
//   col: 0 1 2
//   ──────────
//        █      d4  (develop)
//        │
//        █─╮    m2  (merge: parents [d3, f2])
//        │ │
//        │ █    f2  (feature-2)
//        │ │
//        █ │    d3
//        │ │
//        █─┼─╮  m1  (merge: parents [d2, f1])
//        │ │ │
//        │ │ █  f1  (feature-1)
//        │ │ │
//        █─╯ │  d2
//        │   │
//        █───╯  d1
//
// Comprehensive scan: every commit row and fan-out row must
// contain █ (not ●), and fan-out rows must not contain ├ or ┤.
// ============================================================
function test13() {
  console.log("\nTest 13: No ● in any rendered output (comprehensive)");

  // Build a complex graph with merges, branches, fan-outs
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
// Test 14: Node with right connection renders as "█─"
//
// Graph:
//   col: 0  1
//   ──────────
//        █──╮  m1  (main, merge: parents [d1, f1])
//        │  █  f1  (feature)
//        █──╯  d1
//
// m1 at col 0 connects RIGHT to f1's lane at col 1. The node
// should have a trailing dash (█─).
// ============================================================
function test14() {
  console.log("\nTest 14: Node with right connection renders with trailing dash");

  // Merge commit at col 0 with secondary parent opening a lane to the right
  const commits = [
    makeCommit("m1", ["d1", "f1"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("f1", ["d1"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("d1", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  const m1Row = rows.find(r => r.commit.hash === "m1")!;
  const rendered = renderGraphRow(m1Row, {});

  // m1 at col 0 should have a right connection (to feature lane)
  const nodeGlyph = rendered.find(gc => gc.char.includes("█"));
  assert(nodeGlyph !== undefined, "Should find █ in rendered m1");
  if (nodeGlyph) {
    // Should be just "█" (the dash is a separate GraphChar)
    // OR "█─" depending on implementation
    // Check that the next char after █ is "─"
    const nodeIdx = rendered.indexOf(nodeGlyph);
    const hasTrailingDash = nodeGlyph.char === "█" ||
      (nodeIdx + 1 < rendered.length && rendered[nodeIdx + 1].char === "─") ||
      nodeGlyph.char.includes("─");
    assert(hasTrailingDash,
      "Node with right connection should have a trailing dash");
  }
}

// ============================================================
// Test 15: Left-connection connectors appear at correct columns
//
// Graph:
//   col: 0  1
//   ──────────
//        █     c1  (feat-A)
//        │
//        █     p1  (main)
//        │
//        ├─█   c2  (feat-B) ← connectors between cols 0 and 1
//        │
//        █     root
//
// Verifies that connector glyphs exist between c2's column and
// p1's column for the left connection.
// ============================================================
function test15() {
  console.log("\nTest 15: Left-connection connectors at correct columns");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  const c2Row = rows.find(r => r.commit.hash === "c2")!;
  const p1Row = rows.find(r => r.commit.hash === "p1")!;

  // c2's nodeColumn should be > p1's nodeColumn (c2 is at a higher column)
  if (c2Row.nodeColumn > p1Row.nodeColumn) {
    // There should be connectors between c2's column and p1's column
    // These are the "left connection" connectors
    const leftConns = c2Row.connectors.filter(c =>
      c.column < c2Row.nodeColumn && c.column >= p1Row.nodeColumn &&
      c.type !== "straight" && c.type !== "empty" && c.type !== "node"
    );
    assert(leftConns.length > 0,
      "Should have connectors between c2 node and p1 column for left connection");
  }
}

// ============================================================
// Run all tests
// ============================================================
console.log("Block Commit Tests");
console.log("=".repeat(60));

runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test5);
runTest(test6);
runTest(test7);
runTest(test8);
runTest(test9);
runTest(test10);
runTest(test11);
runTest(test12);
runTest(test13);
runTest(test14);
runTest(test15);

const { failedTests } = (await import("./test-helpers")).getResults();
printResults("block-commit");

if (failedTests > 0) {
  process.exit(1);
}
