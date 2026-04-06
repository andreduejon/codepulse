/**
 * Test: verifies mergeCommitPages — the pure merge logic extracted
 * from App.loadMoreData() in app.tsx.
 *
 * Covers: basic append, uncommitted node preservation, stash badge injection,
 * duplicate stash prevention, empty new-page, and no-uncommitted-node case.
 */
import { describe, expect, test } from "bun:test";
import { UNCOMMITTED_HASH } from "../src/constants";
import { mergeCommitPages } from "../src/git/merge-pages";
import { makeCommit } from "./test-helpers";

/** Create a minimal uncommitted-changes synthetic commit node. */
function makeUncommitted(): ReturnType<typeof makeCommit> {
  return makeCommit(
    UNCOMMITTED_HASH,
    [],
    [{ name: "uncommitted", type: "uncommitted", isCurrent: false }],
    "Uncommitted changes",
  );
}

describe("mergeCommitPages", () => {
  // ── Basic merge ───────────────────────────────────────────────────

  test("appends new commits after existing real commits", () => {
    const existing = [makeCommit("aaa", []), makeCommit("bbb", ["aaa"])];
    const newPage = [makeCommit("ccc", ["bbb"]), makeCommit("ddd", ["ccc"])];
    const merged = mergeCommitPages(existing, newPage, new Map());

    expect(merged.length).toBe(4);
    expect(merged.map(c => c.hash)).toEqual(["aaa", "bbb", "ccc", "ddd"]);
  });

  test("empty new page with no uncommitted returns existing unchanged", () => {
    const existing = [makeCommit("aaa", [])];
    const merged = mergeCommitPages(existing, [], new Map());
    expect(merged.length).toBe(1);
    expect(merged[0].hash).toBe("aaa");
  });

  // ── Uncommitted node handling ─────────────────────────────────────

  test("preserves uncommitted node at position 0 when present", () => {
    const uncommitted = makeUncommitted();
    const existing = [uncommitted, makeCommit("aaa", [])];
    const newPage = [makeCommit("bbb", ["aaa"])];
    const merged = mergeCommitPages(existing, newPage, new Map());

    expect(merged.length).toBe(3);
    expect(merged[0].hash).toBe(UNCOMMITTED_HASH);
    expect(merged[1].hash).toBe("aaa");
    expect(merged[2].hash).toBe("bbb");
  });

  test("uncommitted node is NOT added when it was not present", () => {
    const existing = [makeCommit("aaa", [])];
    const newPage = [makeCommit("bbb", ["aaa"])];
    const merged = mergeCommitPages(existing, newPage, new Map());

    expect(merged.length).toBe(2);
    expect(merged[0].hash).toBe("aaa");
    expect(merged[1].hash).toBe("bbb");
  });

  test("uncommitted node is excluded from the real-commit section", () => {
    // If uncommitted node were not filtered, it would appear twice (position 0
    // and again later). Verify it appears exactly once.
    const uncommitted = makeUncommitted();
    const existing = [uncommitted, makeCommit("aaa", [])];
    const newPage = [makeCommit("bbb", ["aaa"])];
    const merged = mergeCommitPages(existing, newPage, new Map());

    const uncommittedCount = merged.filter(c => c.hash === UNCOMMITTED_HASH).length;
    expect(uncommittedCount).toBe(1);
  });

  // ── Stash badge injection ─────────────────────────────────────────

  test("injects stash badge onto parent commit", () => {
    const parent = makeCommit("aaa", []);
    const existing = [parent];
    const stashByParent = new Map([["aaa", [{ index: 0 }]]]);
    const merged = mergeCommitPages(existing, [], stashByParent);

    const parentInMerged = merged.find(c => c.hash === "aaa")!;
    expect(parentInMerged.refs.some(r => r.type === "stash")).toBe(true);
    expect(parentInMerged.refs.find(r => r.type === "stash")!.name).toBe("stash (1)");
  });

  test("stash badge count reflects number of stashes", () => {
    const parent = makeCommit("aaa", []);
    const existing = [parent];
    const stashByParent = new Map([["aaa", [{ index: 0 }, { index: 1 }, { index: 2 }]]]);
    const merged = mergeCommitPages(existing, [], stashByParent);

    const stashRef = merged.find(c => c.hash === "aaa")!.refs.find(r => r.type === "stash")!;
    expect(stashRef.name).toBe("stash (3)");
  });

  test("does NOT duplicate stash badge if already present", () => {
    const parent = makeCommit("aaa", [], [{ name: "stash (1)", type: "stash", isCurrent: false }]);
    const existing = [parent];
    const stashByParent = new Map([["aaa", [{ index: 0 }]]]);
    const merged = mergeCommitPages(existing, [], stashByParent);

    const stashRefs = merged.find(c => c.hash === "aaa")!.refs.filter(r => r.type === "stash");
    expect(stashRefs.length).toBe(1);
  });

  test("stash badge is injected onto new-page commit if parent is in new page", () => {
    const existing = [makeCommit("aaa", [])];
    const newParent = makeCommit("bbb", ["aaa"]);
    const stashByParent = new Map([["bbb", [{ index: 0 }]]]);
    const merged = mergeCommitPages(existing, [newParent], stashByParent);

    const parentInMerged = merged.find(c => c.hash === "bbb")!;
    expect(parentInMerged.refs.some(r => r.type === "stash")).toBe(true);
  });

  test("stash badge is not injected when parent hash not in merged list", () => {
    const existing = [makeCommit("aaa", [])];
    const stashByParent = new Map([["zzz", [{ index: 0 }]]]);
    const merged = mergeCommitPages(existing, [], stashByParent);

    // No commit should have a stash ref
    const anyStash = merged.some(c => c.refs.some(r => r.type === "stash"));
    expect(anyStash).toBe(false);
  });

  // ── Combined scenario ─────────────────────────────────────────────

  test("full scenario: uncommitted + stash + new page", () => {
    const uncommitted = makeUncommitted();
    const c1 = makeCommit("aaa", []);
    const c2 = makeCommit("bbb", ["aaa"]);
    const existing = [uncommitted, c1, c2];

    const c3 = makeCommit("ccc", ["bbb"]);
    const c4 = makeCommit("ddd", ["ccc"]);
    const newPage = [c3, c4];

    const stashByParent = new Map([
      ["bbb", [{ index: 0 }, { index: 1 }]],
      ["ddd", [{ index: 2 }]],
    ]);

    const merged = mergeCommitPages(existing, newPage, stashByParent);

    // Order: uncommitted, aaa, bbb, ccc, ddd
    expect(merged.length).toBe(5);
    expect(merged[0].hash).toBe(UNCOMMITTED_HASH);
    expect(merged[1].hash).toBe("aaa");
    expect(merged[2].hash).toBe("bbb");
    expect(merged[3].hash).toBe("ccc");
    expect(merged[4].hash).toBe("ddd");

    // Stash badges
    expect(merged[2].refs.find(r => r.type === "stash")!.name).toBe("stash (2)");
    expect(merged[4].refs.find(r => r.type === "stash")!.name).toBe("stash (1)");

    // No stash on commits that shouldn't have them
    expect(merged[0].refs.some(r => r.type === "stash")).toBe(false);
    expect(merged[1].refs.some(r => r.type === "stash")).toBe(false);
    expect(merged[3].refs.some(r => r.type === "stash")).toBe(false);
  });
});
