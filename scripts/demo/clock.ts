/**
 * Preloaded into the headless demo (`--play`) before anything else: the app's clock starts at a fixed moment
 * (FIXED_NOW) and runs on from there, so ages and dates on screen come out the same every run. Only `Date` moves;
 * timers run in real time.
 */
import { FIXED_NOW } from "./scenario";

const RealDate = Date;
const offset = FIXED_NOW - RealDate.now();
const now = () => RealDate.now() + offset;

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
