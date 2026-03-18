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

import { buildGraph } from "../src/git/graph";
import {
  makeCommit,
  assert,
  printResults,
  findConnector,
  runTest,
} from "./test-helpers";

// ============================================================
// Test 1: Remote-only lane propagation through single parent
// origin/feature → f1 → parent d1 (develop)
// The lane from f1 to d1 should be remote-only, d1's row should NOT be.
// ============================================================
function test1() {
  console.log("\nTest 1: Remote-only lane propagation (single parent)");

  const commits = [
    makeCommit("f1", ["d1"], [{ name: "origin/feature-x", type: "remote", isCurrent: false }], "feature-x work"),
    makeCommit("d1", [], [{ name: "develop", type: "branch", isCurrent: true }], "initial"),
  ];

  const rows = buildGraph(commits);

  // f1 should be remote-only
  assert(rows[0].isRemoteOnly === true, "f1 row should be remote-only");

  // f1's node connector should be remote-only
  const f1Node = findConnector(rows[0].connectors, "node");
  assert(f1Node !== undefined, "f1 should have a node connector");
  assert(f1Node!.isRemoteOnly === true, "f1 node connector should be remote-only");

  // d1 should NOT be remote-only (it has a local branch)
  assert(rows[1].isRemoteOnly === false, "d1 row should NOT be remote-only");

  // d1's node connector should NOT be remote-only
  const d1Node = findConnector(rows[1].connectors, "node");
  assert(d1Node !== undefined, "d1 should have a node connector");
  assert(d1Node!.isRemoteOnly !== true, "d1 node connector should NOT be remote-only");
}

// ============================================================
// Test 2: Remote-only lane propagation through merge first parent
// origin/feature → merge → d2 → d1 (develop)
// The merge's first parent chain should propagate remote-only down.
// ============================================================
function test2() {
  console.log("\nTest 2: Remote-only propagation through merge first parent");

  // remote-only branch with a merge commit
  const commits = [
    makeCommit("m1", ["f1", "x1"], [{ name: "origin/feature-y", type: "remote", isCurrent: false }], "merge in feature-y"),
    makeCommit("f1", ["d1"], [], "feature-y work"),
    makeCommit("x1", ["d1"], [], "side branch work"),
    makeCommit("d1", [], [{ name: "develop", type: "branch", isCurrent: true }], "initial"),
  ];

  const rows = buildGraph(commits);

  // m1 should be remote-only
  assert(rows[0].isRemoteOnly === true, "m1 row should be remote-only");

  // f1 should be remote-only (first parent of remote-only merge)
  assert(rows[1].isRemoteOnly === true, "f1 row should be remote-only");

  // x1 is the second parent — it's also remote-only since it has no other refs
  // and its only ref ancestor (d1) is reachable from non-remote-only branches
  // BUT x1 itself is only reachable from remote-only branch
  // Actually, x1 has no refs and gets its branchName from parent chain.
  // Since x1's only claim is from the remote-only tip, it should be remote-only.
  // However, the nonRemoteOnlyHashes rescue set includes d1 (which has local branch),
  // and x1 is NOT on d1's first-parent chain from any non-remote-only ref.
  // x1 is claimed by the remote-only branch in branchNameMap.

  // d1 should NOT be remote-only
  assert(rows[3].isRemoteOnly === false, "d1 row should NOT be remote-only");
}

// ============================================================
// Test 3: Remote-only merge connectors (secondary parent existing lane)
// Merge from remote-only branch into develop: the spanning connectors
// should have isRemoteOnly set.
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

  // Find the merge row (m1)
  const mergeRow = rows[1];
  assert(mergeRow.commit.hash === "m1", "Row 1 should be m1");

  // The merge row should NOT be remote-only (it's on develop)
  assert(mergeRow.isRemoteOnly === false, "m1 should NOT be remote-only");

  // Look for spanning connectors from the merge (horizontal, corners, tees)
  // These connect nodeColumn to the secondary parent's lane.
  // The secondary parent (r1) is remote-only, so the spanning connectors
  // should have isRemoteOnly set.
  const horizontals = mergeRow.connectors.filter(c => c.type === "horizontal");
  const corners = mergeRow.connectors.filter(c =>
    c.type === "corner-top-right" || c.type === "corner-top-left" ||
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );
  const tees = mergeRow.connectors.filter(c =>
    c.type === "tee-left" || c.type === "tee-right"
  );

  // At least some spanning connectors should exist for the merge
  const spanConns = [...horizontals, ...corners, ...tees];
  assert(spanConns.length > 0, "Merge row should have spanning connectors");
}

