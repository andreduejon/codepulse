import { expect, test } from "bun:test";
import { rememberRecent } from "./recent";

test("keeps the most recently remembered, dropping the oldest past the limit", () => {
  let kept: ReadonlyMap<string, number> = new Map();
  for (const [index, key] of ["a", "b", "c", "d"].entries()) kept = rememberRecent(kept, key, index, 3);
  expect([...kept.keys()]).toEqual(["b", "c", "d"]);
  // Remembered again: it is the newest now, so the next one drops another.
  kept = rememberRecent(kept, "b", 10, 3);
  kept = rememberRecent(kept, "e", 4, 3);
  expect([...kept.entries()]).toEqual([
    ["d", 3],
    ["b", 10],
    ["e", 4],
  ]);
});

test("leaves the map it was given as it was", () => {
  const before = new Map([["a", 1]]);
  rememberRecent(before, "b", 2, 1);
  expect([...before.keys()]).toEqual(["a"]);
});
