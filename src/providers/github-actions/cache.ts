import { DEFAULT_PROVIDER_CACHE_LIMIT, type ProviderCacheLimit } from "../shared/auto-refresh";
import { DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../shared/sha-sqlite-cache";
import { type GitHubCacheEntry, isGitHubCacheEntry } from "./merge";

export const DEFAULT_GITHUB_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export {
  type GitHubCacheEntry,
  isGitHubCacheEntry,
  isTerminalGitHubRun,
  jobsMapFromGitHubCache,
  mergeGitHubEntry,
  mergeGitHubJobs,
  mergeGitHubRuns,
} from "./merge";

export class GitHubCache extends ShaSqliteCache<GitHubCacheEntry> {
  constructor(options: { root?: string; maxEntries?: ProviderCacheLimit } = {}) {
    super({
      provider: "github-actions",
      root: options.root ?? DEFAULT_GITHUB_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_PROVIDER_CACHE_LIMIT,
      isEntry: isGitHubCacheEntry,
      invalidMessage: "Cannot cache an invalid GitHub Actions run snapshot.",
    });
  }
}
