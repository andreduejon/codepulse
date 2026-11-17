/** Key repeat: a held j or k moves at most once per frame. */

import { monotonicNow, NEVER } from "../../core/monotonic";
import { NAV_REPEAT_MIN_MS } from "../constants";

let lastRepeatNavAt = NEVER;

/** Accept at most one held j/k move per frame. Single taps always pass. */
export function allowRepeatNav(now = monotonicNow()): boolean {
  if (now - lastRepeatNavAt < NAV_REPEAT_MIN_MS) return false;
  lastRepeatNavAt = now;
  return true;
}

export function resetRepeatNav(): void {
  lastRepeatNavAt = NEVER;
}
