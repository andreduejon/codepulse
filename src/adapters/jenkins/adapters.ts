/**
 * Jenkins' adapters for its service: the HTTP API, the SQLite cache and the token from the environment. Calls go
 * through the modules at call time, so a test's spy on one of their functions sees them.
 */
import type { JenkinsAdapters } from "../../core/jenkins/service";
import type { ProviderCacheRegistry } from "../cache/sha-sqlite-cache";
import * as api from "./api";
import { JenkinsCache } from "./cache";

export function jenkinsAdapters(cacheRoot?: string, registry?: ProviderCacheRegistry): JenkinsAdapters {
  return {
    api: {
      fetchJenkinsGraphDataForSHAs: (...args) => api.fetchJenkinsGraphDataForSHAs(...args),
      fetchJenkinsDataForSHAs: (...args) => api.fetchJenkinsDataForSHAs(...args),
      fetchJenkinsRunsForBuilds: (...args) => api.fetchJenkinsRunsForBuilds(...args),
      fetchJenkinsRunJobs: (...args) => api.fetchJenkinsRunJobs(...args),
      fetchJenkinsConsoleLog: (...args) => api.fetchJenkinsConsoleLog(...args),
    },
    cache: maxEntries => new JenkinsCache({ root: cacheRoot, maxEntries, registry }),
    token: envVar => api.getJenkinsToken(envVar),
  };
}
