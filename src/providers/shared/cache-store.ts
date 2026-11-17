/**
 * The SQLite provider cache as the app's cache store. The calls go through the modules at call time, so a test's spy
 * on one of their functions sees them.
 */
import { join, resolve } from "node:path";
import type { CacheStorePort } from "../../core/cache-store";
import * as management from "./cache-management";
import * as sqlite from "./sha-sqlite-cache";

export function providerCacheStore(
  root: string = sqlite.DEFAULT_PROVIDER_CACHE_ROOT,
  registry: sqlite.ProviderCacheRegistry = sqlite.providerCacheRegistry,
): CacheStorePort {
  return {
    path: () => join(resolve(root), "cache.sqlite"),
    summary: () => management.getProviderCacheSummary(root),
    resetTimer: repoHash => management.resetRepositoryCacheTimer(repoHash, root),
    resetAllTimers: () => management.resetAllCacheTimers(root),
    evictRepository: repoHash => management.evictRepositoryCache(repoHash, root),
    identity: repoPath => sqlite.repositoryIdentity(repoPath),
    onWrite: listener => registry.onWrite(listener),
    setSuspended: suspended => registry.setSuspended(suspended, root),
  };
}
