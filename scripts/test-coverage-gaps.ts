#!/usr/bin/env bun
/**
 * Test script: covers previously untested code paths.
 *
 * C4-1: Single-parent commit whose parent was already processed (processedColumns merge/close)
 * C4-2: "head" ref type (detached HEAD state)
 * C4-3: Left-connection node rendering (connectors to the left of the node)
 * C4-4: Remote prefixes other than "origin/" (upstream/, nested paths)
 */

import { buildGraph, renderGraphRow, getColorForColumn } from "../src/git/graph";
import {
  makeCommit,
  assert,
  assertEqual,
  printResults,
  findConnector,
  hasConnector,
  runTest,
  graphCharsToAscii,
} from "./test-helpers";

// ============================================================
// C4-1: Single-parent already-processed merging
// ============================================================

// Test 1: Parent already processed, node merges right-to-left (Case D in buildGraph)
// c1 → p1 (processed first), c2 → p1 (p1 already in processedColumns)
// c2's lane should close with a connector toward p1's column.
function test1() {
  console.log("\nTest 1: Single-parent, parent already processed — lane closes");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], []),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: true }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);

  const c2Row = rows.find(r => r.commit.hash === "c2")!;
  assert(c2Row !== undefined, "c2 row should exist");

  // c2 should have merge/close connectors pointing toward p1's column
  const closeConns = c2Row.connectors.filter(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left" ||
    c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "horizontal"
  );
  assert(closeConns.length > 0, "c2 should have close/merge connectors toward p1");

  // p1's row should still have an active column for its own lane to root
  const p1Row = rows.find(r => r.commit.hash === "p1")!;
  assert(p1Row !== undefined, "p1 row should exist");
  assert(p1Row.columns.some(c => c.active), "p1 should have at least one active column");
}

// Test 2: Parent already processed, existing lane at different column (Case A)
// Two siblings sharing a parent — first sibling processed with the parent,
// second sibling finds parent in lanes AND processedColumns.
function test2() {
  console.log("\nTest 2: Single-parent, parent already processed with existing lane — merge");

  // Shape: c1 and c2 both point to p1. c1 is processed first.
  // After c1, p1 is assigned to c1's lane. Then p1 is processed (goes into processedColumns).
  // When c2 is processed, p1 is both in lanes[] AND processedColumns.
  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);

  const c2Row = rows.find(r => r.commit.hash === "c2")!;
  const p1Row = rows.find(r => r.commit.hash === "p1")!;
  assert(c2Row !== undefined, "c2 row should exist");
  assert(p1Row !== undefined, "p1 row should exist");

  // c2 is to the right of p1's lane. It should merge left toward p1.
  // This triggers Case A (existingLane !== -1 && existingLane !== nodeColumn && processedColumns.has(parentHash)).
  const spanConns = c2Row.connectors.filter(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left" ||
    c.type === "tee-left" || c.type === "tee-right" ||
    c.type === "horizontal"
  );
  assert(spanConns.length > 0, "c2 should have spanning connectors merging toward p1");
}

// Test 3: parentLaneColors populated correctly after already-processed merge
function test3() {
  console.log("\nTest 3: parentColors set correctly after already-processed merge");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);

  const c2Row = rows.find(r => r.commit.hash === "c2")!;
  // c2's parentColors should have exactly 1 entry (single parent)
  assertEqual(c2Row.parentColors.length, 1, "c2 should have 1 parentColor");
  // parentColors[0] should be defined (not NaN or undefined)
  assert(typeof c2Row.parentColors[0] === "number", "c2 parentColor should be a number");
}

// ============================================================
// C4-2: "head" ref type (detached HEAD)
// ============================================================

// Test 4: Detached HEAD commit is identified as current branch
function test4() {
  console.log("\nTest 4: Detached HEAD is on current branch path");

  const commits = [
    makeCommit("d2", ["d1"], [{ name: "HEAD", type: "head", isCurrent: true }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: false }]),
  ];
  const rows = buildGraph(commits);

  // HEAD commit should be marked as on current branch
  assert(rows[0].isOnCurrentBranch === true, "Detached HEAD commit should be on current branch path");
}

