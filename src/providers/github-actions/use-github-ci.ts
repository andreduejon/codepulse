/**
 * GitHub Actions provider — reactive data hook.
 *
 * Manages the full lifecycle of CI data for the GitHub Actions provider:
 *   - Registers the provider in the shared registry
 *   - Lazy initial fetch (triggered on first Tab switch to CI view)
 *   - Viewport-driven SHA batching: queries the top ~100 commits from
 *     state.graphRows() — covering all branches — rather than walking a
 *     single branch's history.  Works for any commit on any branch,
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
import { registerProvider, unregisterProvider } from "../../providers/provider";
import { DEFAULT_INITIAL_SHA_LIMIT, useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
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
import { collectRunningSHAs, collectTopSHAs } from "./sha-selection";
import type {
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubProviderConfig,
  GitHubWorkflowRun,
} from "./types";
import { DEFAULT_GITHUB_CONFIG } from "./types";

const INITIAL_SHA_LIMIT = DEFAULT_INITIAL_SHA_LIMIT;

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
  fetchJobLogForJob: (jobId: number, signal?: AbortSignal) => Promise<string>;
  /** Fetch CI data for one selected SHA on demand. */
  fetchCommitDataForSHA: (sha: string) => Promise<void>;
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
  createEffect(() => {
    config = { ...DEFAULT_GITHUB_CONFIG, ...configAccessor() };
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
      registerProvider({
        id: "github-actions",
        displayName: "GitHub",
        isAvailable,
      });
    } else {
      unregisterProvider("github-actions");
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

    const results = await Promise.all(batches.map(batch => fetchCIDataForSHAs(repo, token, batch, { signal })));

    if (signal?.aborted || epoch !== lifecycle.getEpoch()) return { firstError: null, failedSHAs: [] };

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
    }

    // Merge new runs into commitDataCache (additive — don't discard other SHAs)
    const newCommitData = buildCommitDataMap(allRuns);
    for (const sha of shas) {
      if (!newCommitData.has(sha) && !failedShaSet.has(sha)) {
        newCommitData.set(sha, { sha, runs: [] });
      }
    }
    for (const [sha, data] of newCommitData) {
      commitDataCache.set(sha, data);
    }
    // Bump version so getCommitData() re-runs in any reactive context
    // (e.g. detail tab open while background fetch completes).
    setCommitDataVersion(v => v + 1);

    // Rebuild from GitHub-owned cache; active view may belong to another provider.
    const cachedRuns = [...commitDataCache.values()].flatMap(data => data.runs);
    actions.setGraphBadges("github-actions", buildGraphBadges(cachedRuns));

    return { firstError, failedSHAs };
  }

  // ── Main fetch entry points ───────────────────────────────────────────

  const lifecycle = useProviderFetchLifecycle({
    state,
    providerId: "github-actions",
    shaLimit: INITIAL_SHA_LIMIT,
    identity: () => {
      const partial = configAccessor();
      return JSON.stringify({
        repoPath: state.repoPath(),
        remoteUrl: state.remoteUrl(),
        enabled: partial.enabled ?? DEFAULT_GITHUB_CONFIG.enabled,
        tokenEnvVar: partial.tokenEnvVar ?? DEFAULT_GITHUB_CONFIG.tokenEnvVar,
        trustedEnterpriseHost: partial.trustedEnterpriseHost ?? null,
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
        actions.setProviderStatus("github-actions", providerUnavailable("CI provider disabled"));
      } else if (!parsedGitHubRepo()) {
        actions.setProviderStatus("github-actions", providerUnavailable("No GitHub remote detected"));
      } else if (!repo) {
        actions.setProviderStatus(
          "github-actions",
          providerUnavailable(`Untrusted GitHub host: ${parsedGitHubRepo()?.hostname}`),
        );
      } else if (!token) {
        actions.setProviderStatus("github-actions", providerUnavailable(`Token not found: $${config.tokenEnvVar}`));
      }
    },
    runInitialFetch: async ({ signal, shas, showStatus, epoch }) => {
      const allSHAs = shas ?? collectTopSHAs(state.graphRows(), INITIAL_SHA_LIMIT);
      const unqueried = allSHAs.filter(sha => !queriedSHAs.has(sha));
      if (unqueried.length === 0) return;
      lifecycle.noteFetchStarted();
      for (const sha of unqueried) queriedSHAs.add(sha);
      if (showStatus) actions.setProviderStatus("github-actions", providerLoading());
      try {
        const { firstError, failedSHAs } = await fetchForSHAs(unqueried, signal);
        if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
        for (const sha of failedSHAs) queriedSHAs.delete(sha);
        if (!firstError) actions.setProviderLastSuccessfulRefresh("github-actions", new Date());
        if (showStatus) {
          actions.setProviderStatus(
            "github-actions",
            firstError ? providerError(`CI fetch error: ${firstError}`) : providerIdle(),
          );
        } else if (!firstError && state.providerStatusFor("github-actions").kind === "error") {
          actions.setProviderStatus("github-actions", providerIdle());
        }
      } catch (err) {
        if (signal?.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[github-actions] initial fetch failed:", err);
        if (showStatus) actions.setProviderStatus("github-actions", providerError(`CI fetch error: ${msg}`));
        for (const sha of unqueried) queriedSHAs.delete(sha);
      }
    },
    runRefresh: async ({ signal, epoch }) => {
      lifecycle.noteRefreshSettled();
      const runningSHAs = collectRunningSHAs(state.graphBadges());
      if (runningSHAs.length === 0) return;
      try {
        const { firstError } = await fetchForSHAs(runningSHAs, signal);
        if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
        if (!firstError) actions.setProviderLastSuccessfulRefresh("github-actions", new Date());
        if (!firstError && state.providerStatusFor("github-actions").kind === "error")
          actions.setProviderStatus("github-actions", providerIdle());
        if (firstError) console.error("[github-actions] refresh returned error:", firstError);
      } catch (err) {
        if (signal?.aborted) return;
        console.error("[github-actions] refresh failed:", err);
      }
    },
    onResetCaches: () => {
      commitDataCache = new Map();
      jobsCache.clear();
      queriedSHAs.clear();
      setCommitDataVersion(v => v + 1);
      actions.setGraphBadges("github-actions", new Map());
      actions.setProviderStatus("github-actions", providerIdle());
    },
  });

  async function doForceRefresh(): Promise<void> {
    lifecycle.resetCaches();
    await lifecycle.fetchInitial(undefined, undefined, true);
    if (state.activeProviderView() === "github-actions") lifecycle.startAutoRefresh();
  }

  async function fetchCommitDataForSHA(sha: string): Promise<void> {
    await lifecycle.fetchInitial(undefined, [sha], true);
  }

  // ── On-demand job fetching ────────────────────────────────────────────
  async function fetchJobsForRun(run: GitHubWorkflowRun): Promise<GitHubJobFetchResult> {
    const epoch = lifecycle.getEpoch();
    const cached = jobsCache.get(run.id);
    if (cached) return { jobs: cached, error: null };

    const repo = cachedGitHubRepo();
    const token = getGitHubToken(config.tokenEnvVar);
    if (!repo || !token) return { jobs: [], error: "GitHub provider unavailable" };

    const { jobs, error } = await fetchRunJobs(repo, token, run.id);
    if (epoch !== lifecycle.getEpoch()) return { jobs: [], error: null };
    if (error) {
      actions.setProviderStatus("github-actions", providerError(`CI jobs error: ${error}`));
      return { jobs, error };
    }
    actions.setProviderStatus("github-actions", providerIdle());
    if (run.status === "completed") {
      jobsCache.set(run.id, jobs);
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
    fetchJobLogForJob: (jobId: number, signal?: AbortSignal): Promise<string> => {
      const epoch = lifecycle.getEpoch();
      const repo = cachedGitHubRepo();
      const token = getGitHubToken(config.tokenEnvVar);
      if (!repo || !token) return Promise.resolve("");
      return fetchJobLog(repo, token, jobId, signal).then(log => (epoch === lifecycle.getEpoch() ? log : ""));
    },
    fetchCommitDataForSHA,
    refresh: doForceRefresh,
    isAvailable,
  };
}
