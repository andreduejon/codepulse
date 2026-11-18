/** Path mode without Solid: Git is a fake that answers when the test says. */
import { expect, test } from "bun:test";
import { createPathFilter, nearestMatchingRow, pathScope } from "./path-filter";
import type { GitPort } from "./port";
import type { GraphRow } from "./types";

const rows = ["a", "b", "c", "d", "e"].map(hash => ({ commit: { hash } })) as unknown as GraphRow[];

test("the nearest matching row: the cursor's own, else the closer one, the earlier on a tie", () => {
  expect(nearestMatchingRow(rows, 2, new Set(["c"]))).toBe(2);
  expect(nearestMatchingRow(rows, 2, new Set(["a", "e"]))).toBe(0);
  expect(nearestMatchingRow(rows, 2, new Set(["a", "d"]))).toBe(3);
  expect(nearestMatchingRow(rows, 9, new Set(["b"]))).toBe(1);
  expect(nearestMatchingRow(rows, 2, new Set())).toBe(-1);
});

test("the scope: a branch on its own, else every branch or the checked-out one", () => {
  expect(pathScope("main", true)).toEqual({ branch: "main", all: false });
  expect(pathScope(null, true)).toEqual({ branch: undefined, all: true });
});

function harness() {
  const app = { path: null as string | null, matches: null as Set<string> | null, cursor: 0 };
  const pending: ((hashes: Set<string>) => void)[] = [];
  const git = {
    getPathMatchingHashes: () => new Promise<Set<string>>(resolve => pending.push(resolve)),
  } as unknown as GitPort;
  const filter = createPathFilter({
    git,
    repoPath: () => "/repo",
    state: {
      pathFilter: () => app.path,
      viewingBranch: () => null,
      showAllBranches: () => true,
      graphRows: () => rows,
      cursorIndex: () => app.cursor,
    },
    actions: {
      setPathFilter: path => {
        app.path = path;
      },
      setPathMatchSet: matches => {
        app.matches = matches;
      },
      setCursorIndex: index => {
        app.cursor = index;
      },
      setScrollTargetIndex: () => {},
    },
  });
  return { app, filter, answer: (index: number, hashes: string[]) => pending[index](new Set(hashes)) };
}

test("a path shows its commits and moves the cursor to the nearest; an answer for an older path is dropped", async () => {
  const h = harness();
  const first = h.filter.apply("src/a");
  const second = h.filter.apply("src/b");
  h.answer(0, ["b"]);
  h.answer(1, ["d"]);
  await Promise.all([first, second]);
  expect(h.app.matches).toEqual(new Set(["d"]));
  expect(h.app.cursor).toBe(3);
  await h.filter.apply("");
  expect(h.app.path).toBeNull();
  expect(h.app.matches).toBeNull();
});
