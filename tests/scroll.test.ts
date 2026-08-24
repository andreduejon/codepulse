import { describe, expect, test } from "bun:test";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { scrollElementIntoView } from "../src/utils/scroll";

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
  test("aligns a tall selectable item by its top edge", () => {
    const { box, positions } = scrollbox(0, 10);
    scrollElementIntoView(box, element(20, 15));
    expect(positions).toEqual([19]);
  });

  test("scrolls a normal item bottom into view", () => {
    const { box, positions } = scrollbox(0, 10);
    scrollElementIntoView(box, element(12, 1));
    expect(positions).toEqual([4]);
  });

  test("uses screen coordinates for nested rows", () => {
    const { box, positions } = scrollbox(5, 10);
    scrollElementIntoView(box, element(20, 1));
    expect(positions).toEqual([7]);
  });
});
