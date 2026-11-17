/**
 * Time for measuring and waiting, in milliseconds: durations, backoff, staleness, cooldowns, key repeat. It only moves
 * forward and doesn't follow the wall clock, so a clock change (or the headless demo's clock, which stands still)
 * doesn't stretch or skip a wait. Dates and ages on screen use `Date`.
 *
 * A function of its own, so tests can move it on (`spyOn(monotonic, "monotonicNow")`) instead of the wall clock.
 */
export function monotonicNow(): number {
  return performance.now();
}

/** A moment before every other: "never", for times compared with `monotonicNow()`. */
export const NEVER = Number.NEGATIVE_INFINITY;