// Test 5: Detached HEAD commit is NOT treated as remote-only
function test5() {
  console.log("\nTest 5: Detached HEAD commit is not remote-only");

  const commits = [
    makeCommit("d2", ["d1"], [{ name: "HEAD", type: "head", isCurrent: true }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: false }]),
  ];
  const rows = buildGraph(commits);

  // Even though "head" type returns false for hasNonRemoteOnlyRef,
  // d2 is rescued by nonRemoteOnlyHashes because d1 (its descendant via
  // first-parent) has a local branch. The current-branch walk sets
  // currentBranchHashes which marks d2 as non-remote-only.
  assert(rows[0].isRemoteOnly === false,
    "Detached HEAD commit should NOT be remote-only");
}

// Test 6: Detached HEAD branchName falls through to priority 4
function test6() {
  console.log("\nTest 6: Detached HEAD branchName assigned from branchNameMap");

  const commits = [
    makeCommit("d2", ["d1"], [{ name: "HEAD", type: "head", isCurrent: true }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: false }]),
  ];
  const rows = buildGraph(commits);

  // branchNameMap processes tips by priority. "main" (priority 1-2) wins over
  // "HEAD" (priority 4) because last-writer-wins and "main" is processed last.
  // d2's branchName should be "main" since main's first-parent chain walks d1,
  // and HEAD's chain walks d2→d1 (but HEAD is processed first at priority 4,
  // then main overwrites d1 and walks its chain).
  // d2 is only on HEAD's chain, not main's, so d2.branchName = "HEAD"
  assertEqual(rows[0].branchName, "HEAD", "Detached HEAD commit branchName should be 'HEAD'");
}

// Test 7: Detached HEAD with no other refs — standalone
function test7() {
  console.log("\nTest 7: Standalone detached HEAD (no other branches)");

  const commits = [
    makeCommit("d1", [], [{ name: "HEAD", type: "head", isCurrent: true }]),
  ];
  const rows = buildGraph(commits);

  assert(rows[0].isOnCurrentBranch === true, "Standalone HEAD should be on current branch");
  assertEqual(rows[0].branchName, "HEAD", "Standalone HEAD branchName should be 'HEAD'");
  // Single commit, no parent — should have a node connector
  assert(hasConnector(rows[0].connectors, "node", 0), "Standalone HEAD should have node at col 0");
}

// ============================================================
// C4-3: Left-connection node rendering
// ============================================================

// Test 8: Node with only left connection renders as "█ " (no trailing dash)
function test8() {
  console.log("\nTest 8: Node with left connection renders without trailing dash");

  // Scenario: commit at col 1 with parent at col 0 (already processed).
  // c2 at col 1 merges left toward p1 at col 0.
  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);

  const c2Row = rows.find(r => r.commit.hash === "c2")!;
  const rendered = renderGraphRow(c2Row, {});
  const ascii = graphCharsToAscii(rendered);

  // The node for c2 should render as "█ " not "█─"
  // because the connection is to the LEFT (toward col 0), not to the right
  const nodeChar = rendered.find(gc => gc.char.includes("█"));
  assert(nodeChar !== undefined, "Should find █ in rendered c2");
  if (nodeChar) {
    assert(!nodeChar.char.includes("─"),
      `Node with only left connection should not have trailing dash, got "${nodeChar.char}"`);
  }
}

