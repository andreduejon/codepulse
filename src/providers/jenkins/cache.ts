import { DEFAULT_PROVIDER_CACHE_LIMIT, type ProviderCacheLimit } from "../shared/auto-refresh";
import { DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../shared/sha-sqlite-cache";
import { isJenkinsCacheEntry, type JenkinsCacheEntry } from "./merge";

export const DEFAULT_JENKINS_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export {
  isJenkinsCacheEntry,
  isTerminalJenkinsRun,
  type JenkinsCacheEntry,
  jobsMapFromCache,
  mergeJenkinsJobs,
  mergeJenkinsRuns,
} from "./merge";

export class JenkinsCache extends ShaSqliteCache<JenkinsCacheEntry> {
  constructor(options: { root?: string; maxEntries?: ProviderCacheLimit } = {}) {
    super({
      provider: "jenkins",
      root: options.root ?? DEFAULT_JENKINS_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_PROVIDER_CACHE_LIMIT,
      isEntry: isJenkinsCacheEntry,
      invalidMessage: "Cannot cache an invalid Jenkins run snapshot.",
    });
  }
}
