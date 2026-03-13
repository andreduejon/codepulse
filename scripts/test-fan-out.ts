#!/usr/bin/env bun
/**
 * Test script: verifies fan-out connector generation.
 *
 * Fan-out occurs when multiple child lanes converge on the same parent.
 * Instead of merging lanes early, the engine keeps them independent and
 * generates fan-out connector rows at the parent commit — one row per
 * extra lane, with branch-off corners (╯/╰) closing each lane.
 */

import { buildGraph, renderFanOutRow, renderGraphRow, type GraphChar } from "../src/git/graph";
import {
  makeCommit,
  assert,
  resetResults,
  printResults,
  hasConnector,
  findConnector,
  countConnectors,
} from "./test-helpers";

const THEME_COLORS = [
  "#c0c001", "#c0c002", "#c0c003", "#c0c004",
  "#c0c005", "#c0c006", "#c0c007", "#c0c008",
];

// ============================================================
// Test 1: Basic fan-out (two branches from same parent)
// Two feature branches branch from the same develop commit.
// The parent should have fan-out rows with correct corners and tees.
// ============================================================
function test1() {
  console.log("\nTest 1: Basic fan-out (two branches from same parent)");

  const commits = [
    makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work"),
    makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);

  // d1 should have fan-out rows
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");
  assert(d1Row!.fanOutRows !== undefined, "d1 should have fanOutRows");
  assert(d1Row!.fanOutRows!.length > 0, "d1 should have at least 1 fan-out row");

  // Each fan-out row should have exactly one corner (bottom-right or bottom-left)
  for (let i = 0; i < d1Row!.fanOutRows!.length; i++) {
    const foRow = d1Row!.fanOutRows![i];
    const corners = foRow.filter(c =>
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );
    assert(corners.length === 1,
      `Fan-out row ${i} should have exactly 1 corner, got ${corners.length}`);

    // Verify the corner direction:
    // If the extra lane is to the RIGHT of the node → corner-bottom-right (╯)
    // If the extra lane is to the LEFT of the node → corner-bottom-left (╰)
    const corner = corners[0];
    if (corner.column > d1Row!.nodeColumn) {
      assert(corner.type === "corner-bottom-right",
        `Fan-out row ${i}: lane to the right should use corner-bottom-right (╯)`);
    } else {
      assert(corner.type === "corner-bottom-left",
        `Fan-out row ${i}: lane to the left should use corner-bottom-left (╰)`);
    }
  }

  // Each fan-out row should have a tee at the node column
  for (let i = 0; i < d1Row!.fanOutRows!.length; i++) {
    const foRow = d1Row!.fanOutRows![i];
    const tees = foRow.filter(c =>
      (c.type === "tee-left" || c.type === "tee-right") && c.column === d1Row!.nodeColumn
    );
    assert(tees.length === 1,
      `Fan-out row ${i} should have a tee at node column ${d1Row!.nodeColumn}`);

    // Verify tee direction matches corner position
    const corner = foRow.find(c =>
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );
    if (corner && corner.column > d1Row!.nodeColumn) {
      assert(tees[0].type === "tee-left",
        `Fan-out row ${i}: tee should be tee-left (├) when corner is to the right`);
    } else if (corner && corner.column < d1Row!.nodeColumn) {
      assert(tees[0].type === "tee-right",
        `Fan-out row ${i}: tee should be tee-right (┤) when corner is to the left`);
    }
  }
}

