import { describe, expect, test } from "bun:test";
import {
  cycleProviderCacheLimit,
  cycleProviderLimit,
  DEFAULT_PROVIDER_CACHE_LIMIT,
  DEFAULT_PROVIDER_LIMIT,
  isProviderCacheLimit,
  isProviderLimit,
  PROVIDER_CACHE_LIMIT_OPTIONS,
  PROVIDER_LIMIT_OPTIONS,
} from "./auto-refresh";

describe("provider cache limits", () => {
  test("accepts and selects all bounded cache options with default 20", () => {
    expect(PROVIDER_CACHE_LIMIT_OPTIONS).toEqual([10, 20, 50, 100, 200, 500]);
    expect(DEFAULT_PROVIDER_CACHE_LIMIT).toBe(20);
    for (const limit of PROVIDER_CACHE_LIMIT_OPTIONS) {
      expect(isProviderCacheLimit(limit)).toBe(true);
      expect(cycleProviderCacheLimit(String(limit))).toBe(limit);
    }
  });

  test("rejects invalid cache values and falls back to 20 for unknown menu values", () => {
    for (const value of [undefined, null, "100", 0, -10, 30, 501, 1000, 10.5, NaN, Infinity]) {
      expect(isProviderCacheLimit(value)).toBe(false);
    }
    for (const value of ["", "30", "1000", "100.0", " 100 "]) {
      expect(cycleProviderCacheLimit(value)).toBe(20);
    }
  });

  test("keeps fetch limits at 10, 20, 50 with default 20", () => {
    expect(PROVIDER_LIMIT_OPTIONS).toEqual([10, 20, 50]);
    expect(DEFAULT_PROVIDER_LIMIT).toBe(20);
    for (const limit of PROVIDER_LIMIT_OPTIONS) {
      expect(isProviderLimit(limit)).toBe(true);
      expect(cycleProviderLimit(String(limit))).toBe(limit);
    }
    for (const limit of [100, 200, 500]) {
      expect(isProviderLimit(limit)).toBe(false);
      expect(cycleProviderLimit(String(limit))).toBe(20);
    }
  });
});
