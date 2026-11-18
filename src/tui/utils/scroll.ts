import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { onCleanup } from "solid-js";
import { scrollDeltaFor } from "../../core/scroll-window";

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
  const viewportTop = scrollbox.viewport.screenY;
  const viewportHeight = scrollbox.viewport.height;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;
  const delta = scrollDeltaFor(rowTop, el.height, viewportTop, viewportHeight, padding);

  // Stale screenY after a cursor move often looks like y=0 and yanks the
  // viewport to the top. Ignore a delta that fights the move direction.
  if (direction > 0 && delta < 0) return true;
  if (direction < 0 && delta > 0) return true;
  if (delta !== 0) scrollbox.scrollBy({ x: 0, y: delta });
  return true;
}

/**
 * A screen's scroll schedule: a retry still waiting when the screen closes is cancelled, so it never touches an
 * element of a closed screen (in tests, another renderer's: OpenTUI refuses that with `WrongContext`).
 */
export function useScrollSchedule(): ScrollSchedule {
  const schedule: ScrollSchedule = {};
  onCleanup(() => {
    if (schedule.scrollTimer) clearTimeout(schedule.scrollTimer);
    schedule.scrollTimer = undefined;
  });
  return schedule;
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
