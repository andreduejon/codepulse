/**
 * A long list that mounts only what shows: the items' heights give where each starts, the scroll position and the
 * screen's height give which items overlap it. The items outside take their height as empty space, so the list
 * scrolls as if all of them were there.
 */

/** Where each item starts, from their heights: `offsets[i]` is item i's top, the last entry the total height. */
export function itemOffsets(heights: Iterable<number>): number[] {
  const offsets = [0];
  let top = 0;
  for (const height of heights) {
    top += height;
    offsets.push(top);
  }
  return offsets;
}

/** The first item that ends below `line`. */
function firstEndingBelow(offsets: readonly number[], line: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1] > line) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The items [start, end) that overlap the lines `top` to `top + height`, with `overscan` lines more on both sides. */
export function visibleRange(
  offsets: readonly number[],
  top: number,
  height: number,
  overscan: number,
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const start = firstEndingBelow(offsets, Math.max(0, top - overscan));
  const bottom = top + height + overscan;
  let end = start;
  while (end < count && offsets[end] < bottom) end++;
  return { start, end };
}

/**
 * How far to scroll so an item (from `itemTop`, `itemHeight` lines) shows with `padding` lines around it on a screen
 * from `viewTop`, `viewHeight` lines; 0 when it shows. An item taller than the screen shows from its top.
 */
export function scrollDeltaFor(
  itemTop: number,
  itemHeight: number,
  viewTop: number,
  viewHeight: number,
  padding: number,
): number {
  const viewBottom = viewTop + viewHeight;
  const usable = Math.max(1, viewHeight - padding * 2);
  if (itemHeight > usable) {
    return itemTop < viewTop + padding || itemTop >= viewBottom - padding ? itemTop - viewTop - padding : 0;
  }
  if (itemTop < viewTop + padding) return itemTop - viewTop - padding;
  if (itemTop + itemHeight > viewBottom - padding) return itemTop + itemHeight - viewBottom + padding;
  return 0;
}
