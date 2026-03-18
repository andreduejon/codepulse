#!/usr/bin/env bun
/**
 * Test script: verifies edge cases in the graph engine.
 *
 * Covers: octopus merges, single-commit repos, lane reuse,
 * multiple refs on same commit, and root commit handling.
 */
import { buildGraph } from "../src/git/graph";
import {
  makeCommit,
  assert,
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
//   █─┬─╮   m1  (develop)  ← octopus merge of d1 + a1 + b1
//   │ │ │
//   │ █ │   a1  (feat-A)
//   │ │ │
//   │ │ █   b1  (feat-B)
//   │ │ │
//   █ │ │   d1  ()
//   │ │ │
//   █─┼─╯
//   █─╯     d0  ()
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
//   █  abc123  (main)
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
//   █       d5  (develop)
//   │
//   █─╮     m2  ()  ← merges feat-B
//   │ │
//   │ █     b1  (feat-B)
//   │ │
//   █ │     d4  ()
//   │ │
//   █─┼─╮   m1  ()  ← merges feat-A
//   │ │ │
//   │ │ █   a1  (feat-A)
//   │ │ │
//   █─╯ │   d3  ()
//   │   │
//   │ █ │   r1  (release)  ← keeps col 1 alive
//   │ │ │
//   █─┼─╯
//   █─╯     d2  ()
//   │
//   █       d1  ()
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
//   █  d2  (develop, origin/develop, origin/HEAD)
//   │
//   █  d1
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
//   █  d2  (develop)
//   │
//   █  d1  ← root (no parents)
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
// Run all tests
// ============================================================
console.log("Edge Case Tests");
console.log("=".repeat(60));

runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test5);

const { failedTests } = (await import("./test-helpers")).getResults();
printResults("edge-case");

if (failedTests > 0) {
  process.exit(1);
}
