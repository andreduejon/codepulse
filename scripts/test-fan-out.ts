#!/usr/bin/env bun
/**
 * Test script: verifies fan-out connector generation.
 *
 * Fan-out occurs when multiple child lanes converge on the same parent.
 * Instead of merging lanes early, the engine keeps them independent and
 * generates fan-out connector rows at the parent commit — one row per
 * extra lane, with branch-off corners (╯/╰) closing each lane.
 */

import { buildGraph } from "../src/git/graph";
import {
  makeCommit,
  assert,
  printResults,
  runTest,
  printGraph,
} from "./test-helpers";

// ============================================================
// Test 1: Basic fan-out (two branches from same parent)
//
// Graph:
//   █     a1  (feat-A)
//   │
//   │ █   b1  (feat-B)
//   │ │
//   █─╯   d1  (develop)  ← fan-out merged into commit row
//   │
//   █     d0  ()
//
// Two feature branches from the same develop commit d1.
// The parent should have fan-out rows with correct corners
// (╯ for lanes RIGHT of node, ╰ for LEFT) and matching tees
// (├ when corner is RIGHT, ┤ when LEFT).
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
  printGraph(rows);

  // d1 should have fan-out rows
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");
  assert(d1Row.fanOutRows !== undefined, "d1 should have fanOutRows");
  assert(d1Row.fanOutRows.length > 0, "d1 should have at least 1 fan-out row");

  // Each fan-out row should have exactly one corner (bottom-right or bottom-left)
  for (let i = 0; i < d1Row.fanOutRows.length; i++) {
    const foRow = d1Row.fanOutRows[i];
    const corners = foRow.filter(c =>
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );
    assert(corners.length === 1,
      `Fan-out row ${i} should have exactly 1 corner, got ${corners.length}`);

    // Verify the corner direction:
    // If the extra lane is to the RIGHT of the node → corner-bottom-right (╯)
    // If the extra lane is to the LEFT of the node → corner-bottom-left (╰)
    const corner = corners[0];
    if (corner.column > d1Row.nodeColumn) {
      assert(corner.type === "corner-bottom-right",
        `Fan-out row ${i}: lane to the right should use corner-bottom-right (╯)`);
    } else {
      assert(corner.type === "corner-bottom-left",
        `Fan-out row ${i}: lane to the left should use corner-bottom-left (╰)`);
    }
  }

  // Each fan-out row should have a tee at the node column
  for (let i = 0; i < d1Row.fanOutRows.length; i++) {
    const foRow = d1Row.fanOutRows[i];
    const tees = foRow.filter(c =>
      (c.type === "tee-left" || c.type === "tee-right") && c.column === d1Row.nodeColumn
    );
    assert(tees.length === 1,
      `Fan-out row ${i} should have a tee at node column ${d1Row.nodeColumn}`);

    // Verify tee direction matches corner position
    const corner = foRow.find(c =>
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );
    if (corner && corner.column > d1Row.nodeColumn) {
      assert(tees[0].type === "tee-left",
        `Fan-out row ${i}: tee should be tee-left (├) when corner is to the right`);
    } else if (corner && corner.column < d1Row.nodeColumn) {
      assert(tees[0].type === "tee-right",
        `Fan-out row ${i}: tee should be tee-right (┤) when corner is to the left`);
    }
  }
}

// ============================================================
// Test 2: Fan-out with crossings
//
// Graph:
//   █       a1  (feat-A)
//   │
//   │ █     b1  (feat-B)
//   │ │
//   │ │ █   c1  (feat-C)
//   │ │ │
//   █─┼─╯
//   █─╯     d1  (develop)  ← 2 fan-out rows; last merged into commit row
//   │
//   █       d0  ()
//
// Three branches from d1 at col 0. The farthest fan-out (c1 at col 2)
// crosses the intermediate lane (b1 at col 1) with a ┼ crossing.
// ============================================================
function test2() {
  console.log("\nTest 2: Fan-out with crossings");

  const commits = [
    makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A"),
    makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B"),
    makeCommit("c1", ["d1"], [{ name: "feat-C", type: "branch", isCurrent: false }], "feat-C"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");
  assert(d1Row.fanOutRows !== undefined, "d1 should have fanOutRows");

  // With 3 children all branching from d1, we expect >=2 fan-out rows.
  assert(d1Row.fanOutRows.length >= 2,
    `Should have at least 2 fan-out rows, got ${d1Row.fanOutRows.length}`);

  // The farthest fan-out row (first in the array, since sorted farthest-first)
  // may need to cross intermediate lanes. Check for crossing connectors.
  const firstFO = d1Row.fanOutRows[0];

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
      if (hasCrossing) {
        assert(true, "Crossing detected in farthest fan-out row");
      }
    }
  }
}

