/**
 * A root commit ends its lane with nothing below it. The next row must not start an unrelated branch in that same
 * column, or the two read as one branch (an orphan gh-pages root right above a feature branch's tip).
 */
import { expect, test } from "bun:test";
import { buildGraph } from "../src/git/graph";
import { findRow, makeCommit } from "./test-helpers";

test("a new branch tip right below a root takes another column", () => {
  const rows = buildGraph([
    makeCommit("m2", ["m1"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("p2", ["p1"], [{ name: "gh-pages", type: "branch", isCurrent: false }]),
    makeCommit("p1", []),
    makeCommit("d1", ["m1"], [{ name: "feature/dark-mode", type: "branch", isCurrent: false }]),
    makeCommit("m1", []),
  ]);
  expect(findRow(rows, "p1").nodeColumn).toBe(1);
  expect(findRow(rows, "d1").nodeColumn).not.toBe(1);
});

test("one row later, the root's column is free again", () => {
  const rows = buildGraph([
    makeCommit("m3", ["m2"], [{ name: "main", type: "branch", isCurrent: true }]),
    makeCommit("p1", [], [{ name: "gh-pages", type: "branch", isCurrent: false }]),
    makeCommit("m2", ["m1"]),
    makeCommit("d1", ["m1"], [{ name: "feature/dark-mode", type: "branch", isCurrent: false }]),
    makeCommit("m1", []),
  ]);
  expect(findRow(rows, "p1").nodeColumn).toBe(1);
  expect(findRow(rows, "m2").nodeColumn).toBe(0);
  expect(findRow(rows, "d1").nodeColumn).toBe(1);
});

test("roots in a row take turns between two columns instead of moving right", () => {
  const roots = Array.from({ length: 14 }, (_, i) => makeCommit(`r${i}`, []));
  const rows = buildGraph(roots);
  expect(rows.map(row => row.nodeColumn)).toEqual(Array.from({ length: 14 }, (_, i) => i % 2));
});