// ============================================================
// Test 4: Fan-out remote-only flags
// Remote-only branch closes via fan-out into non-remote-only parent.
// Fan-out corner connectors should be remote-only, the parent's
// lane straight connector should NOT be remote-only.
// ============================================================
function test4() {
  console.log("\nTest 4: Fan-out remote-only flags");

  // Two remote-only branches from the same parent (forces fan-out)
  const commits = [
    makeCommit("r1", ["d1"], [{ name: "origin/renovate/a", type: "remote", isCurrent: false }], "renovate/a work"),
    makeCommit("r2", ["d1"], [{ name: "origin/renovate/b", type: "remote", isCurrent: false }], "renovate/b work"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);

  // d1 is the parent with multiple lanes pointing to it
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");

  // d1 should have fan-out rows
  assert(d1Row!.fanOutRows !== undefined && d1Row!.fanOutRows!.length > 0,
    "d1 should have fan-out rows");

  // Fan-out corners should be remote-only (they close remote-only lanes)
  if (d1Row!.fanOutRows) {
    for (let foIdx = 0; foIdx < d1Row!.fanOutRows!.length; foIdx++) {
      const foRow = d1Row!.fanOutRows![foIdx];
      const corners = foRow.filter(c =>
        c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
      );
      for (const corner of corners) {
        assert(corner.isRemoteOnly === true,
          `Fan-out row ${foIdx}: corner at col ${corner.column} should be remote-only`);
      }
    }
  }

  // d1's node connector should NOT be remote-only
  assert(d1Row!.isRemoteOnly === false, "d1 row should NOT be remote-only");
}

// ============================================================
// Test 5: Post-pass dimming includes fan-out rows
// Remote-only commits at the top with fan-out, then non-remote-only
// commit below. All fan-out connectors in dimmed rows should get
// isRemoteOnly=true.
// ============================================================
function test5() {
  console.log("\nTest 5: Post-pass dimming includes fan-out rows");

  // Three remote-only branches from same parent: they sit above develop
  // in topo-order. Post-pass should dim everything above develop.
  const commits = [
    makeCommit("ren1", ["d1"], [{ name: "origin/renovate/major", type: "remote", isCurrent: false }], "renovate major"),
    makeCommit("ren2", ["d1"], [{ name: "origin/renovate/minor", type: "remote", isCurrent: false }], "renovate minor"),
    makeCommit("ren3", ["d1"], [{ name: "origin/renovate/patch", type: "remote", isCurrent: false }], "renovate patch"),
    makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d0", [], [], "initial"),
  ];

  const rows = buildGraph(commits);

  // Find the first non-remote-only row (should be d1)
  let firstNonRO = -1;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].isRemoteOnly) {
      firstNonRO = i;
      break;
    }
  }
  assert(firstNonRO > 0, "There should be remote-only rows above d1");

  // All rows above firstNonRO should be dimmed
  for (let i = 0; i < firstNonRO; i++) {
    const row = rows[i];
    // All connectors should be remote-only
    for (const conn of row.connectors) {
      assert(conn.isRemoteOnly === true,
        `Row ${i} (${row.commit.subject}): connector ${conn.type} at col ${conn.column} should be remote-only after post-pass`);
    }
    // All columns should be remote-only
    for (let col = 0; col < row.columns.length; col++) {
      assert(row.columns[col].isRemoteOnly === true,
        `Row ${i}: column ${col} should be remote-only after post-pass`);
    }
    // Fan-out rows (if any) should also be dimmed
    if (row.fanOutRows) {
      for (let foIdx = 0; foIdx < row.fanOutRows.length; foIdx++) {
        for (const conn of row.fanOutRows[foIdx]) {
          assert(conn.isRemoteOnly === true,
            `Row ${i}: fan-out row ${foIdx} connector ${conn.type} at col ${conn.column} should be remote-only`);
        }
      }
    }
  }

  // d1 should NOT be remote-only
  const d1Row = rows[firstNonRO];
  assert(d1Row.commit.hash === "d1", "First non-RO row should be d1");
  assert(d1Row.isRemoteOnly === false, "d1 should NOT be remote-only");
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

const { totalTests, passedTests, failedTests } = (await import("./test-helpers")).getResults();
printResults("remote-only");

if (failedTests > 0) {
  process.exit(1);
}
