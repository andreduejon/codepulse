import { describe, expect, test } from "bun:test";
import {
  computeCascadeTarget,
  computeDisplacedIndex,
  countHighlightedBelow,
  findHighlightedIndex,
  type CascadeState,
} from "../src/utils/keyboard-nav-utils";
import { makeCommit } from "./test-helpers";
import type { GraphRow } from "../src/git/types";

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

  test("returns `from` when hSet is null (no highlight active)", () => {
    expect(findHighlightedIndex(rows, null, 2, 1, 1)).toBe(2);
  });

  test("returns `from` when hSet is empty", () => {
    expect(findHighlightedIndex(rows, new Set(), 2, 1, 1)).toBe(2);
  });

  test("finds the next highlighted row forward", () => {
    const hSet = makeSet("c", "e");
    // from=0 (before 'a'), direction=1, count=1 → 'c' is at index 2
    expect(findHighlightedIndex(rows, hSet, 0, 1, 1)).toBe(2);
  });

  test("finds the next highlighted row backward", () => {
    const hSet = makeSet("a", "c");
    // from=4 (at 'e'), direction=-1, count=1 → 'c' is at index 2
    expect(findHighlightedIndex(rows, hSet, 4, -1, 1)).toBe(2);
  });

  test("steps over multiple highlighted rows when count > 1", () => {
    const hSet = makeSet("b", "d");
    // from=0, direction=1, count=2 → skip 'b' (index 1), land on 'd' (index 3)
    expect(findHighlightedIndex(rows, hSet, 0, 1, 2)).toBe(3);
  });

  test("returns `from` when no highlighted row exists in that direction", () => {
    const hSet = makeSet("a");
    // from=1 (at 'b'), direction=1 → no highlighted row ahead
    expect(findHighlightedIndex(rows, hSet, 1, 1, 1)).toBe(1);
  });

  test("works with the sentinel -1 `from` to find the first highlighted row", () => {
    const hSet = makeSet("c");
    // Caller uses -1 as 'before the array', direction=1, count=1 → 'c' at index 2
    expect(findHighlightedIndex(rows, hSet, -1, 1, 1)).toBe(2);
  });

  test("works with rows.length as `from` to find the last highlighted row", () => {
    const hSet = makeSet("b");
    // Caller uses rows.length as 'after the array', direction=-1, count=1 → 'b' at index 1
    expect(findHighlightedIndex(rows, hSet, rows.length, -1, 1)).toBe(1);
  });

  test("stops at count, not at array boundary", () => {
    const hSet = makeSet("a", "b", "c", "d", "e");
    // All highlighted; from=-1, direction=1, count=3 → land on index 2 ('c')
    expect(findHighlightedIndex(rows, hSet, -1, 1, 3)).toBe(2);
  });

  test("handles the case where `from` itself is highlighted but search starts beyond it", () => {
    const hSet = makeSet("a", "c");
    // from=0 (at 'a'), direction=1, count=1 → 'c' at index 2 (not 'a' itself)
    expect(findHighlightedIndex(rows, hSet, 0, 1, 1)).toBe(2);
  });
});

// ── countHighlightedBelow ────────────────────────────────────────────────────

describe("countHighlightedBelow", () => {
  const rows = makeRows("a", "b", "c", "d", "e");

  test("returns 0 when hSet is null", () => {
    expect(countHighlightedBelow(rows, null, 0, 10)).toBe(0);
  });

  test("counts highlighted rows strictly below `from`", () => {
    const hSet = makeSet("c", "e");
    // from=0 ('a') → rows below: b, c, d, e → 2 highlighted ('c' and 'e')
    expect(countHighlightedBelow(rows, hSet, 0, 10)).toBe(2);
  });

  test("does not count the `from` row itself even if highlighted", () => {
    const hSet = makeSet("a", "c");
    // from=0 ('a') is highlighted — not counted; 'c' below is counted
    expect(countHighlightedBelow(rows, hSet, 0, 10)).toBe(1);
  });

  test("respects the `limit` parameter", () => {
    const hSet = makeSet("b", "c", "d");
    // from=0, limit=2 → finds 'b' and 'c', stops at 2
    expect(countHighlightedBelow(rows, hSet, 0, 2)).toBe(2);
  });

  test("returns 0 when from is the last row", () => {
    const hSet = makeSet("a", "b");
    expect(countHighlightedBelow(rows, hSet, 4, 10)).toBe(0);
  });

  test("returns 0 when no highlighted rows exist below from", () => {
    const hSet = makeSet("a");
    // from=1 ('b') — 'a' is above, nothing below is highlighted
    expect(countHighlightedBelow(rows, hSet, 1, 10)).toBe(0);
  });
});

