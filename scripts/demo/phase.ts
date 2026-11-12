/**
 * Where the demo's world is (see the phases in scenario.ts). One module instance per app process: the fake servers
 * read it, and `--live` (a timer) or the headless player's `advance` step moves it on.
 */
import { LAST_PHASE, type Phase } from "./scenario";

const at: number[] = [Date.now()];
const listeners: ((phase: Phase) => void)[] = [];

export function currentPhase(): Phase {
  return { index: at.length - 1, at: [...at] };
}

/** Moves the world to its next phase; false when it is already at the last one. */
export function advancePhase(): boolean {
  if (at.length - 1 >= LAST_PHASE) return false;
  at.push(Date.now());
  const phase = currentPhase();
  for (const listener of listeners) listener(phase);
  return true;
}

export function onPhase(listener: (phase: Phase) => void): void {
  listeners.push(listener);
}