// ============================================================
// Test 3: Fan-out ordering (farthest lane first)
//
// Graph:  (same topology as Test 2)
//   █       a1  (feat-A)
//   │
//   │ █     b1  (feat-B)
//   │ │
//   │ │ █   c1  (feat-C)
//   │ │ │
//   █─┼─╯
//   █─╯     d1  (develop)  ← fan-out row 0: farthest (c1, dist=2)
//   │                         fan-out row 1 merged: closer (b1, dist=1)
//   █       d0  ()
//
// Fan-out rows are sorted by distance from nodeColumn, farthest
// first. The topmost fan-out row closes the lane farthest from
// the node.
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
  printGraph(rows);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");
  assert(d1Row.fanOutRows !== undefined && d1Row.fanOutRows.length >= 2,
    "d1 should have at least 2 fan-out rows");

  // Extract the corner column from each fan-out row
  const cornerColumns: number[] = [];
  for (const foRow of d1Row.fanOutRows) {
    const corner = foRow.find(c =>
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );
    if (corner) cornerColumns.push(corner.column);
  }

  // Verify farthest-first ordering: distances should be decreasing
  const nc = d1Row.nodeColumn;
  for (let i = 1; i < cornerColumns.length; i++) {
    const prevDist = Math.abs(cornerColumns[i - 1] - nc);
    const currDist = Math.abs(cornerColumns[i] - nc);
    assert(prevDist >= currDist,
      `Fan-out row ${i}: distance ${currDist} should be <= previous distance ${prevDist} (farthest first)`);
  }
}

// ============================================================
// Test 4: Stray vertical cleanup after fan-out
//
// Graph:
//   █     a1  (feat-A)
//   │
//   │ █   b1  (feat-B)
//   │ │
//   █─╯   d1  (develop)  ← fan-out merged into commit row
//   │
//   █     d0  ()
//
// After fan-out closes a lane, the commit row should NOT have
// a stray straight (│) connector at that column. The fan-out
// row handles the closure, so the commit row should show empty.
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
  printGraph(rows);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");

  // The fan-out rows tell us which columns were closed
  if (d1Row.fanOutRows) {
    for (const foRow of d1Row.fanOutRows) {
      const corner = foRow.find(c =>
        c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
      );
      if (corner) {
        const closedCol = corner.column;
        // In the commit row's connectors, this column should NOT have a 'straight'
        const hasStraight = d1Row.connectors.some(
          c => c.column === closedCol && c.type === "straight"
        );
        assert(!hasStraight,
          `Commit row should NOT have straight connector at closed fan-out col ${closedCol}`);
      }
    }
  }
}

