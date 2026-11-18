import { snykProvider } from "../../core/snyk/definition";
import { isSnykScanResult } from "../../core/snyk/parser";
import type { SnykCacheLimit, SnykScanResult } from "../../core/snyk/types";
import { DEFAULT_SNYK_CACHE_LIMIT } from "../../core/snyk/types";
import { type CacheLocation, DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../cache/sha-sqlite-cache";

export const DEFAULT_SNYK_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export interface SnykCacheOptions extends CacheLocation {
  maxEntries?: SnykCacheLimit;
}

export class SnykCache extends ShaSqliteCache<SnykScanResult> {
  constructor(options: SnykCacheOptions = {}) {
    super({
      // Its rows are its provider's: the cache screen and evictions group them by its id.
      provider: snykProvider.id,
      root: options.root ?? DEFAULT_SNYK_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_SNYK_CACHE_LIMIT,
      isEntry: isSnykScanResult,
      invalidMessage: "Cannot cache an invalid Snyk scan result.",
      registry: options.registry,
    });
  }
}
