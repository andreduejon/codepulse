import { BANNER } from "../../debug/banner";
import { type CacheSyncResult, SYNC_OK, syncFailed } from "../shared/cache-sync";
import { persistMergedSnapshots } from "../shared/sha-sqlite-cache";
import { fetchJenkinsGraphDataForSHAs, getJenkinsToken } from "./api";
import { isTerminalJenkinsRun, JenkinsCache, mergeJenkinsRuns } from "./cache";
import type { JenkinsProviderConfig } from "./types";

/**
 * Reads an app's configured Jenkins jobs for its commits, the jobs of `branches` first, and writes the finished
 * builds into its cache: what the Jenkins view does for the app when it is open. Stages read before are kept.
 */
export async function syncJenkinsCache(opts: {
  app: string;
  config: JenkinsProviderConfig;
  shas: readonly string[];
  /** The branches whose jobs are read first when a multibranch project has more than are read. */
  branches: readonly string[];
  cacheRoot?: string;
  signal?: AbortSignal;
}): Promise<CacheSyncResult> {
  const { config, signal } = opts;
  const token = getJenkinsToken(config.tokenEnvVar);
  if (!token || config.jobs.length === 0 || opts.shas.length === 0) return SYNC_OK;
  const result = await fetchJenkinsGraphDataForSHAs(config.jobs, config.username, token, [...opts.shas], {
    signal,
    buildLimit: config.fetchDepth,
    preferredBranches: new Set(opts.branches),
  });
  if (signal?.aborted) return SYNC_OK;
  await persistMergedSnapshots(
    new JenkinsCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit }),
    opts.app,
    opts.shas,
    () => !signal?.aborted,
    sha => result.data.filter(run => isTerminalJenkinsRun(run) && run.headSha.toLowerCase() === sha.toLowerCase()),
    (sha, existing, incoming) => ({
      sha,
      runs: mergeJenkinsRuns(existing?.runs ?? [], incoming),
      ...(existing?.jobs ? { jobs: existing.jobs } : {}),
    }),
  );
  return result.error ? syncFailed(result.error, BANNER.jenkins.tokenExpired) : SYNC_OK;
}
