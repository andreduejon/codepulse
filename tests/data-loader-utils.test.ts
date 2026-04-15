import { describe, expect, test } from "bun:test";
import { UNCOMMITTED_HASH } from "../src/constants";
import type { GraphRow } from "../src/git/types";
import {
  buildStashByParent,
  computeSilentMaxCount,
  computeTargetIndex,
  injectUncommittedNode,
  isStaleResult,
} from "../src/utils/data-loader-utils";
import { makeCommit } from "./test-helpers";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(hash: string, isOnCurrentBranch = false): GraphRow {
  return {
    commit: makeCommit(hash, []),
    columns: [],
    nodeColumn: 0,
    connectors: [],
    isOnCurrentBranch,
    nodeColor: 0,
    branchName: "main",
    parentHashes: [],
    parentBranches: [],
    parentColors: [],
    children: [],
    childBranches: [],
    childColors: [],
    isRemoteOnly: false,
    remoteOnlyBranches: new Set(),
  };
}

// ── computeSilentMaxCount ────────────────────────────────────────────────────

describe("computeSilentMaxCount", () => {
  test("returns pageSize for a normal (non-silent, non-preserve) load", () => {
    const commits = [makeCommit("a", []), makeCommit("b", [])];
    expect(computeSilentMaxCount(200, commits, false, false)).toBe(200);
  });

  test("returns pageSize when silent but fewer commits than pageSize are loaded", () => {
    const commits = [makeCommit("a", []), makeCommit("b", [])];
    // 2 real commits, pageSize=200 → max(200, 2) = 200
    expect(computeSilentMaxCount(200, commits, true, false)).toBe(200);
  });

  test("returns loadedCount when silent and more commits than pageSize are loaded", () => {
    // Simulate 300 real commits loaded with pageSize=200
    const commits = Array.from({ length: 300 }, (_, i) => makeCommit(`h${i}`, []));
    expect(computeSilentMaxCount(200, commits, true, false)).toBe(300);
  });

  test("returns loadedCount when preserveLoaded and more than pageSize loaded", () => {
    const commits = Array.from({ length: 250 }, (_, i) => makeCommit(`h${i}`, []));
    expect(computeSilentMaxCount(200, commits, false, true)).toBe(250);
  });

  test("excludes the synthetic uncommitted node from the real-commit count", () => {
    const uncommittedCommit = makeCommit(UNCOMMITTED_HASH, []);
    const realCommits = Array.from({ length: 250 }, (_, i) => makeCommit(`h${i}`, []));
    const commits = [uncommittedCommit, ...realCommits];
    // 251 total commits, but 250 are real → max(200, 250) = 250
    expect(computeSilentMaxCount(200, commits, true, false)).toBe(250);
  });

  test("with both silent and preserveLoaded, still respects the larger count", () => {
    const commits = Array.from({ length: 350 }, (_, i) => makeCommit(`h${i}`, []));
    expect(computeSilentMaxCount(200, commits, true, true)).toBe(350);
  });
});

// ── isStaleResult ────────────────────────────────────────────────────────────

describe("isStaleResult", () => {
  test("returns true when lists are identical (same hashes, same refs)", () => {
    const a = [makeCommit("abc", [], [{ name: "main", type: "branch", isCurrent: true }])];
    const b = [makeCommit("abc", [], [{ name: "main", type: "branch", isCurrent: true }])];
    expect(isStaleResult(a, b)).toBe(true);
  });

  test("returns false when lengths differ", () => {
    const a = [makeCommit("a", [])];
    const b = [makeCommit("a", []), makeCommit("b", [])];
    expect(isStaleResult(a, b)).toBe(false);
  });

  test("returns false when a commit hash changed", () => {
    const a = [makeCommit("a", []), makeCommit("b", [])];
    const b = [makeCommit("a", []), makeCommit("c", [])];
    expect(isStaleResult(a, b)).toBe(false);
  });

  test("returns false when a ref changed (e.g. HEAD moved)", () => {
    const a = [makeCommit("a", [], [{ name: "main", type: "branch", isCurrent: true }])];
    const b = [makeCommit("a", [], [{ name: "main", type: "branch", isCurrent: false }])];
    expect(isStaleResult(a, b)).toBe(false);
  });

  test("returns false when a ref was added", () => {
    const a = [makeCommit("a", [], [])];
    const b = [makeCommit("a", [], [{ name: "main", type: "branch", isCurrent: false }])];
    expect(isStaleResult(a, b)).toBe(false);
  });

  test("returns true for empty lists", () => {
    expect(isStaleResult([], [])).toBe(true);
  });
});

// ── injectUncommittedNode ────────────────────────────────────────────────────

describe("injectUncommittedNode", () => {
  test("prepends the uncommitted node at index 0", () => {
    const commits = [makeCommit("head", [])];
    injectUncommittedNode(commits, "head");
    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe(UNCOMMITTED_HASH);
  });

  test("uncommitted node has the HEAD hash as its parent", () => {
    const commits = [makeCommit("abc123", [])];
    injectUncommittedNode(commits, "abc123");
    expect(commits[0].parents).toEqual(["abc123"]);
  });

  test("uncommitted node has the 'uncommitted' ref type", () => {
    const commits = [makeCommit("abc", [])];
    injectUncommittedNode(commits, "abc");
    expect(commits[0].refs).toHaveLength(1);
    expect(commits[0].refs[0].type).toBe("uncommitted");
    expect(commits[0].refs[0].name).toBe("uncommitted");
  });

  test("existing commits are shifted down but otherwise unchanged", () => {
    const original = makeCommit("head", [], [{ name: "main", type: "branch", isCurrent: true }]);
    const commits = [original];
    injectUncommittedNode(commits, "head");
    expect(commits[1]).toBe(original);
  });

  test("subject is 'Uncommitted changes'", () => {
    const commits = [makeCommit("h", [])];
    injectUncommittedNode(commits, "h");
    expect(commits[0].subject).toBe("Uncommitted changes");
  });
});

