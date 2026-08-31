/**
 * GitHub Actions provider — reactive data hook.
 *
 * Manages the full lifecycle of CI data for the GitHub Actions provider:
 *   - Registers the provider in the shared registry
 *   - Lazy initial fetch (triggered on first Tab switch to CI view)
 *   - Viewport-driven SHA batching: queries the top fetchDepth commits
 *     from state.graphRows() — covering all branches — rather than walking
 *     a single branch's history.  Works for any commit on any branch,
 *     including ancestors of remote branches that have no origin/* ref
 *     attached directly.
 *   - Auto-refresh only re-queries SHAs with non-terminal (running/queued)
 *     status, keeping polling cheap.
 *   - Manual refresh / post-git-fetch: queries any newly-appeared SHAs that
 *     have not been queried yet (queriedSHAs dedup set).
 *   - In-memory caches: runs per SHA, jobs per run ID
 *
 * Accepts state/actions directly (not via useContext) because this hook is
 * called during AppContent setup — before the AppStateContext.Provider
 * renders in JSX (see AGENTS.md rule 5).
 */

import type { Accessor } from "solid-js";
import { createEffect, createSignal, untrack } from "solid-js";
import {
  type AppActions,
  type AppState,
  providerError,
  providerIdle,
  providerLoading,
  providerUnavailable,
} from "../../context/state";
import { BANNER, bannerOrFallback, debugError } from "../../debug/banner";

import { DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS } from "../shared/auto-refresh";
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import {
  buildCommitDataMap,
  buildGraphBadges,
  fetchCIDataForSHAs,
  fetchJobLog,
  fetchRunJobs,
  GQL_BATCH_SIZE,
  getGitHubToken,
  isTrustedGitHubHost,
  parseGitHubRemote,
} from "./api";
import { GitHubCache, isTerminalGitHubRun, jobsMapFromGitHubCache, mergeGitHubJobs, mergeGitHubRuns } from "./cache";
import { collectRunningSHAs, collectTopSHAs } from "./sha-selection";
import type {
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubProviderConfig,
  GitHubWorkflowRun,
} from "./types";
import { DEFAULT_GITHUB_CONFIG } from "./types";

export interface UseGitHubCIResult {
  /** Retrieve all runs for a given commit SHA (null if not fetched yet). */
  getCommitData: (sha: string) => GitHubCommitData | null;
  /**
   * Fetch jobs for a run on demand and cache them.
   * Returns the jobs once fetched (or from cache).
   * Resolves to an empty array on error — never throws.
   */
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJobFetchResult>;
  /**
   * Fetch the plain-text log for a specific job ID.
   * Resolves to an empty string if token or repo is unavailable.
   */
  fetchJobLogForJob: (jobId: number, run: { headSha: string; status: string }, signal?: AbortSignal) => Promise<string>;
  /** Fetch CI data for one selected SHA on demand. `force` re-queries even if already loaded. */
  fetchCommitDataForSHA: (sha: string, force?: boolean) => Promise<void>;
  /** Trigger an immediate (non-conditional) refresh of CI data. */
  refresh: () => Promise<void>;
  /** True when the provider is available (token + GitHub remote detected). */
  isAvailable: () => boolean;
}

