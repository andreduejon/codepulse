import { describe, expect, test } from "bun:test";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { scrollElementIntoView } from "../src/tui/utils/scroll";

function element(top: number, height: number): Renderable {
  return {
    screenY: top,
    height,
    getLayoutNode: () => ({ getComputedLayout: () => ({ top, height }) }),
  } as unknown as Renderable;
}

function scrollbox(viewportTop: number, height: number) {
  const positions: number[] = [];
  return {
    box: {
      viewport: { screenY: viewportTop, height },
      scrollBy: (position: { y: number }) => positions.push(position.y),
    } as unknown as ScrollBoxRenderable,
    positions,
  };
}

describe("scrollElementIntoView", () => {
  test.each([
    ["aligns a tall selectable item by its top edge", 0, element(20, 15), [19]],
    ["scrolls a normal item bottom into view", 0, element(12, 1), [4]],
    ["uses screen coordinates for nested rows", 5, element(20, 1), [7]],
  ])("%s", (_label, viewportTop, target, expected) => {
    const { box, positions } = scrollbox(viewportTop, 10);
    scrollElementIntoView(box, target);
    expect(positions).toEqual(expected);
  });

  test("ignores items without layout", () => {
    const { box, positions } = scrollbox(0, 10);
    expect(scrollElementIntoView(box, element(0, 0))).toBe(false);
    expect(positions).toEqual([]);
  });

  test("ignores a stale upward yank while moving down", () => {
    const { box, positions } = scrollbox(10, 10);
    expect(scrollElementIntoView(box, element(0, 1), 1, 1)).toBe(true);
    expect(positions).toEqual([]);
  });
});

describe("scheduled scrolls", () => {
  test("a retry waiting when its screen closes never runs: it would touch an element another renderer drew", async () => {
    const { createRoot } = await import("solid-js");
    const { scheduleScrollIntoView, useScrollSchedule } = await import("../src/tui/utils/scroll");
    let calls = 0;
    const dispose = createRoot(dispose => {
      // Layout not ready: the scroll waits for a retry.
      scheduleScrollIntoView(useScrollSchedule(), () => {
        calls++;
        return false;
      });
      return dispose;
    });
    expect(calls).toBe(1);
    dispose();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(calls).toBe(1);
  });
});
