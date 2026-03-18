#!/usr/bin/env bun
/**
 * Test script: column stability assertion tests.
 *
 * Converts key scenarios from diagnose-columns.ts into assertion-based
 * tests that process.exit(1) on column jumping. A branch "jumps columns"
 * when commits belonging to the same branch appear at different nodeColumn
 * values without a merge/branch connector explaining the shift.
 */

import { buildGraph } from "../src/git/graph";
import type { Commit } from "../src/git/types";
import {
  makeCommit,
  assert,
  printResults,
  runTest,
} from "./test-helpers";

/**
 * Check column stability for a set of commits.
 * Returns a map of branchName → unique columns used.
 * A branch is "stable" if it uses exactly 1 column across all its rows.
 */
function checkColumnStability(commits: Commit[]): Map<string, number[]> {
  const rows = buildGraph(commits);
  const branchColumns = new Map<string, number[]>();

  for (const row of rows) {
    const bn = row.branchName || "(none)";
    if (!branchColumns.has(bn)) branchColumns.set(bn, []);
    const cols = branchColumns.get(bn)!;
    if (!cols.includes(row.nodeColumn)) cols.push(row.nodeColumn);
  }

  return branchColumns;
}

/**
 * Assert that no branch uses more than 1 column (no jumping).
 */
function assertNoColumnJumping(label: string, commits: Commit[]) {
  const branchCols = checkColumnStability(commits);
  let hasJumps = false;

  for (const [branch, cols] of branchCols) {
    // Skip "(none)" — commits not claimed by any branch tip's first-parent
    // walk naturally end up on different lanes. This isn't column jumping.
    if (branch === "(none)") continue;
    if (cols.length > 1) {
      hasJumps = true;
      assert(false,
        `${label}: branch "${branch}" jumps columns: [${cols.join(", ")}]`);
    }
  }

  if (!hasJumps) {
    assert(true, `${label}: all branches stable`);
  }
}