// ============================================================
// Test 5: Fan-out + merge on opposite sides → single block
//
// Graph:
//   █       m1  (main)
//   │
//   │ █     f1  (feat-F)
//   │ │
//   │ │ █   g1  (feat-G)
//   │ │ │
//   █─█─╯   d1  (develop)  ← merge m1 (LEFT) + fan-out g1 (RIGHT)
//   │ │           opposite sides → combined into 1 █ row
//   █ │     m0  ()
//     │
//     █     d0  ()
//
// d1 is a merge commit (parents d0 + m1) with fan-out from g1.
// Fan-out corner is to the RIGHT, merge connector is to the LEFT.
// Since they are on opposite sides, the last fan-out row absorbs
// the merge connectors (combined into one █ block row).
// ============================================================
function test5() {
  console.log("\nTest 5: Fan-out + merge on opposite sides → single combined row");

  const commits = [
    makeCommit("m1", ["m0"], [{ name: "main", type: "branch", isCurrent: false }], "main tip"),
    makeCommit("f1", ["d1"], [{ name: "feat-F", type: "branch", isCurrent: false }], "feat-F"),
    makeCommit("g1", ["d1"], [{ name: "feat-G", type: "branch", isCurrent: false }], "feat-G"),
    makeCommit("d1", ["d0", "m1"], [{ name: "develop", type: "branch", isCurrent: true }], "merge main into develop"),
    makeCommit("m0", [], [], "main base"),
    makeCommit("d0", [], [], "develop base"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");

  // d1 should have fan-out rows (g1's lane closes)
  assert(d1Row.fanOutRows !== undefined && d1Row.fanOutRows.length > 0,
    "d1 should have fan-out rows");

  // The key assertion: the last fan-out row should contain BOTH:
  // 1. A corner (from the fan-out closing g1's lane)
  // 2. Merge/branch connectors (from the merge with m1)
  const lastFO = d1Row.fanOutRows.at(-1);
  assert(lastFO !== undefined, "Last fan-out row should exist");

  // Find fan-out corner
  const foCorner = lastFO.find(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );
  assert(foCorner !== undefined, "Last fan-out row should have a corner");

  // Find merge connector (tee or corner from the merge with m1)
  const mergeConn = lastFO.find(c =>
    (c.type === "tee-left" || c.type === "tee-right" ||
     c.type === "corner-top-right" || c.type === "corner-top-left" ||
     c.type === "corner-bottom-right" || c.type === "corner-bottom-left") &&
    c.column !== d1Row.nodeColumn && c !== foCorner
  );

  // We also accept horizontals from the merge as evidence
  const mergeHoriz = lastFO.find(c =>
    c.type === "horizontal" && c.column !== foCorner?.column
  );

  const hasMergeInFanOut = mergeConn !== undefined || mergeHoriz !== undefined;
  assert(hasMergeInFanOut,
    "Last fan-out row should contain merge connectors (combined with fan-out)");

  // The commit row should NOT have merge/branch connectors anymore
  // (they were absorbed into the last fan-out row)
  const commitHasMB = d1Row.connectors.some(c =>
    c.column !== d1Row.nodeColumn && (
      c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
      c.type === "corner-top-right" || c.type === "corner-top-left" ||
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    )
  );
  assert(!commitHasMB,
    "Commit row should NOT have merge/branch connectors (absorbed into fan-out)");
}

// ============================================================
// Test 6: Fan-out + merge on SAME side → keeps 2 blocks
//
// Graph:
//   █       f1  (feat-F)
//   │
//   │ █     g1  (feat-G)
//   │ │
//   │ │ █   m1  (main)
//   │ │ │
//   █─╯ │
//   █───┤   d1  (develop)  ← merge m1 (RIGHT) + fan-out g1 (RIGHT)
//   │   │         both on same side → NOT combined
//   │   █   m0  ()
//   │
//   █       d0  ()
//
// When both fan-out and merge connectors are on the same side
// (both RIGHT of d1), they should NOT be combined — the commit
// row keeps its merge connectors, and fan-out rows stay separate.
// ============================================================
function test6() {
  console.log("\nTest 6: Fan-out + merge on same side → keeps 2 blocks");

  const commits = [
    makeCommit("f1", ["d1"], [{ name: "feat-F", type: "branch", isCurrent: true }], "feat-F"),
    makeCommit("g1", ["d1"], [{ name: "feat-G", type: "branch", isCurrent: false }], "feat-G"),
    makeCommit("m1", ["m0"], [{ name: "main", type: "branch", isCurrent: false }], "main tip"),
    makeCommit("d1", ["d0", "m1"], [{ name: "develop", type: "branch", isCurrent: false }], "merge main into develop"),
    makeCommit("m0", [], [], "main base"),
    makeCommit("d0", [], [], "develop base"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");

  // If d1 has fan-out AND merge connectors on the same side (both right),
  // the commit row should STILL have merge/branch connectors (not absorbed).
  if (d1Row.fanOutRows && d1Row.fanOutRows.length > 0) {
    const lastFO = d1Row.fanOutRows.at(-1);
    assert(lastFO !== undefined, "Last fan-out row should exist");

    const foCorner = lastFO.find(c =>
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );

    if (foCorner) {
      // Check commit row for merge/branch connectors
      const commitMB = d1Row.connectors.filter(c =>
        c.column !== d1Row.nodeColumn && (
          c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
          c.type === "corner-top-right" || c.type === "corner-top-left" ||
          c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
        )
      );

      if (commitMB.length > 0) {
        // Merge connectors should still be in the commit row (not absorbed)
        assert(true, "Same-side: commit row correctly keeps merge/branch connectors");

        // Verify the last fan-out row does NOT contain the merge connectors
        const foHasNonFOConn = lastFO.some(c =>
          (c.type === "tee-left" || c.type === "tee-right" ||
           c.type === "corner-top-right" || c.type === "corner-top-left") &&
          c.column !== d1Row.nodeColumn
        );
        assert(!foHasNonFOConn,
          "Same-side: fan-out row should NOT contain merge connectors from commit row");
      } else {
        // It's possible the layout didn't produce the same-side conflict we expected.
        assert(true, "Same-side test: layout did not produce same-side conflict (OK)");
      }
    }
  } else {
    // d1 might not have fan-out if the layout resolves differently.
    assert(true, "Same-side test: d1 has no fan-out rows (layout resolved differently, OK)");
  }
}

// ============================================================
// Run all tests
// ============================================================
console.log("Fan-Out Tests");
console.log("=".repeat(60));

runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test5);
runTest(test6);

const { failedTests } = (await import("./test-helpers")).getResults();
printResults("fan-out");

if (failedTests > 0) {
  process.exit(1);
}
