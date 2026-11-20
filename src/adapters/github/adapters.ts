/**
 * GitHub's adapters for its service: the HTTP API, the SQLite cache and the token from the environment. Calls go
 * through the modules at call time, so a test's spy on one of their functions sees them.
 */
import type { GitHubAdapters } from "../../core/github/service";
import type { ProviderCacheRegistry } from "../cache/sha-sqlite-cache";
import * as api from "./api";
import { GitHubCache } from "./cache";

export function githubAdapters(cacheRoot?: string, registry?: ProviderCacheRegistry): GitHubAdapters {
  return {
    api: {
      fetchCIDataForSHAs: (...args) => api.fetchCIDataForSHAs(...args),
      fetchRunJobs: (...args) => api.fetchRunJobs(...args),
      fetchJobAnnotations: (...args) => api.fetchJobAnnotations(...args),
      fetchJobLog: (...args) => api.fetchJobLog(...args),
      fetchOpenPullRequests: (...args) => api.fetchOpenPullRequests(...args),
      fetchClosedPullRequests: (...args) => api.fetchClosedPullRequests(...args),
    },
    cache: maxEntries => new GitHubCache({ root: cacheRoot, maxEntries, registry }),
    token: envVar => api.getGitHubToken(envVar),
  };
}
