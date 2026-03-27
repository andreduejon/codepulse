/**
 * Test: column stability assertion tests.
 *
 * A branch "jumps columns" when commits belonging to the same
 * branch appear at different nodeColumn values without a merge/branch
 * connector explaining the shift.
 */
import { describe, test, expect } from "bun:test";
import { buildGraph } from "../src/git/graph";
import type { Commit } from "../src/git/types";
import {
  makeCommit,
  printGraph,
} from "./test-helpers";

/**
 * Check column stability for a set of commits.
 * Returns a map of branchName → unique columns used.
 * A branch is "stable" if it uses exactly 1 column across all its rows.
 */
function checkColumnStability(commits: Commit[]): Map<string, number[]> {
  const rows = buildGraph(commits);
  printGraph(rows);
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

  for (const [branch, cols] of branchCols) {
    // Skip "(none)" — commits not claimed by any branch tip's first-parent
    // walk naturally end up on different lanes. This isn't column jumping.
    if (branch === "(none)") continue;
    if (cols.length > 1) {
      expect(cols.length).toBe(1); // Will fail with useful message
    }
  }

  // If we got here, all branches are stable
  expect(true).toBe(true);
}

describe("Column Stability", () => {
  test("Sequential feature merges", () => {
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
  });

  test("Parallel feature branches (fan-out)", () => {
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
  });

  test("Renovate-style short branches", () => {
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
  });

  test("Diamond pattern", () => {
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
  });

  test("Cross-merge (develop + staging)", () => {
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
  });

  test("Release branch far from branch-off", () => {
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
  });

  test("Unmerged remote-only branches above develop", () => {
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
  });

  test("Develop + release + hotfix", () => {
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
  });
});
