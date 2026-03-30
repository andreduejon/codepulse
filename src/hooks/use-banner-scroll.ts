import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";

/** Scrolling speed: shift 1 char every N ms. */
const BANNER_TICK_MS = 200;
/** Pause at each end before reversing (ms). */
const BANNER_PAUSE_MS = 1500;

/**
 * Shared hook for cursor-aware banner scrolling.
 *
 * Drives a back-and-forth text scroll when content overflows its visible area.
 * The caller provides a reactive `overflow` accessor that returns:
 *   - A positive number (chars beyond visible width) to scroll
 *   - 0 or negative to stop scrolling (text fits)
 *
 * Returns `bannerOffset()` — the current character offset to apply
 * when rendering (e.g. `text.substring(offset, offset + visibleWidth)`).
 *
 * The hook automatically restarts when the overflow value changes
 * and cleans up timers on unmount.
 */
export function useBannerScroll(overflow: Accessor<number>): Accessor<number> {
  const [bannerOffset, setBannerOffset] = createSignal(0);
  const [bannerDirection, setBannerDirection] = createSignal<1 | -1>(1);
  let bannerTimer: ReturnType<typeof setInterval> | undefined;
  let bannerPauseTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (bannerTimer) {
      clearInterval(bannerTimer);
      bannerTimer = undefined;
    }
    if (bannerPauseTimer) {
      clearTimeout(bannerPauseTimer);
      bannerPauseTimer = undefined;
    }
    setBannerOffset(0);
    setBannerDirection(1);
  };

  const start = (maxOverflow: number) => {
    if (maxOverflow <= 0) return;
    bannerTimer = setInterval(() => {
      setBannerOffset(prev => {
        const dir = bannerDirection();
        const next = prev + dir;
        if (next >= maxOverflow) {
          clearInterval(bannerTimer);
          bannerTimer = undefined;
          bannerPauseTimer = setTimeout(() => {
            setBannerDirection(-1);
            start(maxOverflow);
          }, BANNER_PAUSE_MS);
          return maxOverflow;
        }
        if (next <= 0) {
          clearInterval(bannerTimer);
          bannerTimer = undefined;
          bannerPauseTimer = setTimeout(() => {
            setBannerDirection(1);
            start(maxOverflow);
          }, BANNER_PAUSE_MS);
          return 0;
        }
        return next;
      });
    }, BANNER_TICK_MS);
  };

  // Restart when overflow changes (cursor moved, focus changed, etc.)
  createEffect(() => {
    const ov = overflow();
    stop();
    if (ov > 0) {
      bannerPauseTimer = setTimeout(() => start(ov), BANNER_PAUSE_MS);
    }
  });

  onCleanup(() => stop());

  return bannerOffset;
}
