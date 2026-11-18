import type { OpenShiftCacheLimit } from "../../core/openshift/types";
import { type CacheLocation, DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../cache/sha-sqlite-cache";

export const DEFAULT_OPENSHIFT_CACHE_LIMIT: OpenShiftCacheLimit = 20;
export const DEFAULT_OPENSHIFT_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export {
  cachedBuildToResource,
  isOpenShiftCacheEntry,
  mergeById,
  type OpenShiftCachedBuild,
  type OpenShiftCacheEntry,
  type OpenShiftCacheOptions,
  toCachedBuild,
} from "../../core/openshift/merge";

import { openShiftProvider } from "../../core/openshift/definition";
import {
  isOpenShiftCacheEntry,
  type OpenShiftCacheEntry,
  type OpenShiftCacheOptions,
} from "../../core/openshift/merge";

export class OpenShiftCache extends ShaSqliteCache<OpenShiftCacheEntry> {
  constructor(options: OpenShiftCacheOptions & CacheLocation = {}) {
    super({
      // Its rows are its provider's: the cache screen and evictions group them by its id.
      provider: openShiftProvider.id,
      root: options.root ?? DEFAULT_OPENSHIFT_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_OPENSHIFT_CACHE_LIMIT,
      isEntry: isOpenShiftCacheEntry,
      invalidMessage: "Cannot cache an invalid OpenShift build snapshot.",
      registry: options.registry,
    });
  }

  override readLog(repoPath: string, sha: string, namespace: string, buildName?: string): Promise<string | null> {
    return super.readLog(repoPath, sha, buildName === undefined ? namespace : `${namespace}_${buildName}`);
  }

  override writeLog(
    repoPath: string,
    sha: string,
    namespace: string,
    buildNameOrLog: string,
    log?: string,
  ): Promise<void> {
    return super.writeLog(
      repoPath,
      sha,
      log === undefined ? namespace : `${namespace}_${buildNameOrLog}`,
      log ?? buildNameOrLog,
    );
  }
}
