/**
 * A scrollbox that mounts only the items near the screen (core/scroll-window.ts): give it the items' heights, put
 * `before()` lines of space above the shown items and `after()` below them, and render `range()`. It follows the
 * scrollbox's scroll position, so scrolling by key, wheel or `scrollIntoView` brings the next items in.
 */
import type { ScrollBoxRenderable } from "@opentui/core";
import { type Accessor, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { itemOffsets, scrollDeltaFor, visibleRange } from "../core/scroll-window";

/** Lines mounted beyond the screen on both sides: a page of keys or a wheel turn finds them there. */
const OVERSCAN = 40;

export function useScrollWindow(opts: {
  heights: Accessor<readonly number[]>;
  /** At least the scrollbox's height; the terminal's height will do. */
  screenHeight: Accessor<number>;
}) {
  const offsets = createMemo(() => itemOffsets(opts.heights()));
  const [top, setTop] = createSignal(0);
  let box: ScrollBoxRenderable | undefined;
  const follow = ({ position }: { position: number }) => setTop(position);
  const release = () => box?.verticalScrollBar.off("change", follow);
  onCleanup(release);

  const range = createMemo(() => visibleRange(offsets(), top(), opts.screenHeight(), OVERSCAN), undefined, {
    equals: (a, b) => a.start === b.start && a.end === b.end,
  });

  return {
    /** The scrollbox to follow (its ref). */
    attach: (scrollbox: ScrollBoxRenderable) => {
      if (scrollbox === box) return;
      release();
      box = scrollbox;
      scrollbox.verticalScrollBar.on("change", follow);
      setTop(scrollbox.scrollTop);
    },
    range,
    /** Lines of space above the shown items. */
    before: () => offsets()[range().start] ?? 0,
    /** Lines of space below the shown items. */
    after: () => {
      const all = offsets();
      return (all.at(-1) ?? 0) - (all[range().end] ?? 0);
    },
    /**
     * Scrolls an item into view with `padding` lines around it. False while the scrollbox has no height yet or its
     * content doesn't reach the item (it was just added): try again after the next layout.
     */
    scrollIntoView: (index: number, padding = 1): boolean => {
      // Untracked: an effect that scrolls to a row must not run again for every change of the list.
      const all = untrack(offsets);
      if (!box || box.isDestroyed || index < 0 || index >= all.length - 1) return false;
      const height = box.viewport.height;
      if (!Number.isFinite(height) || height <= 0 || box.scrollHeight < all[index + 1]) return false;
      const delta = scrollDeltaFor(all[index], all[index + 1] - all[index], box.scrollTop, height, padding);
      if (delta !== 0) box.scrollBy({ x: 0, y: delta });
      return true;
    },
  };
}

export type ScrollWindow = ReturnType<typeof useScrollWindow>;
