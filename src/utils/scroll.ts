import type { Renderable, ScrollBoxRenderable } from "@opentui/core";

/**
 * Scrolls `el` into view inside `scrollbox`, keeping at least `padding` rows
 * of context visible above and below the target element.
 *
 * No-op if either reference is undefined.
 */
export function scrollElementIntoView(scrollbox: ScrollBoxRenderable, el: Renderable, padding = 1): void {
  const rowTop = el.screenY;
  const rowBottom = rowTop + el.height;
  const viewportTop = scrollbox.viewport.screenY;
  const viewportHeight = scrollbox.viewport.height;
  const viewportBottom = viewportTop + viewportHeight;
  const usableHeight = Math.max(1, viewportHeight - padding * 2);

  // An item taller than the viewport cannot fit entirely. Keep its selectable
  // top edge visible instead of aligning its bottom and losing the cursor row.
  if (el.height > usableHeight) {
    if (rowTop < viewportTop + padding || rowTop >= viewportBottom - padding) {
      scrollbox.scrollBy({ x: 0, y: rowTop - viewportTop - padding });
    }
    return;
  }

  if (rowTop < viewportTop + padding) {
    scrollbox.scrollBy({ x: 0, y: rowTop - viewportTop - padding });
  } else if (rowBottom > viewportBottom - padding) {
    scrollbox.scrollBy({ x: 0, y: rowBottom - viewportBottom + padding });
  }
}

export function scrollIndexedItemIntoView(
  scrollbox: ScrollBoxRenderable | undefined,
  itemRefs: readonly (Renderable | undefined)[],
  index: number | null | undefined,
  padding = 1,
): void {
  if (!scrollbox || index == null || index < 0) return;
  const el = itemRefs[index];
  if (!el) return;
  scrollElementIntoView(scrollbox, el, padding);
}
