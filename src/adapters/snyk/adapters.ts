/** Snyk's adapters for its service: the scanner (the Snyk CLI), its cache, and the token in the environment. */
import type { SnykAdapters } from "../../core/snyk/service";
import type { ProviderCacheRegistry } from "../cache/sha-sqlite-cache";
import { SnykCache } from "./cache";
import * as scanner from "./scanner";

export function snykAdapters(cacheRoot?: string, registry?: ProviderCacheRegistry): SnykAdapters {
  const at = { cacheRoot, registry };
  return {
    scan: options => scanner.scanSnykCommit(options, at),
    readCache: (repoPath, sha, options) => scanner.getCachedSnykScan(repoPath, sha, { ...options, ...at }),
    hasToken: envVar => !!process.env[envVar]?.trim(),
    storedScans: app => new SnykCache({ root: cacheRoot, registry }).peekAll(app),
  };
}