// ── computeDisplacedIndex ────────────────────────────────────────────────────

describe("computeDisplacedIndex", () => {
  const rows = makeRows("a", "b", "c", "d", "e");

  test("returns curIdx when hSet is null", () => {
    expect(computeDisplacedIndex(rows, null, 2)).toBe(2);
  });

  test("returns curIdx when hSet is empty", () => {
    expect(computeDisplacedIndex(rows, new Set(), 2)).toBe(2);
  });

  test("returns curIdx when already on a highlighted row", () => {
    const hSet = makeSet("c");
    expect(computeDisplacedIndex(rows, hSet, 2)).toBe(2); // 'c' is index 2
  });

  test("jumps forward when only forward match exists", () => {
    const hSet = makeSet("d");
    // cursor at 'b' (index 1), 'd' is at index 3
    expect(computeDisplacedIndex(rows, hSet, 1)).toBe(3);
  });

  test("jumps backward when only backward match exists", () => {
    const hSet = makeSet("a");
    // cursor at 'c' (index 2), 'a' is at index 0
    expect(computeDisplacedIndex(rows, hSet, 2)).toBe(0);
  });

  test("prefers closer match; on tie prefers backward", () => {
    const hSet = makeSet("a", "e");
    // cursor at 'c' (index 2). Distance to 'a' (index 0) = 2, distance to 'e' (index 4) = 2 → tie → prefer backward ('a')
    // Original condition: curIdx - bwd <= fwd - curIdx → 2 <= 2 → true → picks bwd
    expect(computeDisplacedIndex(rows, hSet, 2)).toBe(0);
  });

  test("picks the closer of fwd and bwd when not a tie", () => {
    const hSet = makeSet("b", "e");
    // cursor at 'c' (index 2). Distance to 'b' = 1, distance to 'e' = 2 → pick 'b'
    expect(computeDisplacedIndex(rows, hSet, 2)).toBe(1);
  });

  test("returns curIdx when no highlighted row exists anywhere", () => {
    const hSet = makeSet("z"); // hash not in rows
    expect(computeDisplacedIndex(rows, hSet, 2)).toBe(2);
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

  test("search focused closes after dialogs", () => {
    expect(computeCascadeTarget({ ...base, searchFocused: true })).toBe("search-focused");
  });

  test("detail focused closes after search", () => {
    expect(computeCascadeTarget({ ...base, detailFocused: true })).toBe("detail-focused");
  });

  test("search highlight cleared after detail focus", () => {
    expect(
      computeCascadeTarget({
        ...base,
        highlightSet: new Set(["abc"]),
        searchQuery: "fix",
      }),
    ).toBe("search-highlight");
  });

  test("ancestry highlight cleared after search highlight", () => {
    expect(
      computeCascadeTarget({
        ...base,
        highlightSet: new Set(["abc"]),
        ancestrySet: new Set(["abc"]),
      }),
    ).toBe("ancestry-highlight");
  });

  test("path highlight cleared after ancestry", () => {
    expect(
      computeCascadeTarget({
        ...base,
        highlightSet: new Set(["abc"]),
        pathFilter: "src/",
      }),
    ).toBe("path-highlight");
  });

  test("branch view cleared last", () => {
    expect(computeCascadeTarget({ ...base, viewingBranch: "feature/foo" })).toBe("branch-view");
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
