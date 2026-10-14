import { describe, expect, test } from "bun:test";
import type { GraphRow } from "../src/git/types";
import {
  type CascadeState,
  type CascadeTarget,
  computeCascadeTarget,
  computeDisplacedIndex,
  countHighlightedBelow,
  findHighlightedIndex,
} from "../src/utils/keyboard-nav-utils";
import { makeCommit } from "./test-helpers";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal GraphRow with only the hash needed for highlight logic. */
function makeRow(hash: string): GraphRow {
  return {
    commit: makeCommit(hash, []),
    columns: [],
    nodeColumn: 0,
    connectors: [],
    isOnCurrentBranch: false,
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

/** Build rows for hashes a, b, c, ... */
function makeRows(...hashes: string[]): GraphRow[] {
  return hashes.map(h => makeRow(h));
}

function makeSet(...hashes: string[]): Set<string> {
  return new Set(hashes);
}

// ── findHighlightedIndex ─────────────────────────────────────────────────────

describe("findHighlightedIndex", () => {
  const rows = makeRows("a", "b", "c", "d", "e");

  test.each([
    ["returns `from` when hSet is null (no highlight active)", null, 2, 1, 1, 2],
    ["returns `from` when hSet is empty", new Set<string>(), 2, 1, 1, 2],
    ["finds the next highlighted row forward", makeSet("c", "e"), 0, 1, 1, 2],
    ["finds the next highlighted row backward", makeSet("a", "c"), 4, -1, 1, 2],
    // skip 'b' (index 1), land on 'd' (index 3)
    ["steps over multiple highlighted rows when count > 1", makeSet("b", "d"), 0, 1, 2, 3],
    ["returns `from` when no highlighted row exists in that direction", makeSet("a"), 1, 1, 1, 1],
    // Caller uses -1 as 'before the array'
    ["works with the sentinel -1 `from` to find the first highlighted row", makeSet("c"), -1, 1, 1, 2],
    // Caller uses rows.length as 'after the array'
    ["works with rows.length as `from` to find the last highlighted row", makeSet("b"), rows.length, -1, 1, 1],
    ["stops at count, not at array boundary", makeSet("a", "b", "c", "d", "e"), -1, 1, 3, 2],
    // from=0 (at 'a') → 'c' at index 2, not 'a' itself
    ["handles the case where `from` itself is highlighted but search starts beyond it", makeSet("a", "c"), 0, 1, 1, 2],
  ] as const)("%s", (_label, hSet, from, direction, count, expected) => {
    expect(findHighlightedIndex(rows, hSet, from, direction, count)).toBe(expected);
  });
});

// ── countHighlightedBelow ────────────────────────────────────────────────────

describe("countHighlightedBelow", () => {
  const rows = makeRows("a", "b", "c", "d", "e");

  test.each([
    ["returns 0 when hSet is null", null, 0, 10, 0],
    // from=0 ('a') → rows below: b, c, d, e → 'c' and 'e'
    ["counts highlighted rows strictly below `from`", makeSet("c", "e"), 0, 10, 2],
    ["does not count the `from` row itself even if highlighted", makeSet("a", "c"), 0, 10, 1],
    ["respects the `limit` parameter", makeSet("b", "c", "d"), 0, 2, 2],
    ["returns 0 when from is the last row", makeSet("a", "b"), 4, 10, 0],
    ["returns 0 when no highlighted rows exist below from", makeSet("a"), 1, 10, 0],
  ])("%s", (_label, hSet, from, limit, expected) => {
    expect(countHighlightedBelow(rows, hSet, from, limit)).toBe(expected);
  });
});

// ── computeDisplacedIndex ────────────────────────────────────────────────────

describe("computeDisplacedIndex", () => {
  const rows = makeRows("a", "b", "c", "d", "e");

  test.each([
    ["returns curIdx when hSet is null", null, 2, 2],
    ["returns curIdx when hSet is empty", new Set<string>(), 2, 2],
    ["returns curIdx when already on a highlighted row", makeSet("c"), 2, 2],
    ["jumps forward when only forward match exists", makeSet("d"), 1, 3],
    ["jumps backward when only backward match exists", makeSet("a"), 2, 0],
    // Distance to 'a' = 2, distance to 'e' = 2 → tie → prefer backward ('a')
    // Original condition: curIdx - bwd <= fwd - curIdx → 2 <= 2 → true → picks bwd
    ["prefers closer match; on tie prefers backward", makeSet("a", "e"), 2, 0],
    ["picks the closer of fwd and bwd when not a tie", makeSet("b", "e"), 2, 1],
    ["returns curIdx when no highlighted row exists anywhere", makeSet("z"), 2, 2],
  ])("%s", (_label, hSet, curIdx, expected) => {
    expect(computeDisplacedIndex(rows, hSet, curIdx)).toBe(expected);
  });
});

// ── computeCascadeTarget ─────────────────────────────────────────────────────

describe("computeCascadeTarget", () => {
  const base: CascadeState = {
    commandBarMode: "idle",
    searchFocused: false,
    dialog: null,
    layoutMode: "normal",
    detailFocused: false,
    highlightSet: null,
    searchQuery: "",
    ancestrySet: null,
    pathFilter: null,
    viewingBranch: null,
  };

  test("returns null when nothing is open", () => {
    expect(computeCascadeTarget(base)).toBe(null);
  });

  test("command bar takes priority over everything else", () => {
    expect(computeCascadeTarget({ ...base, commandBarMode: "command", dialog: "menu" })).toBe("command-bar");
    expect(computeCascadeTarget({ ...base, commandBarMode: "search", detailFocused: true })).toBe("command-bar");
    expect(computeCascadeTarget({ ...base, commandBarMode: "path" })).toBe("command-bar");
  });

  test("detail dialog closes detail focus + dialog", () => {
    expect(computeCascadeTarget({ ...base, dialog: "detail" })).toBe("detail-dialog");
  });

  test("diff-blame in compact mode with detail focused steps back to detail dialog", () => {
    expect(computeCascadeTarget({ ...base, dialog: "diff-blame", layoutMode: "compact", detailFocused: true })).toBe(
      "diff-blame-compact",
    );
  });

  test("non-detail dialog closes the dialog", () => {
    expect(computeCascadeTarget({ ...base, dialog: "menu" })).toBe("dialog");
    expect(computeCascadeTarget({ ...base, dialog: "help" })).toBe("dialog");
    expect(computeCascadeTarget({ ...base, dialog: "theme" })).toBe("dialog");
  });

  test.each<[string, Partial<CascadeState>, CascadeTarget]>([
    ["search focused closes after dialogs", { searchFocused: true }, "search-focused"],
    ["detail focused closes after search", { detailFocused: true }, "detail-focused"],
    [
      "search highlight cleared after detail focus",
      { highlightSet: new Set(["abc"]), searchQuery: "fix" },
      "search-highlight",
    ],
    [
      "ancestry highlight cleared after search highlight",
      { highlightSet: new Set(["abc"]), ancestrySet: new Set(["abc"]) },
      "ancestry-highlight",
    ],
    ["path highlight cleared after ancestry", { highlightSet: new Set(["abc"]), pathFilter: "src/" }, "path-highlight"],
    ["branch view cleared last", { viewingBranch: "feature/foo" }, "branch-view"],
  ])("%s", (_label, overrides, expected) => {
    expect(computeCascadeTarget({ ...base, ...overrides })).toBe(expected);
  });

  test("cascade order is strictly priority-ordered", () => {
    // Command bar beats dialog beats search-focused beats detail-focused
    const state: CascadeState = {
      commandBarMode: "command",
      searchFocused: true,
      dialog: "menu",
      layoutMode: "normal",
      detailFocused: true,
      highlightSet: new Set(["x"]),
      searchQuery: "foo",
      ancestrySet: new Set(["x"]),
      pathFilter: "src/",
      viewingBranch: "main",
    };
    expect(computeCascadeTarget(state)).toBe("command-bar");

    const withoutCmdBar = { ...state, commandBarMode: "idle" as const };
    expect(computeCascadeTarget(withoutCmdBar)).toBe("dialog");

    const withoutDialog = { ...withoutCmdBar, dialog: null };
    expect(computeCascadeTarget(withoutDialog)).toBe("search-focused");

    const withoutSearch = { ...withoutDialog, searchFocused: false };
    expect(computeCascadeTarget(withoutSearch)).toBe("detail-focused");

    const withoutDetail = { ...withoutSearch, detailFocused: false };
    expect(computeCascadeTarget(withoutDetail)).toBe("search-highlight");
  });
});
