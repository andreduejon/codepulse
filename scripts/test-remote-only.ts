#!/usr/bin/env bun
/**
 * Test script: verifies remote-only branch dimming and propagation.
 *
 * Remote-only branches (remote branches with no local counterpart) should
 * have `isRemoteOnly=true` on their lanes, connectors, and rows. This flag
 * propagates through single-parent chains, merge first-parents, secondary
 * parent connectors, fan-out rows, and is also applied by the post-pass
 * dimming logic.
 */

import type { GraphRow } from "../src/git/types";
import { buildGraph } from "../src/git/graph";
import {
  makeCommit,
  assert,
  printResults,
  findConnector,
  runTest,
  printGraph,
} from "./test-helpers";

/**
 * Assert that every connector, column, and fan-out connector on the given row
 * has `isRemoteOnly === true`. Used by tests that verify post-pass dimming.
 */
function assertRowFullyDimmed(row: GraphRow, rowIdx: number) {
  const label = `Row ${rowIdx} (${row.commit.hash})`;

  for (const conn of row.connectors) {
    assert(conn.isRemoteOnly === true,
      `${label}: connector ${conn.type}@col${conn.column} should be remote-only`);
  }

  for (let col = 0; col < row.columns.length; col++) {
    assert(row.columns[col].isRemoteOnly === true,
      `${label}: column ${col} should be remote-only`);
  }

  if (row.fanOutRows) {
    for (let foIdx = 0; foIdx < row.fanOutRows.length; foIdx++) {
      for (const conn of row.fanOutRows[foIdx]) {
        assert(conn.isRemoteOnly === true,
          `${label}: fan-out[${foIdx}] ${conn.type}@col${conn.column} should be remote-only`);
      }
    }
  }
}

