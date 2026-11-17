import { isJenkinsCacheEntry, type JenkinsCacheEntry } from "../../core/jenkins/merge";
import { DEFAULT_PROVIDER_CACHE_LIMIT, type ProviderCacheLimit } from "../../core/provider-settings";
import { DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../cache/sha-sqlite-cache";

export const DEFAULT_JENKINS_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export {
  isJenkinsCacheEntry,
  isTerminalJenkinsRun,
  type JenkinsCacheEntry,
  jobsMapFromCache,
  mergeJenkinsJobs,
  mergeJenkinsRuns,
} from "../../core/jenkins/merge";

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
