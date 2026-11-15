import { BANNER } from "../../debug/banner";
import { type CacheSyncResult, SYNC_OK, syncFailed } from "../shared/cache-sync";
import { persistMergedSnapshots } from "../shared/sha-sqlite-cache";
import { fetchCIDataForSHAs, GQL_BATCH_SIZE, getGitHubToken, isTrustedGitHubHost, parseGitHubRemote } from "./api";
import { GitHubCache, isTerminalGitHubRun, mergeGitHubEntry } from "./cache";
import type { GitHubJob, GitHubProviderConfig, GitHubWorkflowRun } from "./types";

/**
 * Asks GitHub about an app's commits and writes their finished runs, with the jobs read alongside, into its cache:
 * what the GitHub Actions view does for the app when it is open.
 */
export async function syncGitHubCache(opts: {
  app: string;
  config: GitHubProviderConfig;
  remoteUrl: string;
  shas: readonly string[];
  cacheRoot?: string;
  signal?: AbortSignal;
}): Promise<CacheSyncResult> {
  const { config, signal } = opts;
  const repo = parseGitHubRemote(opts.remoteUrl);
  const token = getGitHubToken(config.tokenEnvVar);
  if (!repo || !isTrustedGitHubHost(repo.hostname, config.trustedEnterpriseHost) || !token || opts.shas.length === 0)
    return SYNC_OK;
  const batches: string[][] = [];
  for (let i = 0; i < opts.shas.length; i += GQL_BATCH_SIZE) batches.push(opts.shas.slice(i, i + GQL_BATCH_SIZE));
  const results = await Promise.all(batches.map(batch => fetchCIDataForSHAs(repo, token, batch, { signal })));
  if (signal?.aborted) return SYNC_OK;
  const runs: GitHubWorkflowRun[] = results.flatMap(result => result.data);
  const jobs = new Map<number, GitHubJob[]>();
  for (const result of results) for (const [id, list] of result.jobs) if (list.length > 0) jobs.set(id, list);
  await persistMergedSnapshots(
    new GitHubCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit }),
    opts.app,
    opts.shas,
    () => !signal?.aborted,
    sha => runs.filter(run => isTerminalGitHubRun(run) && run.headSha.toLowerCase() === sha.toLowerCase()),
    (sha, existing, incoming) => mergeGitHubEntry(sha, existing, incoming, jobs),
  );
  const error = results.find(result => result.error)?.error ?? null;
  return error ? syncFailed(error, BANNER.github.tokenExpired) : SYNC_OK;
}
