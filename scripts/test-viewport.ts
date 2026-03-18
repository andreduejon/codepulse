#!/usr/bin/env bun
/**
 * Test script: verifies the sliding graph viewport functions.
 *
 * Covers: computeViewportOffsets, computeSingleViewportOffset,
 * sliceGraphToViewport, getMaxGraphColumns, buildEdgeIndicator.
 */

import { buildGraph, computeViewportOffsets, computeSingleViewportOffset, renderGraphRow, renderConnectorRow, sliceGraphToViewport, getMaxGraphColumns, buildEdgeIndicator } from "../src/git/graph";
import type { GraphChar, RenderOptions } from "../src/git/graph";
import {
  makeCommit,
  assert,
  resetResults,
  printResults,
  runTest,
} from "./test-helpers";


// ============================================================
// Test 1: computeViewportOffsets — no sliding when limit >= maxColumns
// ============================================================
function test1() {
  console.log("\nTest 1: No sliding when depth limit >= max columns");

  const commits = [
    makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["c3"]),
    makeCommit("c3", []),
  ];

  const rows = buildGraph(commits);
  const maxCols = getMaxGraphColumns(rows);
  const offsets = computeViewportOffsets(rows, maxCols + 5, maxCols);

  assert(offsets.length === rows.length, "Should have one offset per row");
  for (let i = 0; i < offsets.length; i++) {
    assert(offsets[i] === 0, `Offset ${i} should be 0 when limit >= maxColumns`);
  }
}

