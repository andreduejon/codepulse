#!/usr/bin/env bun
/**
 * Test script: lane colors are decoupled from column indices.
 *
 * When lanes reuse interior null slots, they should get fresh sequential
 * color indices rather than inheriting the color of the column position.
 * This prevents visually incorrect connector colors.
 */

import { buildGraph, renderGraphRow, getColorForColumn } from "../src/git/graph";
import { assert, makeCommit, printResults, runTest, printGraph } from "./test-helpers";

console.log("Lane Color Consistency Tests");
console.log("=".repeat(60));

// ─── Test 1: Colors differ when lane reuses interior slot ──────
//
// Graph:
//   █     A  (main)
//   │
//   │ █   B  (feature)  ← opens lane at col 1
//   │ │
//   █─╯   C             ← feature lane closes (merged fan-out)
//   │
//   █─╮   D             ← merge: opens lane for hotfix parent E
//   │ │
//   │ █   E  (hotfix)   ← reuses freed col 1 slot
//   │ │
//   █─╯   F  ()
//
// When feature's lane at col 1 closes and hotfix opens a new lane
// at the same column, the new lane should get a fresh color index.
function test1() {
  console.log("\nTest 1: New lane at reused interior slot gets fresh color\n");
  const commits = [
    makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("C", ["D"], []),
    makeCommit("D", ["F", "E"], []),
    makeCommit("E", ["F"], [{ name: "hotfix", type: "branch", isCurrent: false }]),
    makeCommit("F", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  // Find the row for B (feature tip) — its node is at col 1
  const rowB = rows.find(r => r.commit.hash === "B");
  assert(rowB !== undefined, "Should find row for B");

  const bNodeColor = rowB.nodeColor;

  // Find the row for D (merge commit that opens new lane for hotfix parent E)
  const rowD = rows.find(r => r.commit.hash === "D")!;

  // The branch connector for E should be at some column. Find the corner-top connector.
  const branchCorner = rowD.connectors.find(c =>
    c.type === "corner-top-right" || c.type === "corner-top-left"
  );
  assert(branchCorner !== undefined, "D should have a branch corner for secondary parent E");

  if (branchCorner) {
    // The branch corner's color should differ from B's node color
    // because it's a different branch opened later
    assert(
      branchCorner.color !== bNodeColor,
      `Branch corner color (${branchCorner.color}) should differ from feature lane color (${bNodeColor})`
    );
  }

  // Additionally, verify that no two commits at the same column share colors
  // unless they're the same logical lane
  const rowA = rows.find(r => r.commit.hash === "A")!;
  const rowE = rows.find(r => r.commit.hash === "E")!;
  // A is at col 0, E may be at col 1. These are different branches.
  assert(rowA.nodeColor !== rowE.nodeColor, "A and E (different branches) should have different colors");
}

// ─── Test 2: Sequential color indices are monotonically increasing ───
//
// Graph:
//   █       A  (main)
//   │
//   │ █     B  (feat1)
//   │ │
//   │ │ █   C  (feat2)
//   │ │ │
//   █─┼─╯
//   █─╯     D  ()
//
// Three branches from common ancestor D. Each should have a unique
// color index (A != B != C).
function test2() {
  console.log("\nTest 2: Color indices increase monotonically across lanes\n");
  const commits = [
    makeCommit("A", ["D"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("B", ["D"], [{ name: "feat1", type: "branch", isCurrent: false }]),
    makeCommit("C", ["D"], [{ name: "feat2", type: "branch", isCurrent: false }]),
    makeCommit("D", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  // A, B, C should all have different colors (D may share with one of them
  // since it reuses A's lane)
  assert(
    rows[0].nodeColor !== rows[1].nodeColor,
    "A and B should have different nodeColors"
  );
  assert(
    rows[0].nodeColor !== rows[2].nodeColor,
    "A and C should have different nodeColors"
  );
  assert(
    rows[1].nodeColor !== rows[2].nodeColor,
    "B and C should have different nodeColors"
  );
}

// ─── Test 3: Connector colors match their lane, not column position ───
//
// Graph:
//   █     A  (main)     ← col 0
//   │
//   │ █   B  (feature)  ← col 1; A's lane continues as │ at col 0
//   │ │
//   █─╯   C  ()
//
// When B is processed, A's lane at col 0 is still active (straight │).
// The straight connector's color should match A's nodeColor (main's lane).
function test3() {
  console.log("\nTest 3: Straight connector colors match lane color, not column index\n");
  const commits = [
    makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("C", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  // Row B should have A's lane as a straight at col 0
  const rowB = rows.find(r => r.commit.hash === "B")!;
  const straightAtCol0 = rowB.connectors.find(c => c.type === "straight" && c.column === 0);
  assert(straightAtCol0 !== undefined, "Row B should have a straight at col 0 (A's lane)");

  if (straightAtCol0) {
    // The straight connector's color should be A's nodeColor (main's lane)
    const rowA = rows.find(r => r.commit.hash === "A")!;
    assert(
      straightAtCol0.color === rowA.nodeColor,
      `Straight at col 0 color (${straightAtCol0.color}) should match main's nodeColor (${rowA.nodeColor})`
    );
  }
}

// ─── Test 4: GraphColumn colors match lane colors ────────────────
//
// Graph:  (same as Test 3)
//   █     A  (main)     ← col 0
//   │
//   │ █   B  (feature)  ← col 1; both columns active
//   │ │
//   █─╯   C  ()
//
// Row B has 2 active columns: col 0 (main) and col 1 (feature).
// GraphColumn[0].color should equal A's nodeColor;
// GraphColumn[1].color should equal B's nodeColor.
function test4() {
  console.log("\nTest 4: GraphColumn.color matches lane color (not column index)\n");
  const commits = [
    makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("C", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  // Row B has both lanes active: col 0 (A/main), col 1 (B/feature)
  const rowB = rows.find(r => r.commit.hash === "B")!;
  const rowA = rows.find(r => r.commit.hash === "A")!;

  assert(rowB.columns.length >= 2, "Row B should have at least 2 columns");

  if (rowB.columns.length >= 2) {
    // Column 0's color should be A's nodeColor
    assert(
      rowB.columns[0].color === rowA.nodeColor,
      `Column 0 color (${rowB.columns[0].color}) should match A's nodeColor (${rowA.nodeColor})`
    );

    // Column 1's color should be B's nodeColor
    assert(
      rowB.columns[1].color === rowB.nodeColor,
      `Column 1 color (${rowB.columns[1].color}) should match B's nodeColor (${rowB.nodeColor})`
    );
  }
}

// ─── Test 5: Rendered colors are correct (actual hex values) ──────
//
// Graph:  (same as Test 3)
//   █     A  (main)
//   │
//   │ █   B  (feature)
//   │ │
//   █─╯   C  ()
//
// Render row A with a known color palette and verify the █ glyph
// gets the correct hex color from getColorForColumn(A.nodeColor).
function test5() {
  console.log("\nTest 5: Rendered graph row uses correct hex colors from lane colors\n");
  const COLORS = [
    "#f38ba8", "#a6e3a1", "#89b4fa", "#f9e2af",
    "#cba6f7", "#94e2d5", "#fab387", "#74c7ec",
    "#f2cdcd", "#89dceb", "#b4befe", "#eba0ac",
  ];
  const commits = [
    makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("C", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);
  const rowA = rows.find(r => r.commit.hash === "A")!;
  const rendered = renderGraphRow(rowA, { themeColors: COLORS });

  // Find the node glyph (█) — should use A's lane color
  const nodeGlyph = rendered.find(gc => gc.char.includes("█"));
  assert(nodeGlyph !== undefined, "Should find █ in rendered output");
  if (nodeGlyph) {
    const expectedColor = getColorForColumn(rowA.nodeColor, COLORS);
    assert(
      nodeGlyph.color === expectedColor,
      `Node color should be ${expectedColor} but got ${nodeGlyph.color}`
    );
  }
}

// ─── Test 6: Interior null slot reuse scenario (the original bug) ──
//
// Graph:
//   █             A   (main)
//   │
//   │ █           B1  (f1)
//   │ │
//   │ │ █         B2  (f2)
//   │ │ │
//   │ │ │ █       B3  (f3)
//   │ │ │ │
//   │ │ │ │ █     B4  (f4)
//   │ │ │ │ │
//   █─┼─┼─┼─┼─╮   B   ()  ← merge: opens lane for hotfix parent E
//   │ │ │ │ │ │
//   │ │ │ │ │ █   E   (hotfix)  ← reuses a freed interior slot
//   │ │ │ │ │ │
//   █─┼─┼─┼─┼─╯
//   █─┼─┼─┼─╯
//   █─┼─┼─╯
//   █─┼─╯
//   █─╯           D   ()
//
// B1-B4 occupy cols 1-4. When B merges E, it opens a new lane.
// The new lane should get a fresh color, not reuse B4's color.
function test6() {
  console.log("\nTest 6: Interior null slot reuse - new lane gets fresh color\n");
  const commits = [
    makeCommit("A", ["B"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("B1", ["D"], [{ name: "f1", type: "branch", isCurrent: false }]),
    makeCommit("B2", ["D"], [{ name: "f2", type: "branch", isCurrent: false }]),
    makeCommit("B3", ["D"], [{ name: "f3", type: "branch", isCurrent: false }]),
    makeCommit("B4", ["D"], [{ name: "f4", type: "branch", isCurrent: false }]),
    makeCommit("B", ["D", "E"], []),  // merge commit — opens lane for E
    makeCommit("E", ["D"], [{ name: "hotfix", type: "branch", isCurrent: false }]),
    makeCommit("D", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  // Find B's row — it's a merge that opens a lane for E
  const rowB = rows.find(r => r.commit.hash === "B")!;
  const rowB4 = rows.find(r => r.commit.hash === "B4")!;

  // The branch connector for E should exist
  const branchCorner = rowB.connectors.find(c =>
    c.type === "corner-top-right" || c.type === "corner-top-left"
  );
  assert(branchCorner !== undefined, "B should have a branch corner for E");

  if (branchCorner) {
    // B4's nodeColor represents whatever color was at the column B4 occupied
    // The branch corner for E should have a DIFFERENT color (fresh allocation)
    assert(
      branchCorner.color !== rowB4.nodeColor,
      `Branch corner color (${branchCorner.color}) should differ from B4 color (${rowB4.nodeColor})`
    );
  }
}

// ============================================================
// Run all tests
// ============================================================
runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test5);
runTest(test6);

printResults("lane-color");

const { failedTests } = (await import("./test-helpers")).getResults();

if (failedTests > 0) {
  process.exit(1);
}
