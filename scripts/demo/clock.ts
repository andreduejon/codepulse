/**
 * Preloaded into the headless demo (`--play`) before anything else: the app's wall clock stands at a fixed moment
 * (FIXED_NOW), so ages and dates on screen come out the same every run, however long a run takes. Only a `sleep:`
 * step moves it on, by exactly its time (`advanceDemoClock`). Timers and the app's waits (backoff, staleness, key
 * repeat) run on `performance.now()`, which keeps running.
 */
import { FIXED_NOW } from "./scenario";

const RealDate = Date;
let current = FIXED_NOW;
const now = () => current;

/** Moves the headless clock on by `ms`: what a `sleep:` step does, so the ages it shows after are the same each run. */
export function advanceDemoClock(ms: number): void {
  current += ms;
}

globalThis.Date = new Proxy(RealDate, {
  construct(target, args, newTarget) {
    return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget);
  },
  apply() {
    return new RealDate(now()).toString();
  },
  get(target, key, receiver) {
    return key === "now" ? now : Reflect.get(target, key, receiver);
  },
});