// ============================================================
// Test 1: Sequential feature merges
// develop with two feature branches merged sequentially
// ============================================================
function test1() {
  console.log("\nTest 1: Sequential feature merges");

  const commits = [
    makeCommit("d4", ["mergeB"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("mergeB", ["d3", "b2"], [], "Merge feat-B into develop"),
    makeCommit("b2", ["b1"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work 2"),
    makeCommit("b1", ["d3"], [], "feat-B work 1"),
    makeCommit("d3", ["mergeA"], [], "develop commit after merge A"),
    makeCommit("mergeA", ["d2", "a2"], [], "Merge feat-A into develop"),
    makeCommit("a2", ["a1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work 2"),
    makeCommit("a1", ["d2"], [], "feat-A work 1"),
    makeCommit("d2", ["d1"], [], "develop commit 2"),
    makeCommit("d1", [], [], "initial commit"),
  ];

  assertNoColumnJumping("Sequential merges", commits);
}

// ============================================================
// Test 2: Parallel feature branches (fan-out)
// Three features all branched from same develop commit
// ============================================================
function test2() {
  console.log("\nTest 2: Parallel feature branches (fan-out)");

  const commits = [
    makeCommit("d3", ["mergeC"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("mergeC", ["mergeB", "c1"], [], "Merge feat-C"),
    makeCommit("c1", ["d2"], [{ name: "feat-C", type: "branch", isCurrent: false }], "feat-C work"),
    makeCommit("mergeB", ["mergeA", "b1"], [], "Merge feat-B"),
    makeCommit("b1", ["d2"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work"),
    makeCommit("mergeA", ["d2", "a1"], [], "Merge feat-A"),
    makeCommit("a1", ["d2"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work"),
    makeCommit("d2", ["d1"], [], "develop shared ancestor"),
    makeCommit("d1", [], [], "initial commit"),
  ];

  assertNoColumnJumping("Parallel branches", commits);
}

// ============================================================
// Test 3: Renovate-style short branches
// Many short branches from develop merging back interleaved
// ============================================================
function test3() {
  console.log("\nTest 3: Renovate-style short branches");

  const commits = [
    makeCommit("d3", ["m3"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("m3", ["m2", "rc1"], [], "Merge renovate/c"),
    makeCommit("rc1", ["m1"], [{ name: "origin/renovate/c", type: "remote", isCurrent: false }], "renovate/c"),
    makeCommit("m2", ["m1", "rb1"], [], "Merge renovate/b"),
    makeCommit("rb1", ["d2"], [{ name: "origin/renovate/b", type: "remote", isCurrent: false }], "renovate/b"),
    makeCommit("m1", ["d2", "ra1"], [], "Merge renovate/a"),
    makeCommit("ra1", ["d2"], [{ name: "origin/renovate/a", type: "remote", isCurrent: false }], "renovate/a"),
    makeCommit("d2", ["d1"], [], "develop baseline"),
    makeCommit("d1", [], [], "initial"),
  ];

  assertNoColumnJumping("Renovate-style", commits);
}

// ============================================================
// Test 4: Diamond pattern
// Feature merges into develop, then another feature from same point
// ============================================================
function test4() {
  console.log("\nTest 4: Diamond pattern");

  const commits = [
    makeCommit("d3", ["mergeB"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("mergeB", ["mergeA", "b1"], [], "Merge feat-B"),
    makeCommit("b1", ["mergeA"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work"),
    makeCommit("mergeA", ["d2", "a1"], [], "Merge feat-A"),
    makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("d1", [], [], "initial"),
  ];

  assertNoColumnJumping("Diamond pattern", commits);
}

// ============================================================
// Test 5: Two long-lived branches with cross-merge
// develop and staging with cherry-pick from develop to staging
// ============================================================
function test5() {
  console.log("\nTest 5: Cross-merge (develop + staging)");

  const commits = [
    makeCommit("d4", ["d3"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d3", ["d2"], [], "develop work 3"),
    makeCommit("d2", ["d1"], [], "develop work 2"),
    makeCommit("s2", ["merge_d2"], [{ name: "staging", type: "branch", isCurrent: false }], "staging tip"),
    makeCommit("merge_d2", ["s1", "d2"], [], "Merge develop into staging"),
    makeCommit("s1", ["d1"], [], "staging work"),
    makeCommit("d1", [], [], "initial"),
  ];

  assertNoColumnJumping("Cross-merge", commits);
}

// ============================================================
// Test 6: Release branch far from branch-off point
// develop + long release branch (tests tee vs corner)
// ============================================================
function test6() {
  console.log("\nTest 6: Release branch far from branch-off");

  const commits = [
    makeCommit("d5", ["d4"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d4", ["d3"], [], "develop work 4"),
    makeCommit("d3", ["d2"], [], "develop work 3"),
    makeCommit("r3", ["r2"], [{ name: "release/1.0", type: "branch", isCurrent: false }], "release tip"),
    makeCommit("r2", ["r1"], [], "release work 2"),
    makeCommit("r1", ["d2"], [], "release work 1"),
    makeCommit("d2", ["d1"], [], "develop baseline"),
    makeCommit("d1", [], [], "initial"),
  ];

  assertNoColumnJumping("Release far from branch-off", commits);
}

// ============================================================
// Test 7: Unmerged remote-only branches above develop
// ============================================================
function test7() {
  console.log("\nTest 7: Unmerged remote-only branches above develop");

  const commits = [
    makeCommit("ren1", ["d3"], [{ name: "origin/renovate/major", type: "remote", isCurrent: false }], "renovate major"),
    makeCommit("ren2", ["d3"], [{ name: "origin/renovate/minor", type: "remote", isCurrent: false }], "renovate minor"),
    makeCommit("ren3", ["d3"], [{ name: "origin/renovate/patch", type: "remote", isCurrent: false }], "renovate patch"),
    makeCommit("d3", ["d2"], [
      { name: "develop", type: "branch", isCurrent: true },
      { name: "origin/develop", type: "remote", isCurrent: false },
      { name: "origin/HEAD", type: "remote", isCurrent: false },
    ], "develop tip"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("d1", [], [], "initial"),
  ];

  assertNoColumnJumping("Remote-only above develop", commits);
}

// ============================================================
// Test 8: Complex cross-merges (e-ant-backend style)
// ============================================================
function test8() {
  console.log("\nTest 8: Complex cross-merges (e-ant-backend style)");

  const commits = [
    makeCommit("cd21d4d0", ["3c67a4f3", "34ae7c3f"], [{ name: "develop", type: "branch", isCurrent: true }], "Merge #22 tspd-642"),
    makeCommit("34ae7c3f", ["e9bb1d45"], [], "Update .env.template"),
    makeCommit("e9bb1d45", ["4f8ea691"], [], "fix(tspd-642): report"),
    makeCommit("4f8ea691", ["1f4c8531"], [], "fix(tspd-642): refTaskName"),
    makeCommit("1f4c8531", ["be4f5c69"], [], "feat(tspd-642): refSb handling"),
    makeCommit("be4f5c69", ["85509b67"], [], "feat(tspd-642): customer print"),
    makeCommit("85509b67", ["f7e7523b"], [], "feat(tspd-642): s100d input"),
    makeCommit("f7e7523b", ["cee38bbb"], [], "chore(tspd-642): config"),
    makeCommit("3c67a4f3", ["9b4a4ba2", "0fee6932"], [], "Merge #19 tspd-557"),
    makeCommit("0fee6932", ["7ffa77a5"], [], "tspd-557 ESN"),
    makeCommit("9b4a4ba2", ["d1bbf694", "2cb7d0af"], [], "Merge #20 tspd-556"),
    makeCommit("2cb7d0af", ["3e36e1b3"], [], "tspd-558 config fixes"),
    makeCommit("3e36e1b3", ["c1c4da6a", "34bbc62c"], [], "Merge tspd-558 into tspd-556"),
    makeCommit("c1c4da6a", ["5b4a22bb", "fe1485f3"], [], "Merge tspd-558 into tspd-556 (2)"),
    makeCommit("5b4a22bb", ["7a4804bc"], [], "tspd-535 sso config"),
    makeCommit("7a4804bc", ["3f9f7a92"], [], "tspd-556 refactor"),
    makeCommit("3f9f7a92", ["cee38bbb"], [], "tspd-556 new api"),
    makeCommit("d1bbf694", ["cee38bbb", "34bbc62c"], [], "Merge #21 tspd-558"),
    makeCommit("34bbc62c", ["fe1485f3"], [], "tspd-558 refactor"),
    makeCommit("fe1485f3", ["cee38bbb"], [], "tspd-556 bulk update"),
    makeCommit("b95a0262", ["e5b2a605"], [{ name: "origin/tspd-626", type: "remote", isCurrent: false }], "tspd-626 tests"),
    makeCommit("e5b2a605", ["cee38bbb"], [], "tspd-626 penalty cycles"),
    makeCommit("cee38bbb", ["8b48362d"], [], "Delete cicd/helm"),
    makeCommit("8b48362d", ["7ffa77a5"], [], "chore(tspd-506) config"),
    makeCommit("7ffa77a5", ["d7979cd9", "aa24bb22"], [], "Merge #18"),
    makeCommit("aa24bb22", ["c0d70f04"], [{ name: "v1.49.0", type: "tag", isCurrent: false }], "Release v1.49.0"),
    makeCommit("c0d70f04", ["d7979cd9"], [], "Merge #17"),
    makeCommit("d7979cd9", [], [], "initial"),
  ];

  assertNoColumnJumping("e-ant-backend style", commits);
}

// ============================================================
// Test 9: Develop + release + hotfix cross-merge
// ============================================================
function test9() {
  console.log("\nTest 9: Develop + release + hotfix");

  const commits = [
    makeCommit("d4", ["mergeHF"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("mergeHF", ["d3", "hf1"], [], "Merge hotfix into develop"),
    makeCommit("hf1", ["d2"], [{ name: "hotfix/fix-1", type: "branch", isCurrent: false }], "hotfix work"),
    makeCommit("d3", ["d2"], [], "develop work"),
    makeCommit("r2", ["mergeHF_rel"], [{ name: "release/1.0", type: "branch", isCurrent: false }], "release tip"),
    makeCommit("mergeHF_rel", ["r1", "hf1"], [], "Merge hotfix into release"),
    makeCommit("r1", ["d2"], [], "release work"),
    makeCommit("d2", ["d1"], [], "develop baseline"),
    makeCommit("d1", [], [], "initial"),
  ];

  assertNoColumnJumping("Develop + release + hotfix", commits);
}

// ============================================================
// Run all tests
// ============================================================
console.log("Column Stability Tests");
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

const { totalTests, passedTests, failedTests } = (await import("./test-helpers")).getResults();
printResults("column-stability");

if (failedTests > 0) {
  process.exit(1);
}
