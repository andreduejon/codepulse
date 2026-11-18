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
    summary: () => management.getProviderCacheSummary(root, registry),
    resetTimer: repoHash => management.resetRepositoryCacheTimer(repoHash, root, undefined, registry),
    resetAllTimers: () => management.resetAllCacheTimers(root, undefined, registry),
    evictRepository: repoHash => management.evictRepositoryCache(repoHash, root, registry),
    identity: repoPath => sqlite.repositoryIdentity(repoPath),
    onWrite: listener => registry.onWrite(listener),
    setSuspended: suspended => registry.setSuspended(suspended, root),
  };
}
