import type { Renderable, ScrollBoxRenderable } from "@opentui/core";

/**
 * Scrolls `el` into view inside `scrollbox`, keeping at least `padding` rows
 * of context visible above and below the target element.
 *
 * No-op if either reference is undefined.
 */
export function scrollElementIntoView(scrollbox: ScrollBoxRenderable, el: Renderable, padding = 1): void {
  const layout = el.getLayoutNode().getComputedLayout();
  const rowTop = layout.top;
  const rowBottom = rowTop + layout.height;

  const viewportHeight = scrollbox.viewport.height;
  const currentScroll = scrollbox.scrollTop;
  const visibleBottom = currentScroll + viewportHeight;

  if (rowTop < currentScroll + padding) {
    scrollbox.scrollTo(Math.max(0, rowTop - padding));
  } else if (rowBottom > visibleBottom - padding) {
    scrollbox.scrollTo(rowBottom - viewportHeight + padding);
  }
}