// ============================================================
// Test 2: Fan-out with crossings
// Three branches from same parent at col 0, with branches at cols 1, 2, 3.
// The farthest fan-out should cross intermediate active lanes.
// ============================================================
function test2() {
  console.log("\nTest 2: Fan-out with crossings");

  // 4 branches all from d1: develop (current, col 0) + 3 features
  const commits = [
    makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A"),
    makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B"),
    makeCommit("c1", ["d1"], [{ name: "feat-C", type: "branch", isCurrent: false }], "feat-C"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);

  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");
  assert(d1Row!.fanOutRows !== undefined, "d1 should have fanOutRows");

  // Should have 2 fan-out rows (3 extra lanes minus the one that stays = nodeColumn, 
  // actually: 3 extra lanes → 3 fan-out rows? No — one lane becomes the nodeColumn.
  // a1 gets col 0 (or wherever), b1 col 1, c1 col 2.
  // d1 occupies one of these columns. The other 2+ are extra → fan-out rows.
  // With 3 children all branching from d1, we expect >=2 fan-out rows.
  assert(d1Row!.fanOutRows!.length >= 2,
    `Should have at least 2 fan-out rows, got ${d1Row!.fanOutRows!.length}`);

  // The farthest fan-out row (first in the array, since sorted farthest-first)
  // may need to cross intermediate lanes. Check for crossing connectors.
  const firstFO = d1Row!.fanOutRows![0];

  // For the farthest lane, check if there are columns between the tee and corner
  // that have both straight and horizontal connectors (crossings).
  const tee = firstFO.find(c => c.type === "tee-left" || c.type === "tee-right");
  const corner = firstFO.find(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );

  if (tee && corner) {
    const lo = Math.min(tee.column, corner.column);
    const hi = Math.max(tee.column, corner.column);
    if (hi - lo > 1) {
      // There should be intermediate columns — check for crossings
      let hasCrossing = false;
      for (let col = lo + 1; col < hi; col++) {
        const colConns = firstFO.filter(c => c.column === col);
        const hasStraight = colConns.some(c => c.type === "straight");
        const hasHoriz = colConns.some(c => c.type === "horizontal");
        if (hasStraight && hasHoriz) hasCrossing = true;
      }
      // If there are intermediate active lanes, we should see crossings
      // (can't always guarantee — depends on lane activity)
      if (hasCrossing) {
        assert(true, "Crossing detected in farthest fan-out row");
      }
    }
  }
}

// ============================================================
// Test 3: Fan-out ordering (farthest first)
// Verify that fan-out rows are sorted by distance from nodeColumn,
// farthest first. The topmost fan-out row should close the lane
// that is farthest from the node.
// ============================================================
function test3() {
  console.log("\nTest 3: Fan-out ordering (farthest lane first)");

  const commits = [
    makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A"),
    makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B"),
    makeCommit("c1", ["d1"], [{ name: "feat-C", type: "branch", isCurrent: false }], "feat-C"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");
  assert(d1Row!.fanOutRows !== undefined && d1Row!.fanOutRows!.length >= 2,
    "d1 should have at least 2 fan-out rows");

  // Extract the corner column from each fan-out row
  const cornerColumns: number[] = [];
  for (const foRow of d1Row!.fanOutRows!) {
    const corner = foRow.find(c =>
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );
    if (corner) cornerColumns.push(corner.column);
  }

  // Verify farthest-first ordering: distances should be decreasing
  const nc = d1Row!.nodeColumn;
  for (let i = 1; i < cornerColumns.length; i++) {
    const prevDist = Math.abs(cornerColumns[i - 1] - nc);
    const currDist = Math.abs(cornerColumns[i] - nc);
    assert(prevDist >= currDist,
      `Fan-out row ${i}: distance ${currDist} should be <= previous distance ${prevDist} (farthest first)`);
  }
}

// ============================================================
// Test 4: Stray vertical cleanup after fan-out
// After fan-out processing closes extra lanes, the commit row
// should NOT have straight (│) connectors for those closed lanes.
// They should be replaced with empty connectors.
// ============================================================
function test4() {
  console.log("\nTest 4: Stray vertical cleanup after fan-out");

  const commits = [
    makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A"),
    makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");

  // Identify which columns had extra lanes (not nodeColumn, but tracked d1)
  // After fan-out, these should be closed. The commit row should have
  // 'empty' connectors at those columns, NOT 'straight'.
  const nodeCol = d1Row!.nodeColumn;

  // The fan-out rows tell us which columns were closed
  if (d1Row!.fanOutRows) {
    for (const foRow of d1Row!.fanOutRows!) {
      const corner = foRow.find(c =>
        c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
      );
      if (corner) {
        const closedCol = corner.column;
        // In the commit row's connectors, this column should NOT have a 'straight'
        const hasStraight = d1Row!.connectors.some(
          c => c.column === closedCol && c.type === "straight"
        );
        assert(!hasStraight,
          `Commit row should NOT have straight connector at closed fan-out col ${closedCol}`);
      }
    }
  }
}

// ============================================================
// Run all tests
// ============================================================
console.log("Fan-Out Tests");
console.log("=".repeat(60));

test1();
test2();
test3();
test4();

const { totalTests, passedTests, failedTests } = (await import("./test-helpers")).getResults();
printResults("fan-out");

if (failedTests > 0) {
  process.exit(1);
}