// ============================================================
// Test 2: computeViewportOffsets — basic sliding for branched graph
// ============================================================
function test2() {
  console.log("\nTest 2: Basic sliding for branched graph");

  // Create a graph where a commit appears at column > depthLimit
  // c1 is on main, c2 merges feat branches, spreading lanes wide.
  const commits = [
    makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("f1", ["c3"], [{ name: "feat-1", type: "branch", isCurrent: false }]),
    makeCommit("f2", ["c3"], [{ name: "feat-2", type: "branch", isCurrent: false }]),
    makeCommit("f3", ["c3"], [{ name: "feat-3", type: "branch", isCurrent: false }]),
    makeCommit("f4", ["c3"], [{ name: "feat-4", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["c3"]),
    makeCommit("c3", []),
  ];

  const rows = buildGraph(commits);
  const maxCols = getMaxGraphColumns(rows);

  // Use a small depth limit
  const depthLimit = 3;
  const offsets = computeViewportOffsets(rows, depthLimit, maxCols);

  assert(offsets.length === rows.length, "Should have one offset per row");

  // Each row's node should be within its viewport
  for (let i = 0; i < rows.length; i++) {
    const nc = rows[i].nodeColumn;
    const off = offsets[i];
    assert(nc >= off && nc < off + depthLimit,
      `Row ${i} (node col ${nc}): offset ${off} should keep node in viewport [${off}, ${off + depthLimit})`);
  }
}

// ============================================================
// Test 3: computeViewportOffsets — smooth camera (minimal shifts)
// ============================================================
function test3() {
  console.log("\nTest 3: Smooth camera follow - offset doesn't jump unnecessarily");

  // Linear graph: all at column 0
  const commits = [
    makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("b", ["c"]),
    makeCommit("c", ["d"]),
    makeCommit("d", []),
  ];

  const rows = buildGraph(commits);
  const maxCols = getMaxGraphColumns(rows);
  const offsets = computeViewportOffsets(rows, 2, maxCols);

  // All on column 0 with depth limit 2: all offsets should be 0
  for (let i = 0; i < offsets.length; i++) {
    assert(offsets[i] === 0, `Row ${i} offset should be 0 for linear graph at col 0`);
  }
}

// ============================================================
// Test 4: sliceGraphToViewport — basic slicing
// ============================================================
function test4() {
  console.log("\nTest 4: Basic graph char slicing");

  // Create a wide graph and slice it
  const commits = [
    makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("f1", ["c3"], [{ name: "f1", type: "branch", isCurrent: false }]),
    makeCommit("f2", ["c3"], [{ name: "f2", type: "branch", isCurrent: false }]),
    makeCommit("f3", ["c3"], [{ name: "f3", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["c3"]),
    makeCommit("c3", []),
  ];

  const rows = buildGraph(commits);
  const maxCols = getMaxGraphColumns(rows);
  const opts: RenderOptions = { padToColumns: maxCols };

  // Render a row that has content at multiple columns
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fullChars = renderGraphRow(row, opts);

    // Full width should be maxCols * 2 characters
    let fullWidth = 0;
    for (const gc of fullChars) fullWidth += gc.char.length;
    assert(fullWidth === maxCols * 2,
      `Row ${i}: full width should be ${maxCols * 2}, got ${fullWidth}`);

    // Slice to depth limit 3
    const depthLimit = 3;
    const sliced = sliceGraphToViewport(fullChars, 0, depthLimit, row, opts);

    // Sliced width should be depthLimit * 2 characters
    let slicedWidth = 0;
    for (const gc of sliced) slicedWidth += gc.char.length;
    assert(slicedWidth === depthLimit * 2,
      `Row ${i}: sliced width should be ${depthLimit * 2}, got ${slicedWidth}`);
  }
}

// ============================================================
// Test 5: buildEdgeIndicator — single right-side edge indicator
// ============================================================
function test5() {
  console.log("\nTest 5: Edge indicator (single right-side column)");

  const mutedColor = "#6c7086";
  const depthLimit = 4;
  const maxColumns = 12;

  // 5a: Node to the LEFT of viewport → ◀
  {
    const result = buildEdgeIndicator(0, 2, depthLimit, maxColumns, mutedColor, true);
    assert(result.char === "◀ ", "5a: Should show '◀ ' when node is left of viewport");
    assert(result.color === mutedColor, "5a: Indicator color should be muted");
  }

  // 5b: Node to the RIGHT of viewport → ▶
  {
    const result = buildEdgeIndicator(10, 2, depthLimit, maxColumns, mutedColor, true);
    assert(result.char === " ▶", "5b: Should show ' ▶' when node is right of viewport");
    assert(result.color === mutedColor, "5b: Indicator color should be muted");
  }

  // 5c: Node WITHIN viewport → blank
  {
    const result = buildEdgeIndicator(3, 2, depthLimit, maxColumns, mutedColor, true);
    assert(result.char === "  ", "5c: Should be blank when node is in viewport");
  }

  // 5d: Node at left edge of viewport (nodeColumn === viewportOffset) → blank
  {
    const result = buildEdgeIndicator(2, 2, depthLimit, maxColumns, mutedColor, true);
    assert(result.char === "  ", "5d: Blank when node is at viewport left edge");
  }

  // 5e: Node at right edge (nodeColumn === viewportEnd - 1) → blank
  {
    const result = buildEdgeIndicator(5, 2, depthLimit, maxColumns, mutedColor, true);
    assert(result.char === "  ", "5e: Blank when node is at viewport right edge");
  }

  // 5f: Connector row (isCommitRow=false) → always blank
  {
    const result = buildEdgeIndicator(0, 2, depthLimit, maxColumns, mutedColor, false);
    assert(result.char === "  ", "5f: Connector row always blank");
  }

  // 5g: Viewport not active (depthLimit >= maxColumns) → blank
  {
    const result = buildEdgeIndicator(5, 0, maxColumns, maxColumns, mutedColor, true);
    assert(result.char === "  ", "5g: No indicator when viewport not active");
  }

  // 5h: Node exactly at viewportEnd → ▶
  {
    const result = buildEdgeIndicator(6, 2, depthLimit, maxColumns, mutedColor, true);
    assert(result.char === " ▶", "5h: Right indicator when nodeColumn === viewportEnd");
  }
}

// ============================================================
// Test 6: sliceGraphToViewport — no-op when viewport covers full width
// ============================================================
function test6() {
  console.log("\nTest 6: No slicing when viewport covers full width");

  const commits = [
    makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("b", []),
  ];

  const rows = buildGraph(commits);
  const maxCols = getMaxGraphColumns(rows);
  const opts: RenderOptions = { padToColumns: maxCols };

  const row = rows[0];
  const fullChars = renderGraphRow(row, opts);
  const sliced = sliceGraphToViewport(fullChars, 0, maxCols, row, opts);

  // Should return the same chars (no-op)
  assert(sliced === fullChars, "Should return same array when no slicing needed");
}

// ============================================================
// Test 7: computeViewportOffsets — node at high column shifts viewport right
// ============================================================
function test7() {
  console.log("\nTest 7: Node at high column triggers rightward shift");

  // Build a graph where some commits are at col 0, then one is far right
  const commits = [
    makeCommit("m1", ["m2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("f1", ["b1"], [{ name: "f1", type: "branch", isCurrent: false }]),
    makeCommit("f2", ["b1"], [{ name: "f2", type: "branch", isCurrent: false }]),
    makeCommit("f3", ["b1"], [{ name: "f3", type: "branch", isCurrent: false }]),
    makeCommit("f4", ["b1"], [{ name: "f4", type: "branch", isCurrent: false }]),
    makeCommit("f5", ["b1"], [{ name: "f5", type: "branch", isCurrent: false }]),
    makeCommit("m2", ["b1"]),
    makeCommit("b1", []),
  ];

  const rows = buildGraph(commits);
  const maxCols = getMaxGraphColumns(rows);
  const depthLimit = 4;

  if (maxCols > depthLimit) {
    const offsets = computeViewportOffsets(rows, depthLimit, maxCols);

    // Find the highest-column commit
    let maxNodeCol = 0;
    let maxNodeIdx = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].nodeColumn > maxNodeCol) {
        maxNodeCol = rows[i].nodeColumn;
        maxNodeIdx = i;
      }
    }

    if (maxNodeCol >= depthLimit) {
      assert(offsets[maxNodeIdx] > 0,
        `Offset for row at col ${maxNodeCol} should be > 0 (got ${offsets[maxNodeIdx]})`);
      assert(maxNodeCol >= offsets[maxNodeIdx] && maxNodeCol < offsets[maxNodeIdx] + depthLimit,
        `Node col ${maxNodeCol} should be within viewport [${offsets[maxNodeIdx]}, ${offsets[maxNodeIdx] + depthLimit})`);
    } else {
      assert(true, "Highest node col fits in viewport (skipped shift check)");
    }
  } else {
    assert(true, "Graph not wide enough for shift test (skipped)");
  }
}

// ============================================================
// Test 8: sliceGraphToViewport — connector row slicing
// ============================================================
function test8() {
  console.log("\nTest 8: Connector row slicing");

  const commits = [
    makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("f1", ["c3"], [{ name: "f1", type: "branch", isCurrent: false }]),
    makeCommit("f2", ["c3"], [{ name: "f2", type: "branch", isCurrent: false }]),
    makeCommit("c2", ["c3"]),
    makeCommit("c3", []),
  ];

  const rows = buildGraph(commits);
  const maxCols = getMaxGraphColumns(rows);
  const opts: RenderOptions = { padToColumns: maxCols };

  // Connector rows should also slice properly
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const connChars = renderConnectorRow(row, opts);
    const depthLimit = 2;
    const sliced = sliceGraphToViewport(connChars, 0, depthLimit, row, opts);

    let slicedWidth = 0;
    for (const gc of sliced) slicedWidth += gc.char.length;
    assert(slicedWidth === depthLimit * 2,
      `Row ${i} connector: sliced width should be ${depthLimit * 2}, got ${slicedWidth}`);
  }
}

// ============================================================
// Test 9: computeSingleViewportOffset — reactive viewport scrolling
// ============================================================
function test9() {
  console.log("\nTest 9: Single viewport offset (reactive scrolling)");

  const depthLimit = 4;
  const maxColumns = 12;

  // Start at offset 0, node at column 0 — stays at 0
  let offset = computeSingleViewportOffset(0, 0, depthLimit, maxColumns);
  assert(offset === 0, "Node at col 0: offset should be 0");

  // Node at column 3 — still within viewport [0, 4), stays at 0
  offset = computeSingleViewportOffset(offset, 3, depthLimit, maxColumns);
  assert(offset === 0, "Node at col 3: offset should still be 0");

  // Node at column 5 — outside viewport [0, 4), shifts right
  offset = computeSingleViewportOffset(offset, 5, depthLimit, maxColumns);
  assert(offset > 0, "Node at col 5: offset should shift right");
  assert(5 >= offset && 5 < offset + depthLimit,
    `Node col 5 should be within viewport [${offset}, ${offset + depthLimit})`);

  // Node at column 10 — far right
  offset = computeSingleViewportOffset(offset, 10, depthLimit, maxColumns);
  assert(10 >= offset && 10 < offset + depthLimit,
    `Node col 10 should be within viewport [${offset}, ${offset + depthLimit})`);
  assert(offset <= maxColumns - depthLimit,
    `Offset ${offset} should not exceed maxColumns - depthLimit (${maxColumns - depthLimit})`);

  // Node back at column 0 — shifts left
  offset = computeSingleViewportOffset(offset, 0, depthLimit, maxColumns);
  assert(0 >= offset && 0 < offset + depthLimit,
    `Node col 0 should be within viewport [${offset}, ${offset + depthLimit})`);

  // No sliding when depthLimit >= maxColumns
  offset = computeSingleViewportOffset(5, 10, maxColumns, maxColumns);
  assert(offset === 0, "No sliding when depthLimit >= maxColumns");
}

// ============================================================
// Run all tests
// ============================================================
resetResults();

runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test5);
runTest(test6);
runTest(test7);
runTest(test8);
runTest(test9);

printResults("viewport");
const { failedTests } = await import("./test-helpers").then(m => m.getResults());
process.exit(failedTests > 0 ? 1 : 0);
