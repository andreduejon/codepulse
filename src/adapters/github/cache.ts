import { type GitHubCacheEntry, isGitHubCacheEntry } from "../../core/github/merge";
import { DEFAULT_PROVIDER_CACHE_LIMIT, type ProviderCacheLimit } from "../../core/provider-settings";
import { DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../cache/sha-sqlite-cache";

export const DEFAULT_GITHUB_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

export {
  type GitHubCacheEntry,
  isGitHubCacheEntry,
  isTerminalGitHubRun,
  jobsMapFromGitHubCache,
  mergeGitHubEntry,
  mergeGitHubJobs,
  mergeGitHubRuns,
} from "../../core/github/merge";

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
