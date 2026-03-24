#!/usr/bin/env bun
/**
 * Test script: verifies edge cases in the graph engine.
 *
 * Covers: octopus merges, single-commit repos, lane reuse,
 * multiple refs on same commit, root commit handling,
 * already-processed parent merging, and detached HEAD states.
 */
import { buildGraph } from "../src/git/graph";
import {
  makeCommit,
  assert,
  assertEqual,
  printResults,
  hasConnector,
  findConnector,
  runTest,
  printGraph,
} from "./test-helpers";

// ============================================================
// Test 1: Octopus merge (3 parents)
//
// Graph:
//   col: 0 1 2
//   ──────────
//        █─┬─╮  m1  (develop)  ← octopus merge of d1 + a1 + b1
//        │ │ │
//        │ █ │  a1  (feat-A)
//        │ │ │
//        │ │ █  b1  (feat-B)
//        │ │ │
//        █ │ │  d1
//        │ │ │
//        █─┼─╯
//        █─╯    d0
//
// A merge commit with 3 parents should produce spanning connectors
// for each secondary parent without crashing.
// ============================================================
function test1() {
  console.log("\nTest 1: Octopus merge (3 parents)");

  const commits = [
    makeCommit("m1", ["d1", "a1", "b1"], [{ name: "develop", type: "branch", isCurrent: true }], "Octopus merge"),
    makeCommit("a1", ["d0"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A"),
    makeCommit("b1", ["d0"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B"),
    makeCommit("d1", ["d0"], [], "develop work"),
    makeCommit("d0", [], [], "initial"),
  ];

  // Should not throw
  let rows: ReturnType<typeof buildGraph>;
  try {
    rows = buildGraph(commits);
    printGraph(rows);
    assert(true, "buildGraph did not crash on octopus merge");
  } catch (e) {
    assert(false, `buildGraph crashed on octopus merge: ${e}`);
    return;
  }

  // Merge row should exist and have a node
  const mergeRow = rows[0];
  assert(mergeRow.commit.hash === "m1", "First row should be m1");
  assert(hasConnector(mergeRow.connectors, "node", mergeRow.nodeColumn),
    "Merge row should have a node connector");

  // Should have spanning connectors for each secondary parent
  // At minimum: horizontals, corners, or tees connecting to parent lanes
  const spanTypes = new Set(["horizontal", "corner-top-right", "corner-top-left",
    "corner-bottom-right", "corner-bottom-left", "tee-left", "tee-right"]);
  const spanConnectors = mergeRow.connectors.filter(c => spanTypes.has(c.type));
  assert(spanConnectors.length >= 2,
    `Octopus merge should have spanning connectors for 2 secondary parents, got ${spanConnectors.length}`);
}

// ============================================================
// Test 2: Single-commit repo
//
// Graph:
//   col: 0
//   ──────
//        █  abc123  (main)
//
// A repo with just one commit and no parents should produce
// exactly one row with nodeColumn=0 and only a node connector.
// ============================================================
function test2() {
  console.log("\nTest 2: Single-commit repo");

  const commits = [
    makeCommit("abc123", [], [{ name: "main", type: "branch", isCurrent: true }], "Initial commit"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  assert(rows.length === 1, `Should have 1 row, got ${rows.length}`);
  assert(rows[0].nodeColumn === 0, `nodeColumn should be 0, got ${rows[0].nodeColumn}`);

  const nodeConn = findConnector(rows[0].connectors, "node");
  assert(nodeConn !== undefined, "Should have a node connector");
  assert(nodeConn.column === 0, "Node should be at column 0");

  // Should only have one meaningful connector (the node)
  const nonEmpty = rows[0].connectors.filter(c => c.type !== "empty");
  assert(nonEmpty.length === 1,
    `Should have only 1 non-empty connector, got ${nonEmpty.length}`);

  // No fan-out rows
  assert(rows[0].fanOutRows === undefined, "Single commit should have no fan-out rows");
}

// ============================================================
// Test 3: Lane reuse (freed interior column)
//
// Graph:
//   col: 0 1 2
//   ──────────
//        █      d5  (develop)
//        │
//        █─╮    m2  ← merges feat-B
//        │ │
//        │ █    b1  (feat-B)
//        │ │
//        █ │    d4
//        │ │
//        █─┼─╮  m1  ← merges feat-A
//        │ │ │
//        │ │ █  a1  (feat-A)
//        │ │ │
//        █─╯ │  d3
//        │   │
//        │ █ │  r1  (release)  ← keeps col 1 alive
//        │ │ │
//        █─┼─╯
//        █─╯    d2
//        │
//        █      d1
//
// feat-A merges and frees its lane. feat-B starts later and
// should reuse the freed column. Release keeps a lane alive
// so there's an interior gap to reuse.
// ============================================================
function test3() {
  console.log("\nTest 3: Lane reuse (freed interior column)");

  const commits = [
    makeCommit("d5", ["m2"], [{ name: "develop", type: "branch", isCurrent: true }], "develop after merge B"),
    makeCommit("m2", ["d4", "b1"], [], "Merge feat-B"),
    makeCommit("b1", ["d3"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work"),
    makeCommit("d4", ["m1"], [], "develop after merge A"),
    makeCommit("m1", ["d3", "a1"], [], "Merge feat-A"),
    makeCommit("a1", ["d2"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work"),
    makeCommit("d3", ["d2"], [], "develop work 3"),
    makeCommit("r1", ["d2"], [{ name: "release", type: "branch", isCurrent: false }], "release tip"),
    makeCommit("d2", ["d1"], [], "develop work 2"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  // Verify the graph builds without errors
  assert(rows.length === 10, `Should have 10 rows, got ${rows.length}`);

  // Find feat-A and feat-B node columns
  const aRow = rows.find(r => r.commit.hash === "a1");
  const bRow = rows.find(r => r.commit.hash === "b1");
  assert(aRow !== undefined, "feat-A row should exist");
  assert(bRow !== undefined, "feat-B row should exist");

  // If lane reuse works, the graph should be compact —
  // the max column used shouldn't grow unnecessarily.
  const maxUsedCol = Math.max(...rows.map(r => r.nodeColumn));
  // With develop + release + feat-A/B, we need at most 3 columns simultaneously
  assert(maxUsedCol <= 3,
    `Max column should be <= 3 with lane reuse, got ${maxUsedCol}`);
}

// ============================================================
// Test 4: Multiple refs on same commit
//
// Graph:
//   col: 0
//   ──────
//        █  d2  (develop, origin/develop, origin/HEAD)
//        │
//        █  d1
//
// develop, origin/develop, origin/HEAD all on same commit.
// Should NOT create duplicate lanes — only 1 column needed.
// ============================================================
function test4() {
  console.log("\nTest 4: Multiple refs on same commit");

  const commits = [
    makeCommit("d2", ["d1"], [
      { name: "develop", type: "branch", isCurrent: true },
      { name: "origin/develop", type: "remote", isCurrent: false },
      { name: "origin/HEAD", type: "remote", isCurrent: false },
    ], "develop tip"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  assert(rows.length === 2, `Should have 2 rows, got ${rows.length}`);

  // d2 should use exactly 1 column
  assert(rows[0].nodeColumn === 0, "d2 should be at column 0");
  assert(rows[0].columns.length <= 1,
    `d2 should have at most 1 column, got ${rows[0].columns.length}`);

  // d1 should also use 1 column
  assert(rows[1].columns.length <= 1,
    `d1 should have at most 1 column, got ${rows[1].columns.length}`);
}

// ============================================================
// Test 5: Root commit handling
//
// Graph:
//   col: 0
//   ──────
//        █  d2  (develop)
//        │
//        █  d1  ← root (no parents)
//
// A root commit (no parents) should close its lane.
// No active columns should remain after the root row.
// ============================================================
function test5() {
  console.log("\nTest 5: Root commit handling");

  const commits = [
    makeCommit("d2", ["d1"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d1", [], [], "initial (root)"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  // d1 is the root
  const rootRow = rows[1];
  assert(rootRow.commit.hash === "d1", "Row 1 should be d1 (root)");

  // Root's node connector should exist
  assert(hasConnector(rootRow.connectors, "node", rootRow.nodeColumn),
    "Root should have a node connector");

  // After root, the lane should be closed — columns should show inactive
  // or there should be no active columns in rootRow.columns
  const activeColumns = rootRow.columns.filter(c => c.active);
  assert(activeColumns.length === 0,
    `Root row should have 0 active columns after processing, got ${activeColumns.length}`);
}

// ============================================================
// Test 6: Single-parent already-processed merging — lane closes
//
// Graph:
//   col: 0 1
//   ────────
//        █    c1  (feat-A)
//        │
//        █    p1  (main)
//        │
//        ├─█  c2  (feat-B)
//        │
//        █    root
//
// c2 finds p1 in processedColumns → lane closes with connectors
// toward p1's column.
// ============================================================
function test6() {
  console.log("\nTest 6: Single-parent, parent already processed — lane closes");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], []),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: true }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  const c2Row = rows.find(r => r.commit.hash === "c2");
  assert(c2Row !== undefined, "c2 row should exist");

  // c2 should have merge/close connectors pointing toward p1's column
  const closeConns = c2Row.connectors.filter(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left" ||
    c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "horizontal"
  );
  assert(closeConns.length > 0, "c2 should have close/merge connectors toward p1");

  // p1's row should still have an active column for its own lane to root
  const p1Row = rows.find(r => r.commit.hash === "p1");
  assert(p1Row !== undefined, "p1 row should exist");
  assert(p1Row.columns.some(c => c.active), "p1 should have at least one active column");
}

// ============================================================
// Test 7: Single-parent already-processed with existing lane — merge
//
// Graph (same topology as test6, different assertion focus):
//   col: 0 1
//   ────────
//        █    c1  (feat-A)
//        │
//        █    p1  (main)
//        │
//        ├─█  c2  (feat-B)
//        │
//        █    root
//
// c2 finds p1 in both lanes[] and processedColumns → triggers
// Case A (existingLane !== nodeColumn && processedColumns.has).
// ============================================================
function test7() {
  console.log("\nTest 7: Single-parent, parent already processed with existing lane — merge");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  const c2Row = rows.find(r => r.commit.hash === "c2");
  const p1Row = rows.find(r => r.commit.hash === "p1")!;
  assert(c2Row !== undefined, "c2 row should exist");
  assert(p1Row !== undefined, "p1 row should exist");

  // c2 is to the right of p1's lane. It should merge left toward p1.
  const spanConns = c2Row.connectors.filter(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left" ||
    c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "horizontal"
  );
  assert(spanConns.length > 0, "c2 should have spanning connectors merging toward p1");
}

// ============================================================
// Test 8: parentColors populated correctly after already-processed merge
//
// Graph (same topology as tests 6-7):
//   col: 0 1
//   ────────
//        █    c1  (feat-A)
//        │
//        █    p1  (main)
//        │
//        ├─█  c2  (feat-B) ← parentColors[0] should be a valid number
//        │
//        █    root
//
// Verifies c2's parentColors array has exactly 1 numeric entry.
// ============================================================
function test8() {
  console.log("\nTest 8: parentColors set correctly after already-processed merge");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  const c2Row = rows.find(r => r.commit.hash === "c2")!;
  // c2's parentColors should have exactly 1 entry (single parent)
  assertEqual(c2Row.parentColors.length, 1, "c2 should have 1 parentColor");
  // parentColors[0] should be defined (not NaN or undefined)
  assert(typeof c2Row.parentColors[0] === "number", "c2 parentColor should be a number");
}

// ============================================================
// Test 9: Detached HEAD on current branch path
//
// Graph:
//   col: 0
//   ──────
//        █  d2  (HEAD, detached)
//        │
//        █  d1  (main)
//
// Detached HEAD commit should be on the current branch path.
// ============================================================
function test9() {
  console.log("\nTest 9: Detached HEAD is on current branch path");

  const commits = [
    makeCommit("d2", ["d1"], [{ name: "HEAD", type: "head", isCurrent: true }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: false }]),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  // HEAD commit should be marked as on current branch
  assert(rows[0].isOnCurrentBranch, "Detached HEAD commit should be on current branch path");
}

// ============================================================
// Test 10: Detached HEAD commit is NOT remote-only
//
// Graph:
//   col: 0
//   ──────
//        █  d2  (HEAD, detached) ← NOT remote-only
//        │
//        █  d1  (main)
//
// "head" ref type returns false for hasNonRemoteOnlyRef, but d2 is
// rescued by current-branch walk (d1 has a local branch).
// ============================================================
function test10() {
  console.log("\nTest 10: Detached HEAD commit is not remote-only");

  const commits = [
    makeCommit("d2", ["d1"], [{ name: "HEAD", type: "head", isCurrent: true }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: false }]),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  assert(!rows[0].isRemoteOnly,
    "Detached HEAD commit should NOT be remote-only");
}

// ============================================================
// Test 11: Detached HEAD branchName assigned from branchNameMap
//
// Graph:
//   col: 0
//   ──────
//        █  d2  (HEAD) ← branchName = "HEAD" (priority 4)
//        │
//        █  d1  (main) ← branchName = "main" (priority 1-2)
//
// d2 is only on HEAD's first-parent chain, not main's, so
// branchName = "HEAD".
// ============================================================
function test11() {
  console.log("\nTest 11: Detached HEAD branchName assigned from branchNameMap");

  const commits = [
    makeCommit("d2", ["d1"], [{ name: "HEAD", type: "head", isCurrent: true }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: false }]),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  assertEqual(rows[0].branchName, "HEAD", "Detached HEAD commit branchName should be 'HEAD'");
}

// ============================================================
// Test 12: Standalone detached HEAD (no other branches)
//
// Graph:
//   col: 0
//   ──────
//        █  d1  (HEAD, detached, standalone)
//
// Single commit with only a "head" ref. Should be on current
// branch, have branchName "HEAD", and node at col 0.
// ============================================================
function test12() {
  console.log("\nTest 12: Standalone detached HEAD (no other branches)");

  const commits = [
    makeCommit("d1", [], [{ name: "HEAD", type: "head", isCurrent: true }]),
  ];
  const rows = buildGraph(commits);
  printGraph(rows);

  assert(rows[0].isOnCurrentBranch, "Standalone HEAD should be on current branch");
  assertEqual(rows[0].branchName, "HEAD", "Standalone HEAD branchName should be 'HEAD'");
  // Single commit, no parent — should have a node connector
  assert(hasConnector(rows[0].connectors, "node", 0), "Standalone HEAD should have node at col 0");
}

// ============================================================
// Run all tests
// ============================================================
console.log("Edge Case Tests");
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

const { failedTests } = (await import("./test-helpers")).getResults();
printResults("edge-case");

if (failedTests > 0) {
  process.exit(1);
}
