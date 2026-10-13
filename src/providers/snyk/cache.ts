import { DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../shared/sha-sqlite-cache";
import { isSnykScanResult } from "./parser";
import type { SnykCacheLimit, SnykScanResult } from "./types";

export const DEFAULT_SNYK_CACHE_LIMIT: SnykCacheLimit = 20;
export const DEFAULT_SNYK_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export interface SnykCacheOptions {
  root?: string;
  maxEntries?: SnykCacheLimit;
}

export class SnykCache extends ShaSqliteCache<SnykScanResult> {
  constructor(options: SnykCacheOptions = {}) {
    super({
      provider: "snyk",
      root: options.root ?? DEFAULT_SNYK_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_SNYK_CACHE_LIMIT,
      isEntry: isSnykScanResult,
      invalidMessage: "Cannot cache an invalid Snyk scan result.",
    });
  }
}