export function useGitHubCI(opts: {
  state: AppState;
  actions: AppActions;
  /**
   * Provider config — accepts either a plain object snapshot or a reactive
   * accessor.  Pass `Accessor<Partial<GitHubProviderConfig>>` (i.e. the signal
   * without calling it) so that toggling `enabled` in the Providers menu is
   * reflected immediately without a restart.
   */
  config?: Partial<GitHubProviderConfig> | Accessor<Partial<GitHubProviderConfig>>;
  cacheRoot?: string;
}): UseGitHubCIResult {
  const { state, actions } = opts;

  // ── Reactive config ───────────────────────────────────────────────────
  // Normalise: if opts.config is a function (Accessor) use it directly;
  // if it's a plain object (or undefined) wrap it in a constant accessor so
  // the rest of the hook always reads config() uniformly.
  const configAccessor: Accessor<Partial<GitHubProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<GitHubProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<GitHubProviderConfig>>);

  // Mutable snapshot of the merged config — updated by a createEffect so
  // changes propagate reactively, but reads of `config` inside async fetch
  // functions (called from other effects) do NOT accidentally track the
  // config signal as a dependency of those effects.
  // Using a plain mutable variable rather than createMemo avoids the
  // situation where every effect that calls isAvailable() (which reads config)
  // would re-fire when config changes, causing infinite fetch loops.
  let config: GitHubProviderConfig = { ...DEFAULT_GITHUB_CONFIG, ...configAccessor() };
  let disk = new GitHubCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  createEffect(() => {
    config = { ...DEFAULT_GITHUB_CONFIG, ...configAccessor() };
    disk = new GitHubCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  });

  // ── Availability (reactive) ───────────────────────────────────────────
  // Use a signal so effects that read cachedGitHubRepo() re-run when the
  // remote URL is parsed — this lets the graphRows eager-fetch effect retry
  // as soon as the remote becomes available.
  const [parsedGitHubRepo, setParsedGitHubRepo] = createSignal(parseGitHubRemote(state.remoteUrl()));
  const [cachedGitHubRepo, setCachedGitHubRepo] = createSignal<ReturnType<typeof parseGitHubRemote>>(null);
  createEffect(() => {
    const repo = parseGitHubRemote(state.remoteUrl());
    setParsedGitHubRepo(repo);
    setCachedGitHubRepo(
      repo && isTrustedGitHubHost(repo.hostname, configAccessor().trustedEnterpriseHost ?? null) ? repo : null,
    );
  });

  const isAvailable = (): boolean => {
    if (!config.enabled) return false;
    const repo = cachedGitHubRepo();
    if (!repo) return false;
    return getGitHubToken(config.tokenEnvVar) !== null;
  };

  // ── Provider registration ─────────────────────────────────────────────
  // Reactive: register when enabled becomes true, unregister when it becomes
  // false.  An enabled-but-unavailable provider (missing token / remote) is
  // still registered so Tab cycling can reach it and show setup guidance.
  // A disabled provider is unregistered and never appears in Tab cycling.
  // Reads configAccessor() (the signal) so this effect re-fires on config
  // changes — the rest of the hook reads the plain `config` variable which
  // does NOT track as a reactive dependency.
  createEffect(() => {
    if (configAccessor().enabled === true) {
      state.providers.register({
        id: "github-actions",
        displayName: "GitHub",
        isAvailable,
      });
    } else {
      state.providers.unregister("github-actions");
      // If the user is currently in the CI view and disables the provider,
      // switch back to the git view immediately.
      if (untrack(state.activeProviderView) === "github-actions") {
        actions.setActiveProviderView("git");
      }
    }
  });

  // ── In-memory caches ──────────────────────────────────────────────────
  /** SHA → all runs for that commit */
  let commitDataCache = new Map<string, GitHubCommitData>();
  /**
   * Version counter — incremented every time commitDataCache is written.
   * Reading this signal in getCommitData() makes the detail tab reactive:
   * when data arrives after the view is already open, the tab re-renders.
   */
  const [commitDataVersion, setCommitDataVersion] = createSignal(0);
  /** runId → jobs (pre-populated from GraphQL; REST fallback for on-demand fetches) */
  const jobsCache = new Map<number, GitHubJob[]>();
  /**
   * Set of SHAs that have already been queried.
   * Used to avoid re-fetching completed runs and to detect new commits after
   * a git fetch.  Cleared on manual refresh to force a full re-query.
   */
  const queriedSHAs = new Set<string>();
  let authFrozen = false;
  /** Sticky: GHE GraphQL without WorkflowRun.jobs. Skip that field after the first retry. */
  let jobsUnsupported = false;

  function rememberAuthError(error: string | null): void {
    if (error === BANNER.github.tokenExpired) authFrozen = true;
  }

  interface FetchForShasResult {
    firstError: string | null;
    failedSHAs: string[];
  }

  // ── Core fetch function ───────────────────────────────────────────────

  /**
   * Fetch CI data for the given SHAs and merge results into caches.
   *
   * @param shas      SHAs to query — caller is responsible for dedup/filtering.
   * @param signal    Optional AbortSignal for cancellation.
   */
  async function fetchForSHAs(shas: string[], signal?: AbortSignal): Promise<FetchForShasResult> {
    const epoch = lifecycle.getEpoch();
    if (shas.length === 0) return { firstError: null, failedSHAs: [] };
    const repo = cachedGitHubRepo();
    const token = getGitHubToken(config.tokenEnvVar);
    if (!repo || !token) return { firstError: null, failedSHAs: [] };

    // Split into batches of GQL_BATCH_SIZE and fire in parallel
    const batches: string[][] = [];
    for (let i = 0; i < shas.length; i += GQL_BATCH_SIZE) {
      batches.push(shas.slice(i, i + GQL_BATCH_SIZE));
    }

    const results = await Promise.all(
      batches.map(batch => fetchCIDataForSHAs(repo, token, batch, { signal, includeJobs: !jobsUnsupported })),
    );

    if (signal?.aborted || epoch !== lifecycle.getEpoch()) return { firstError: null, failedSHAs: [] };

    if (results.some(result => result.jobsUnsupported)) jobsUnsupported = true;
    const firstError = results.find(r => r.error)?.error ?? null;
    const failedSHAs: string[] = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].error) failedSHAs.push(...batches[i]);
    }
    const failedShaSet = new Set(failedSHAs);

    // Merge all batch results (include successful batches even if others errored)
    const allRuns: GitHubWorkflowRun[] = [];
    for (const result of results) {
      allRuns.push(...result.data);
      for (const [runId, jobs] of result.jobs) {
        if (jobs.length > 0) jobsCache.set(runId, jobs);
      }
    }

    const newCommitData = buildCommitDataMap(allRuns);
    for (const sha of shas) {
      if (failedShaSet.has(sha)) continue;
      const incoming = newCommitData.get(sha)?.runs ?? [];
      const existing = commitDataCache.get(sha)?.runs ?? [];
      commitDataCache.set(sha, { sha, runs: mergeGitHubRuns(existing, incoming) });
    }
    setCommitDataVersion(v => v + 1);

    const cachedRuns = [...commitDataCache.values()].flatMap(data => data.runs);
    actions.setGraphBadges("github-actions", buildGraphBadges(cachedRuns));
    await persistTerminalRuns(state.repoPath(), shas);

    return { firstError, failedSHAs };
  }

  async function hydrateCachedCandidates(repoPath: string, shas: readonly string[]): Promise<void> {
    const pending = shas.filter(sha => !commitDataCache.has(sha));
    const entries = await Promise.all(pending.map(async sha => ({ sha, entry: await disk.read(repoPath, sha) })));
    let changed = false;
    for (const { sha, entry } of entries) {
      if (!entry) continue;
      commitDataCache.set(sha, { sha, runs: entry.runs });
      for (const [id, jobs] of Object.entries(entry.jobs ?? {})) {
        const runId = Number(id);
        if (!Number.isNaN(runId) && !jobsCache.has(runId)) jobsCache.set(runId, jobs);
      }
      changed = true;
    }
    if (!changed) return;
    setCommitDataVersion(v => v + 1);
    const cachedRuns = [...commitDataCache.values()].flatMap(data => data.runs);
    actions.setGraphBadges("github-actions", buildGraphBadges(cachedRuns));
  }

  async function persistTerminalRuns(repoPath: string, shas: readonly string[]): Promise<void> {
    const writes = await Promise.all(
      shas.map(async sha => {
        const incoming = (commitDataCache.get(sha)?.runs ?? []).filter(isTerminalGitHubRun);
        if (incoming.length === 0) return false;
        const existing = await disk.read(repoPath, sha);
        await disk.write(
          repoPath,
          {
            sha,
            runs: mergeGitHubRuns(existing?.runs ?? [], incoming),
            jobs: mergeGitHubJobs(
              existing?.jobs,
              jobsMapFromGitHubCache(
                jobsCache,
                incoming.map(run => run.id),
              ),
            ),
          },
          { evict: false },
        );
        return true;
      }),
    );
    if (writes.some(Boolean)) await disk.evictForRepo(repoPath);
  }

  // ── Main fetch entry points ───────────────────────────────────────────

  const lifecycle = useProviderFetchLifecycle({
    state,
    providerId: "github-actions",
    shaLimit: () => configAccessor().fetchDepth ?? DEFAULT_GITHUB_CONFIG.fetchDepth,
    refreshInterval: () => (configAccessor().autoRefreshSeconds ?? DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS) * 1000,
    identity: () => {
      const partial = configAccessor();
      return JSON.stringify({
        repoPath: state.repoPath(),
        remoteUrl: state.remoteUrl(),
        enabled: partial.enabled ?? DEFAULT_GITHUB_CONFIG.enabled,
        tokenEnvVar: partial.tokenEnvVar ?? DEFAULT_GITHUB_CONFIG.tokenEnvVar,
        trustedEnterpriseHost: partial.trustedEnterpriseHost ?? null,
        fetchDepth: partial.fetchDepth ?? DEFAULT_GITHUB_CONFIG.fetchDepth,
        cacheLimit: partial.cacheLimit ?? DEFAULT_GITHUB_CONFIG.cacheLimit,
      });
    },
    isAvailable,
    isBackgroundReady: () => cachedGitHubRepo() !== null,
    queriedSHAs,
    reportUnavailable: showStatus => {
      if (!showStatus) return;
      const repo = cachedGitHubRepo();
      const token = getGitHubToken(config.tokenEnvVar);
      if (!config.enabled) {
        actions.setProviderStatus("github-actions", providerUnavailable(BANNER.github.disabled));
      } else if (!parsedGitHubRepo()) {
        actions.setProviderStatus("github-actions", providerUnavailable(BANNER.github.noRemote));
      } else if (!repo) {
        const host = parsedGitHubRepo()?.hostname;
        if (host) debugError("GitHub", `Untrusted host: ${host}`);
        actions.setProviderStatus("github-actions", providerUnavailable(BANNER.github.untrustedHost));
      } else if (!token) {
        actions.setProviderStatus(
          "github-actions",
          providerUnavailable(BANNER.github.missingToken(config.tokenEnvVar)),
        );
      }
    },
    runInitialFetch: async ({ signal, shas, showStatus, epoch }) => {
      if (authFrozen && !showStatus) return;
      if (showStatus) authFrozen = false;
      const allSHAs = shas ?? collectTopSHAs(state.graphRows(), config.fetchDepth);
      await hydrateCachedCandidates(state.repoPath(), allSHAs);
      if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
      const unqueried = allSHAs.filter(sha => !queriedSHAs.has(sha));
      if (unqueried.length === 0) {
        lifecycle.noteFetchStarted();
        return;
      }
      lifecycle.noteFetchStarted();
      for (const sha of unqueried) queriedSHAs.add(sha);
      if (showStatus) actions.setProviderStatus("github-actions", providerLoading());
      try {
        const { firstError, failedSHAs } = await fetchForSHAs(unqueried, signal);
        if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
        for (const sha of failedSHAs) queriedSHAs.delete(sha);
        rememberAuthError(firstError);
        lifecycle.noteFetchResult(!firstError);
        if (!firstError) actions.setProviderLastSuccessfulRefresh("github-actions", new Date());
        if (firstError === BANNER.github.tokenExpired || showStatus) {
          actions.setProviderStatus("github-actions", firstError ? providerError(firstError) : providerIdle());
        } else if (!firstError && state.providerStatusFor("github-actions").kind === "error") {
          actions.setProviderStatus("github-actions", providerIdle());
        }
      } catch (err) {
        if (signal?.aborted) return;
        const message = bannerOrFallback(err, BANNER.github.fetchFailed, "GitHub");
        rememberAuthError(message);
        lifecycle.noteFetchResult(false);
        if (showStatus || message === BANNER.github.tokenExpired)
          actions.setProviderStatus("github-actions", providerError(message));
        for (const sha of unqueried) queriedSHAs.delete(sha);
      }
    },
    runRefresh: async ({ signal, epoch, showStatus }) => {
      if (authFrozen && !showStatus) return;
      if (showStatus) authFrozen = false;
      lifecycle.noteRefreshSettled();
      const runningSHAs = collectRunningSHAs(state.graphBadges());
      if (runningSHAs.length === 0) return;
      try {
        const { firstError } = await fetchForSHAs(runningSHAs, signal);
        if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
        rememberAuthError(firstError);
        lifecycle.noteFetchResult(!firstError);
        if (!firstError) actions.setProviderLastSuccessfulRefresh("github-actions", new Date());
        if (firstError === BANNER.github.tokenExpired)
          actions.setProviderStatus("github-actions", providerError(firstError));
        else if (!firstError && state.providerStatusFor("github-actions").kind === "error")
          actions.setProviderStatus("github-actions", providerIdle());
        if (firstError) debugError("GitHub", firstError);
      } catch (err) {
        if (signal?.aborted) return;
        lifecycle.noteFetchResult(false);
        debugError("GitHub", err);
      }
    },
    onResetCaches: () => {
      commitDataCache = new Map();
      jobsCache.clear();
      queriedSHAs.clear();
      authFrozen = false;
      jobsUnsupported = false;
      setCommitDataVersion(v => v + 1);
      actions.setGraphBadges("github-actions", new Map());
      actions.setProviderStatus("github-actions", providerIdle());
    },
  });

  async function refreshWindow(): Promise<void> {
    const window = collectTopSHAs(state.graphRows(), config.fetchDepth);
    for (const sha of window) queriedSHAs.delete(sha);
    await lifecycle.fetchInitial(undefined, window, true);
    if (state.activeProviderView() === "github-actions") lifecycle.startAutoRefresh();
  }

  async function fetchCommitDataForSHA(sha: string, force = false): Promise<void> {
    await hydrateCachedCandidates(state.repoPath(), [sha]);
    if (!force) return;
    queriedSHAs.delete(sha);
    await lifecycle.fetchInitial(undefined, [sha], true);
  }

  // ── On-demand job fetching ────────────────────────────────────────────
  async function fetchJobsForRun(run: GitHubWorkflowRun): Promise<GitHubJobFetchResult> {
    const epoch = lifecycle.getEpoch();
    const cached = jobsCache.get(run.id);
    if (cached) return { jobs: cached, error: null };

    const repo = cachedGitHubRepo();
    const token = getGitHubToken(config.tokenEnvVar);
    if (!repo || !token) return { jobs: [], error: BANNER.github.unavailable };

    const { jobs, error } = await fetchRunJobs(repo, token, run.id);
    if (epoch !== lifecycle.getEpoch()) return { jobs: [], error: null };
    if (error) {
      actions.setProviderStatus("github-actions", providerError(error));
      return { jobs, error };
    }
    actions.setProviderStatus("github-actions", providerIdle());
    if (run.status === "completed") {
      jobsCache.set(run.id, jobs);
      await persistTerminalRuns(state.repoPath(), [run.headSha]);
    }
    return { jobs, error: null };
  }

  // ── Public API ────────────────────────────────────────────────────────
  return {
    getCommitData: (sha: string) => {
      // Reading commitDataVersion() subscribes this call to cache updates,
      // so any reactive context (e.g. detail tab JSX) re-runs when new data
      // arrives — including when the background fetch completes while the
      // view is already open.
      commitDataVersion();
      return commitDataCache.get(sha) ?? null;
    },
    fetchJobsForRun,
    fetchJobLogForJob: async (jobId, run, signal) => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      const key = String(jobId);
      if (isTerminalGitHubRun(run)) {
        const diskLog = await disk.readLog(repoPath, run.headSha, key).catch(() => null);
        if (diskLog) return diskLog;
      }
      const repo = cachedGitHubRepo();
      const token = getGitHubToken(config.tokenEnvVar);
      if (!repo || !token) return "";
      const log = await fetchJobLog(repo, token, jobId, signal);
      if (epoch !== lifecycle.getEpoch()) return "";
      if (isTerminalGitHubRun(run) && log) await disk.writeLog(repoPath, run.headSha, key, log).catch(() => {});
      return log;
    },
    fetchCommitDataForSHA,
    refresh: refreshWindow,
    isAvailable,
  };
}
