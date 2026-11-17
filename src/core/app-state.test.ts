import { expect, test } from "bun:test";
import { clampCursor, highlightModeOf, sameSet, searchMatches } from "./app-state";
import type { GraphRow } from "./git/types";
import { parseSearchQuery } from "./search";

test("one highlight at a time: ancestry, then path, then search", () => {
  expect(highlightModeOf(new Set(), new Set(), "fix")).toBe("ancestry");
  expect(highlightModeOf(null, new Set(), "fix")).toBe("path");
  expect(highlightModeOf(null, null, "fix")).toBe("search");
  expect(highlightModeOf(null, null, "")).toBeNull();
});

test("a search matches the rows' commits by subject", () => {
  const rows = [
    { commit: { hash: "a", subject: "fix the cart", body: "", author: "", shortHash: "a", refs: [] } },
    { commit: { hash: "b", subject: "add the shop", body: "", author: "", shortHash: "b", refs: [] } },
  ] as unknown as GraphRow[];
  expect(searchMatches(rows, parseSearchQuery("cart"))).toEqual(new Set(["a"]));
});

test("sets are the same when they hold the same values, in any order", () => {
  expect(sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true);
  expect(sameSet(new Set([1, 2]), new Set([1]))).toBe(false);
});

test("the cursor stops at the first and the last item", () => {
  expect(clampCursor(3, 10, 5)).toBe(4);
  expect(clampCursor(1, -5, 5)).toBe(0);
  expect(clampCursor(0, 1, 0)).toBe(0);
});
