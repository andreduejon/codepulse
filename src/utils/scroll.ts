import type { Renderable, ScrollBoxRenderable } from "@opentui/core";

const SCROLL_RETRY_MS = 16;

export interface ScrollSchedule {
  scrollTimer?: ReturnType<typeof setTimeout>;
}

export function hasScrollLayout(el: { screenY: number; height: number } | undefined): boolean {
  return !!el && Number.isFinite(el.screenY) && Number.isFinite(el.height) && el.height > 0;
}

/**
 * Scrolls `el` into view inside `scrollbox`, keeping at least `padding` rows
 * of context visible above and below the target element.
 *
 * No-op if either reference is undefined or layout is not ready.
 */
export function scrollElementIntoView(
  scrollbox: ScrollBoxRenderable,
  el: Renderable,
  padding = 1,
  direction: -1 | 0 | 1 = 0,
): boolean {
  if (!hasScrollLayout(el)) return false;
  const rowTop = el.screenY;
  const rowBottom = rowTop + el.height;
  const viewportTop = scrollbox.viewport.screenY;
  const viewportHeight = scrollbox.viewport.height;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;
  const viewportBottom = viewportTop + viewportHeight;
  const usableHeight = Math.max(1, viewportHeight - padding * 2);

  let delta = 0;
  if (el.height > usableHeight) {
    if (rowTop < viewportTop + padding || rowTop >= viewportBottom - padding) {
      delta = rowTop - viewportTop - padding;
    }
  } else if (rowTop < viewportTop + padding) {
    delta = rowTop - viewportTop - padding;
  } else if (rowBottom > viewportBottom - padding) {
    delta = rowBottom - viewportBottom + padding;
  }

  // Stale screenY after a cursor move often looks like y=0 and yanks the
  // viewport to the top. Ignore a delta that fights the move direction.
  if (direction > 0 && delta < 0) return true;
  if (direction < 0 && delta > 0) return true;
  if (delta !== 0) scrollbox.scrollBy({ x: 0, y: delta });
  return true;
}

/** Scroll now. Retry once if layout is not ready. Cancels a pending retry so key-repeat cannot stack. */
export function scheduleScrollIntoView(holder: ScrollSchedule, apply: () => boolean): void {
  if (holder.scrollTimer) {
    clearTimeout(holder.scrollTimer);
    holder.scrollTimer = undefined;
  }
  if (apply()) return;
  holder.scrollTimer = setTimeout(() => {
    holder.scrollTimer = undefined;
    apply();
  }, SCROLL_RETRY_MS);
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