// ============================================================
// Test 1: Remote-only lane propagation through single parent
//
// Graph:
//   █ f1  (origin/feature-x)  [RO]
//   │
//   █ d1  (develop)
//
// f1 carries a remote-only ref with no local counterpart, so its row
// and node connector should be isRemoteOnly. d1 has a local branch,
// so it should NOT be dimmed.
// ============================================================
function test1() {
  console.log("\nTest 1: Remote-only lane propagation (single parent)");

  const commits = [
    makeCommit("f1", ["d1"], [{ name: "origin/feature-x", type: "remote", isCurrent: false }], "feature-x work"),
    makeCommit("d1", [], [{ name: "develop", type: "branch", isCurrent: true }], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  // f1 should be remote-only
  assert(rows[0].isRemoteOnly, "f1 row should be remote-only");

  // f1's node connector should be remote-only
  const f1Node = findConnector(rows[0].connectors, "node");
  assert(f1Node !== undefined, "f1 should have a node connector");
  assert(f1Node.isRemoteOnly === true, "f1 node connector should be remote-only");

  // d1 should NOT be remote-only (it has a local branch)
  assert(!rows[1].isRemoteOnly, "d1 row should NOT be remote-only");

  // d1's node connector should NOT be remote-only
  const d1Node = findConnector(rows[1].connectors, "node");
  assert(d1Node !== undefined, "d1 should have a node connector");
  assert(d1Node.isRemoteOnly !== true, "d1 node connector should NOT be remote-only");
}

// ============================================================
// Test 2: Remote-only propagation through merge first parent
//
// Graph:
//   █─╮  m1  (origin/feature-y)  [RO]  ← merge of f1+x1
//   │ │
//   █ │  f1  [RO]  ← first parent of m1
//   │ │
//   │ █  x1        ← second parent of m1
//   │ │
//   █─╯  d1  (develop)  ← fan-out merges col 1 back into commit row
//
// m1 is remote-only (only origin/feature-y, no local ref).
// f1 inherits remote-only as m1's first parent.
// d1 has a local branch → NOT remote-only.
// ============================================================
function test2() {
  console.log("\nTest 2: Remote-only propagation through merge first parent");

  const commits = [
    makeCommit("m1", ["f1", "x1"], [{ name: "origin/feature-y", type: "remote", isCurrent: false }], "merge in feature-y"),
    makeCommit("f1", ["d1"], [], "feature-y work"),
    makeCommit("x1", ["d1"], [], "side branch work"),
    makeCommit("d1", [], [{ name: "develop", type: "branch", isCurrent: true }], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  // m1 should be remote-only
  assert(rows[0].isRemoteOnly, "m1 row should be remote-only");

  // f1 should be remote-only (first parent of remote-only merge)
  assert(rows[1].isRemoteOnly, "f1 row should be remote-only");

  // d1 should NOT be remote-only (has local branch)
  assert(!rows[3].isRemoteOnly, "d1 row should NOT be remote-only");
}

// ============================================================
// Test 3: Remote-only merge connectors (secondary parent)
//
// Graph:
//   █    d3  (develop)
//   │
//   █─╮  m1             ← merge: first parent d2, second parent r1
//   │ │
//   │ █  r1  (origin/remote-feat)  [RO]
//   │ │
//   █ │  d2
//   │ │
//   █─╯  d1             ← fan-out merges col 1 back into commit row
//
// m1 is on develop (NOT remote-only), but its second parent r1 is
// remote-only. The spanning connectors (horizontals, corners, tees)
// that connect m1's node to r1's lane should exist.
// ============================================================
function test3() {
  console.log("\nTest 3: Remote-only merge connectors (secondary parent)");

  const commits = [
    makeCommit("d3", ["m1"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("m1", ["d2", "r1"], [], "Merge remote feature"),
    makeCommit("r1", ["d1"], [{ name: "origin/remote-feat", type: "remote", isCurrent: false }], "remote feature work"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  // Find the merge row (m1)
  const mergeRow = rows[1];
  assert(mergeRow.commit.hash === "m1", "Row 1 should be m1");

  // The merge row should NOT be remote-only (it's on develop)
  assert(!mergeRow.isRemoteOnly, "m1 should NOT be remote-only");

  // Look for spanning connectors from the merge (horizontal, corners, tees)
  const spanTypes = new Set([
    "horizontal", "corner-top-right", "corner-top-left",
    "corner-bottom-right", "corner-bottom-left", "tee-left", "tee-right",
  ]);
  const spanConns = mergeRow.connectors.filter(c => spanTypes.has(c.type));
  assert(spanConns.length > 0, "Merge row should have spanning connectors");
}

// ============================================================
// Test 4: Fan-out remote-only flags
//
// Graph:
//   █    r1  (origin/renovate/a)  [RO]
//   │
//   │ █  r2  (origin/renovate/b)  [RO]
//   │ │
//   █─╯  d1  (develop)  ← fan-out merges col 1 back into commit row
//   │
//   █    d0
//
// Two remote-only branches share the same parent d1, producing a
// fan-out. The fan-out corner connectors should be remote-only,
// but d1 itself (with a local branch) should NOT be.
// ============================================================
function test4() {
  console.log("\nTest 4: Fan-out remote-only flags");

  const commits = [
    makeCommit("r1", ["d1"], [{ name: "origin/renovate/a", type: "remote", isCurrent: false }], "renovate/a work"),
    makeCommit("r2", ["d1"], [{ name: "origin/renovate/b", type: "remote", isCurrent: false }], "renovate/b work"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");
  assert(d1Row.fanOutRows !== undefined && d1Row.fanOutRows.length > 0,
    "d1 should have fan-out rows");

  // Fan-out corners should be remote-only (they close remote-only lanes)
  if (d1Row.fanOutRows) {
    for (let foIdx = 0; foIdx < d1Row.fanOutRows.length; foIdx++) {
      const corners = d1Row.fanOutRows[foIdx].filter(c =>
        c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
      );
      for (const corner of corners) {
        assert(corner.isRemoteOnly === true,
          `Fan-out[${foIdx}]: corner@col${corner.column} should be remote-only`);
      }
    }
  }

  // d1 itself should NOT be remote-only
  assert(!d1Row.isRemoteOnly, "d1 row should NOT be remote-only");
}

// ============================================================
// Test 5: Post-pass dimming includes fan-out rows
//
// Graph (as rendered — last fan-out row merges into commit row):
//   █        ren1  (origin/renovate/major)  [RO]
//   │
//   │ █      ren2  (origin/renovate/minor)  [RO]
//   │ │
//   │ │ █    ren3  (origin/renovate/patch)  [RO]
//   │ │ │
//   █─┼─╯    ← fan-out row 1 (separate): col 2 closes into col 0
//   █─╯      d1  (develop)  ← fan-out row 2 merged into commit row
//   │
//   █        d0
//
// Three remote-only branches from the same parent d1. Post-pass
// dimming should mark every row/connector/column above d1 as
// remote-only, including all fan-out rows.
// ============================================================
function test5() {
  console.log("\nTest 5: Post-pass dimming includes fan-out rows");

  const commits = [
    makeCommit("ren1", ["d1"], [{ name: "origin/renovate/major", type: "remote", isCurrent: false }], "renovate major"),
    makeCommit("ren2", ["d1"], [{ name: "origin/renovate/minor", type: "remote", isCurrent: false }], "renovate minor"),
    makeCommit("ren3", ["d1"], [{ name: "origin/renovate/patch", type: "remote", isCurrent: false }], "renovate patch"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);

  // Find the first non-remote-only row (should be d1)
  const firstNonRO = rows.findIndex(r => !r.isRemoteOnly);
  assert(firstNonRO > 0, "There should be remote-only rows above d1");

  // Every row above d1 should be fully dimmed (connectors + columns + fan-out)
  for (let i = 0; i < firstNonRO; i++) {
    assertRowFullyDimmed(rows[i], i);
  }

  // d1 itself should NOT be remote-only
  const d1Row = rows[firstNonRO];
  assert(d1Row.commit.hash === "d1", "First non-RO row should be d1");
  assert(!d1Row.isRemoteOnly, "d1 should NOT be remote-only");
}

// ============================================================
// Run all tests
// ============================================================
console.log("Remote-Only Tests");
console.log("=".repeat(60));

runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test5);

const { failedTests } = (await import("./test-helpers")).getResults();
printResults("remote-only");

if (failedTests > 0) {
  process.exit(1);
}
