/**
 * Seeded randomness for the demo's made-up content (test names, timings, CSV rows): the same seed gives the same
 * content every run, so a headless play prints the same screens.
 */

export interface Random {
  /** 0 ≤ n < 1 */
  next(): number;
  /** min ≤ n ≤ max */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

export function seeded(seed: string): Random {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: items => items[Math.floor(next() * items.length)],
  };
}