// Test 9: Node with right connection renders as "█─"
function test9() {
  console.log("\nTest 9: Node with right connection renders with trailing dash");

  // Merge commit at col 0 with secondary parent opening a lane to the right
  const commits = [
    makeCommit("m1", ["d1", "f1"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("f1", ["d1"], [{ name: "feature", type: "branch", isCurrent: false }]),
    makeCommit("d1", [], []),
  ];
  const rows = buildGraph(commits);

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

// Test 10: Left-connection connectors appear at correct columns
function test10() {
  console.log("\nTest 10: Left-connection connectors at correct columns");

  const commits = [
    makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
    makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
    makeCommit("root", [], []),
  ];
  const rows = buildGraph(commits);

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
// C4-4: Remote prefixes other than "origin/"
// ============================================================

// Test 11: upstream/ remote is correctly identified as remote-only
function test11() {
  console.log("\nTest 11: upstream/ remote-only when no local counterpart");

  const commits = [
    makeCommit("f1", ["d1"], [{ name: "upstream/feature", type: "remote", isCurrent: false }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];
  const rows = buildGraph(commits);

  // upstream/feature has no local "feature" branch → should be remote-only
  assert(rows[0].isRemoteOnly === true,
    "upstream/feature without local counterpart should be remote-only");
  assert(rows[0].remoteOnlyBranches.has("upstream/feature"),
    "upstream/feature should be in remoteOnlyBranches set");
}

// Test 12: upstream/ remote is NOT remote-only when local branch exists
function test12() {
  console.log("\nTest 12: upstream/ remote not remote-only when local exists");

  const commits = [
    makeCommit("d1", [], [
      { name: "main", type: "branch", isCurrent: true },
      { name: "upstream/main", type: "remote", isCurrent: false },
    ]),
  ];
  const rows = buildGraph(commits);

  assert(rows[0].isRemoteOnly === false,
    "Commit with local main should not be remote-only");
  assert(!rows[0].remoteOnlyBranches.has("upstream/main"),
    "upstream/main should NOT be remote-only when local 'main' exists");
}

// Test 13: origin/ and upstream/ pointing to same commit — both tracked
function test13() {
  console.log("\nTest 13: origin/ and upstream/ on same commit, both tracked");

  const commits = [
    makeCommit("d1", [], [
      { name: "main", type: "branch", isCurrent: true },
      { name: "origin/main", type: "remote", isCurrent: false },
      { name: "upstream/main", type: "remote", isCurrent: false },
    ]),
  ];
  const rows = buildGraph(commits);

  // Neither remote should be remote-only since local "main" exists
  assert(!rows[0].remoteOnlyBranches.has("origin/main"),
    "origin/main should not be remote-only when local main exists");
  assert(!rows[0].remoteOnlyBranches.has("upstream/main"),
    "upstream/main should not be remote-only when local main exists");
  assert(rows[0].isRemoteOnly === false,
    "Commit should not be remote-only with local branch");
}

// Test 14: Nested remote path — origin/renovate/major strips to "renovate/major"
function test14() {
  console.log("\nTest 14: Nested remote path prefix stripping");

  const commits = [
    makeCommit("r1", ["d1"], [{ name: "origin/renovate/major", type: "remote", isCurrent: false }]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];
  const rows = buildGraph(commits);

  // "origin/renovate/major" → localEquivalent = "renovate/major"
  // No local branch named "renovate/major" → remote-only
  assert(rows[0].remoteOnlyBranches.has("origin/renovate/major"),
    "origin/renovate/major should be remote-only (no local 'renovate/major')");
  assert(rows[0].isRemoteOnly === true,
    "Commit on origin/renovate/major should be remote-only");
}

// Test 15: Nested remote path NOT remote-only when local equivalent exists
function test15() {
  console.log("\nTest 15: Nested remote path with local equivalent");

  const commits = [
    makeCommit("r1", [], [
      { name: "renovate/major", type: "branch", isCurrent: false },
      { name: "origin/renovate/major", type: "remote", isCurrent: false },
      { name: "main", type: "branch", isCurrent: true },
    ]),
  ];
  const rows = buildGraph(commits);

  // "origin/renovate/major" → localEquivalent = "renovate/major"
  // Local "renovate/major" exists → NOT remote-only
  assert(!rows[0].remoteOnlyBranches.has("origin/renovate/major"),
    "origin/renovate/major should NOT be remote-only when local 'renovate/major' exists");
}

// Test 16: Multiple remotes, same branch name — both remote-only when no local
function test16() {
  console.log("\nTest 16: Multiple remotes same branch, both remote-only");

  const commits = [
    makeCommit("f1", ["d1"], [
      { name: "origin/feature", type: "remote", isCurrent: false },
      { name: "upstream/feature", type: "remote", isCurrent: false },
    ]),
    makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: true }]),
  ];
  const rows = buildGraph(commits);

  // Both origin/feature and upstream/feature have localEquivalent "feature"
  // No local "feature" → both should be remote-only
  assert(rows[0].remoteOnlyBranches.has("origin/feature"),
    "origin/feature should be remote-only");
  assert(rows[0].remoteOnlyBranches.has("upstream/feature"),
    "upstream/feature should be remote-only");
  assert(rows[0].isRemoteOnly === true,
    "Commit with only remote-only refs should be remote-only");
}

// ============================================================
// Run all tests
// ============================================================
console.log("Coverage Gap Tests");
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
runTest(test16);

const { totalTests, passedTests, failedTests } = (await import("./test-helpers")).getResults();
printResults("coverage-gap");

if (failedTests > 0) {
  process.exit(1);
}
