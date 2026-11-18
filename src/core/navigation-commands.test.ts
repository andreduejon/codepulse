/** Moving through the graph without keys or Solid: the state is a plain object. */
import { expect, test } from "bun:test";
import type { GraphRow } from "./git/types";
import { createGraphNavigation } from "./navigation";

function harness(highlight: string[] | null, hasMore = true) {
  const rows = Array.from({ length: 20 }, (_, index) => ({ commit: { hash: `c${index}` } })) as unknown as GraphRow[];
  const app = { cursor: 0, loads: 0 };
  const navigation = createGraphNavigation({
    state: {
      graphRows: () => rows,
      highlightSet: () => (highlight ? new Set(highlight) : null),
      cursorIndex: () => app.cursor,
      hasMore: () => hasMore,
    },
    actions: {
      setCursorIndex: index => {
        app.cursor = index;
      },
      setScrollTargetIndex: () => {},
      moveCursor: delta => {
        app.cursor = Math.max(0, Math.min(rows.length - 1, app.cursor + delta));
      },
    },
    loadMore: () => app.loads++,
  });
  return { app, navigation };
}

test("without a highlight, a step moves by rows and stops at the ends", () => {
  const h = harness(null);
  h.navigation.step(1, 10);
  expect(h.app.cursor).toBe(10);
  h.navigation.step(-1, 50);
  expect(h.app.cursor).toBe(0);
  h.navigation.toEnd("last");
  expect(h.app.cursor).toBe(19);
});

test("with a highlight, a step goes to the next highlighted row, and the next page loads before they run out", () => {
  const h = harness(["c3", "c9", "c15"]);
  h.navigation.step(1, 1);
  expect(h.app.cursor).toBe(3);
  expect(h.app.loads).toBe(1);
  h.navigation.toEnd("first");
  expect(h.app.cursor).toBe(3);
  h.navigation.toEnd("last");
  expect(h.app.cursor).toBe(15);
});

test("going up never loads a page", () => {
  const h = harness(["c3"]);
  h.app.cursor = 10;
  h.navigation.step(-1, 1);
  expect(h.app.cursor).toBe(3);
  expect(h.app.loads).toBe(0);
});
