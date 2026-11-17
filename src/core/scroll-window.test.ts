import { expect, test } from "bun:test";
import { itemOffsets, scrollDeltaFor, visibleRange } from "./scroll-window";

test("offsets are where each item starts, and the last one is the total height", () => {
  expect(itemOffsets([2, 1, 3])).toEqual([0, 2, 3, 6]);
  expect(itemOffsets([])).toEqual([0]);
});

test("the visible range holds the items that overlap the screen, with the overscan around it", () => {
  const offsets = itemOffsets(Array.from({ length: 100 }, () => 2));
  expect(visibleRange(offsets, 0, 10, 0)).toEqual({ start: 0, end: 5 });
  // Line 11 is the second line of item 5: items 5 to 10 overlap lines 11 to 20.
  expect(visibleRange(offsets, 11, 10, 0)).toEqual({ start: 5, end: 11 });
  expect(visibleRange(offsets, 11, 10, 4)).toEqual({ start: 3, end: 13 });
  expect(visibleRange(offsets, 190, 20, 4)).toEqual({ start: 93, end: 100 });
  expect(visibleRange(itemOffsets([]), 0, 10, 4)).toEqual({ start: 0, end: 0 });
});

test("the scroll delta brings an item into view with padding, and is 0 when it shows", () => {
  // The screen shows lines 10 to 19.
  expect(scrollDeltaFor(12, 2, 10, 10, 1)).toBe(0);
  expect(scrollDeltaFor(10, 1, 10, 10, 1)).toBe(-1);
  expect(scrollDeltaFor(18, 2, 10, 10, 1)).toBe(1);
  expect(scrollDeltaFor(40, 2, 10, 10, 1)).toBe(23);
  // Taller than the screen: its top goes to the padding line.
  expect(scrollDeltaFor(40, 30, 10, 10, 1)).toBe(29);
});
