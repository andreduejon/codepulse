import { isJenkinsCacheEntry, type JenkinsCacheEntry } from "../../core/jenkins/merge";
import { DEFAULT_PROVIDER_CACHE_LIMIT, type ProviderCacheLimit } from "../../core/provider-settings";
import { type CacheLocation, DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../cache/sha-sqlite-cache";

export const DEFAULT_JENKINS_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export {
  isJenkinsCacheEntry,
  isTerminalJenkinsRun,
  type JenkinsCacheEntry,
  jobsMapFromCache,
  mergeJenkinsJobs,
  mergeJenkinsRuns,
} from "../../core/jenkins/merge";

import { jenkinsProvider } from "../../core/jenkins/definition";

export class JenkinsCache extends ShaSqliteCache<JenkinsCacheEntry> {
  constructor(options: CacheLocation & { maxEntries?: ProviderCacheLimit } = {}) {
    super({
      // Its rows are its provider's: the cache screen and evictions group them by its id.
      provider: jenkinsProvider.id,
      root: options.root ?? DEFAULT_JENKINS_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_PROVIDER_CACHE_LIMIT,
      isEntry: isJenkinsCacheEntry,
      invalidMessage: "Cannot cache an invalid Jenkins run snapshot.",
      registry: options.registry,
    });
  }
}
