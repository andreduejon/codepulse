/**
 * A scrollbox that mounts only the items near the screen (core/scroll-window.ts): give it the items' heights, put
 * `before()` lines of space above the shown items and `after()` below them, and render `range()`. It follows the
 * scrollbox's scroll position, so scrolling by key, wheel or `scrollIntoView` brings the next items in.
 */
import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { type Accessor, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { itemOffsets, scrollDeltaFor, visibleRange } from "../../core/scroll-window";

/** Lines mounted beyond the screen on both sides: a page of keys or a wheel turn finds them there. */
const OVERSCAN = 40;

export function useScrollWindow(opts: {
  heights: Accessor<readonly number[]>;
  /** At least the scrollbox's height; the terminal's height will do. */
  screenHeight: Accessor<number>;
  /** False mounts every item, for items whose heights aren't known (wrapped text): no space above or below. */
  windowed?: Accessor<boolean>;
}) {
  const offsets = createMemo(() => itemOffsets(opts.heights()));
  const [top, setTop] = createSignal(0);
  let box: ScrollBoxRenderable | undefined;
  const follow = ({ position }: { position: number }) => setTop(position);
  const release = () => box?.verticalScrollBar.off("change", follow);
  onCleanup(release);

  // Frame callbacks run before each paint, which lays out the items: at the next callback, the layout holds the
  // offsets of the one before. A scroll asked for before that waits for it, so it lands after anything the same change
  // scrolled (another view scrolling to its top).
  const renderer = useRenderer();
  let painting: readonly number[] | null = null;
  let laidOut: readonly number[] | null = null;
  /** A scroll waiting for the layout, and the frames it has left (an item that went never gets there). */
  let pending: { index: number; padding: number; frames: number } | null = null;
  const onFrame = async () => {
    laidOut = painting;
    painting = untrack(offsets);
    if (!pending) return;
    if (apply(pending.index, pending.padding) || --pending.frames <= 0) pending = null;
    else renderer.requestRender();
  };
  renderer.setFrameCallback(onFrame);
  onCleanup(() => renderer.removeFrameCallback(onFrame));

  /** Scrolls now when the layout holds the current offsets; false otherwise. */
  function apply(index: number, padding: number): boolean {
    const all = untrack(offsets);
    if (!box || box.isDestroyed || laidOut !== all || index < 0 || index >= all.length - 1) return false;
    const height = box.viewport.height;
    if (!Number.isFinite(height) || height <= 0) return false;
    const delta = scrollDeltaFor(all[index], all[index + 1] - all[index], box.scrollTop, height, padding);
    if (delta !== 0) box.scrollBy({ x: 0, y: delta });
    return true;
  }

  const windowed = () => opts.windowed?.() ?? true;
  const range = createMemo(
    () =>
      windowed()
        ? visibleRange(offsets(), top(), opts.screenHeight(), OVERSCAN)
        : { start: 0, end: offsets().length - 1 },
    undefined,
    {
      equals: (a, b) => a.start === b.start && a.end === b.end,
    },
  );

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
     * Scrolls an item into view with `padding` lines around it, now or once the layout holds the items as they are
     * (they just changed). Only while windowed: false otherwise, and for an item that isn't there.
     */
    scrollIntoView: (index: number, padding = 1): boolean => {
      // Untracked: an effect that scrolls to a row must not run again for every change of the list.
      if (!untrack(windowed) || index < 0 || index >= untrack(offsets).length - 1) return false;
      pending = null;
      if (apply(index, padding)) return true;
      pending = { index, padding, frames: 10 };
      renderer.requestRender();
      return true;
    },
  };
}

export type ScrollWindow = ReturnType<typeof useScrollWindow>;