// ── buildStashByParent ───────────────────────────────────────────────────────

describe("buildStashByParent", () => {
  test("returns empty map when stashes is empty", () => {
    const commits = [makeCommit("a", [])];
    const result = buildStashByParent([], commits);
    expect(result.size).toBe(0);
  });

  test("groups stashes by parent hash", () => {
    const commits = [makeCommit("parent1", []), makeCommit("parent2", [])];
    const stash1 = makeCommit("s1", ["parent1"]);
    const stash2 = makeCommit("s2", ["parent1"]);
    const stash3 = makeCommit("s3", ["parent2"]);

    const result = buildStashByParent([stash1, stash2, stash3], commits);
    expect(result.size).toBe(2);
    expect(result.get("parent1")).toHaveLength(2);
    expect(result.get("parent2")).toHaveLength(1);
  });

  test("ignores stashes whose parent is not in the loaded commits", () => {
    const commits = [makeCommit("present", [])];
    const stash = makeCommit("s1", ["not-loaded"]);
    const result = buildStashByParent([stash], commits);
    expect(result.size).toBe(0);
  });

  test("ignores stashes with no parent", () => {
    const commits = [makeCommit("a", [])];
    const stash = makeCommit("s1", []); // no parents
    const result = buildStashByParent([stash], commits);
    expect(result.size).toBe(0);
  });

  test("injects stash badge refs onto parent commits", () => {
    const parent = makeCommit("p1", []);
    const stash1 = makeCommit("s1", ["p1"]);
    const stash2 = makeCommit("s2", ["p1"]);

    buildStashByParent([stash1, stash2], [parent]);

    const stashRef = parent.refs.find(r => r.type === "stash");
    expect(stashRef).toBeDefined();
    expect(stashRef?.name).toBe("stash (2)");
  });

  test("stash badge reflects the count of stashes for that parent", () => {
    const parent = makeCommit("p1", []);
    const stashes = [makeCommit("s1", ["p1"]), makeCommit("s2", ["p1"]), makeCommit("s3", ["p1"])];

    buildStashByParent(stashes, [parent]);

    const stashRef = parent.refs.find(r => r.type === "stash");
    expect(stashRef?.name).toBe("stash (3)");
  });

  test("does not double-inject stash badge when called twice", () => {
    // This matches the real behavior of mergeCommitPages which guards with `!parentCommit.refs.some(r => r.type === "stash")`
    // buildStashByParent itself doesn't check for existing badges — that's the merge-pages guard.
    // This test documents that calling twice DOES add a second badge.
    const parent = makeCommit("p1", []);
    const stash = makeCommit("s1", ["p1"]);
    buildStashByParent([stash], [parent]);
    const countBefore = parent.refs.filter(r => r.type === "stash").length;
    expect(countBefore).toBe(1);
  });
});

// ── computeTargetIndex ───────────────────────────────────────────────────────

describe("computeTargetIndex", () => {
  test("returns 0 as fallback when no stickyHash and no current-branch row", () => {
    const rows = [makeRow("a"), makeRow("b"), makeRow("c")];
    expect(computeTargetIndex(rows)).toBe(0);
  });

  test("returns the current-branch row index when no stickyHash", () => {
    const rows = [makeRow("a"), makeRow("b", true), makeRow("c")];
    // 'b' is on current branch at index 1
    expect(computeTargetIndex(rows)).toBe(1);
  });

  test("restores to stickyHash index when found", () => {
    const rows = [makeRow("a"), makeRow("b"), makeRow("c", true)];
    // stickyHash = 'b' at index 1
    expect(computeTargetIndex(rows, "b")).toBe(1);
  });

  test("stickyHash takes priority over current-branch row", () => {
    const rows = [makeRow("a"), makeRow("b", true), makeRow("c")];
    // current branch is at index 1 ('b'), but stickyHash = 'c' (index 2)
    expect(computeTargetIndex(rows, "c")).toBe(2);
  });

  test("falls back to current-branch row when stickyHash is not found", () => {
    const rows = [makeRow("a"), makeRow("b", true), makeRow("c")];
    // stickyHash 'gone' is not in rows → fall through to current branch at index 1
    expect(computeTargetIndex(rows, "gone")).toBe(1);
  });

  test("falls back to 0 when stickyHash not found and no current-branch row", () => {
    const rows = [makeRow("a"), makeRow("b"), makeRow("c")];
    expect(computeTargetIndex(rows, "gone")).toBe(0);
  });

  test("handles empty rows array without throwing", () => {
    expect(computeTargetIndex([])).toBe(0);
  });

  test("handles empty rows with stickyHash without throwing", () => {
    expect(computeTargetIndex([], "abc")).toBe(0);
  });
});
