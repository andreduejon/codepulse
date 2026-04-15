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

import { createEffect, onCleanup } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { registerProvider } from "../../providers/provider";
import {
  buildCommitDataMap,
  buildGraphBadges,
  fetchCIDataForSHAs,
  fetchRunJobs,
  GQL_BATCH_SIZE,
  getGitHubToken,
  parseGitHubRemote,
} from "./api";
import type { GitHubCommitData, GitHubJob, GitHubProviderConfig, GitHubRunDetail, GitHubWorkflowRun } from "./types";
import { DEFAULT_GITHUB_CONFIG } from "./types";

/** Number of rows taken from the top of graphRows() for the initial fetch. */
const INITIAL_SHA_LIMIT = 100;

export interface UseGitHubCIResult {
  /** Retrieve all runs for a given commit SHA (null if not fetched yet). */
  getCommitData: (sha: string) => GitHubCommitData | null;
  /**
   * Fetch jobs for a run on demand and cache them.
   * Returns the jobs once fetched (or from cache).
   * Resolves to an empty array on error — never throws.
   */
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJob[]>;
  /** Trigger an immediate (non-conditional) refresh of CI data. */
  refresh: () => Promise<void>;
  /** True when the provider is available (token + GitHub remote detected). */
  isAvailable: () => boolean;
}

export function useGitHubCI(opts: {
  state: AppState;
  actions: AppActions;
  config?: Partial<GitHubProviderConfig>;
}): UseGitHubCIResult {
  const config: GitHubProviderConfig = { ...DEFAULT_GITHUB_CONFIG, ...opts.config };
  const { state, actions } = opts;

  // ── Availability (reactive) ───────────────────────────────────────────
  let cachedGitHubRepo = parseGitHubRemote(state.remoteUrl());
  createEffect(() => {
    cachedGitHubRepo = parseGitHubRemote(state.remoteUrl());
  });

  const isAvailable = (): boolean => {
    if (!config.enabled) return false;
    if (!cachedGitHubRepo) return false;
    return getGitHubToken(config.tokenEnvVar) !== null;
  };

  // ── Provider registration ─────────────────────────────────────────────
  registerProvider({
    id: "github-actions",
    displayName: "github",
    isAvailable,
  });

  // ── In-memory caches ──────────────────────────────────────────────────
  /** SHA → all runs for that commit */
  let commitDataCache = new Map<string, GitHubCommitData>();
  /** runId → jobs (pre-populated from GraphQL; REST fallback for on-demand fetches) */
  const jobsCache = new Map<number, GitHubJob[]>();
  /**
   * Set of SHAs that have already been queried.
   * Used to avoid re-fetching completed runs and to detect new commits after
   * a git fetch.  Cleared on manual refresh to force a full re-query.
   */
  const queriedSHAs = new Set<string>();
  /** Guard: is a fetch already in-flight? */
  let fetchInFlight = false;

  // ── SHA collection helpers ────────────────────────────────────────────

  /**
   * Collect up to `limit` commit SHAs from the top of graphRows.
   *
   * No remote-ref filter is applied: ancestor commits of a remote branch do
   * not have an `origin/*` ref attached directly, yet GitHub does have CI data
   * for them.  GitHub returns empty `checkSuites.nodes: []` for commits with
   * no CI runs (not an error), so querying local-only commits is harmless.
   */
  function collectTopSHAs(limit: number): string[] {
    const rows = state.graphRows();
    const shas: string[] = [];
    for (let i = 0; i < rows.length && shas.length < limit; i++) {
      shas.push(rows[i].commit.hash);
    }
    return shas;
  }

  /**
   * Returns SHAs that have `running` or `queued` badge status.
   * Used for cheap auto-refresh polling — only re-query in-flight commits.
   */
  function collectRunningSHAs(): string[] {
    const badges = state.graphBadges();
    const running: string[] = [];
    for (const [sha, badge] of badges) {
      if (badge.badge === "running") running.push(sha);
    }
    return running;
  }

  // ── Core fetch function ───────────────────────────────────────────────

  /**
   * Fetch CI data for the given SHAs and merge results into caches.
   *
   * @param shas      SHAs to query — caller is responsible for dedup/filtering.
   * @param signal    Optional AbortSignal for cancellation.
   */
  async function fetchForSHAs(shas: string[], signal?: AbortSignal): Promise<void> {
    if (shas.length === 0) return;
    const repo = cachedGitHubRepo;
    const token = getGitHubToken(config.tokenEnvVar);
    if (!repo || !token) return;

    // Split into batches of GQL_BATCH_SIZE and fire in parallel
    const batches: string[][] = [];
    for (let i = 0; i < shas.length; i += GQL_BATCH_SIZE) {
      batches.push(shas.slice(i, i + GQL_BATCH_SIZE));
    }

    const results = await Promise.all(batches.map(batch => fetchCIDataForSHAs(repo, token, batch, { signal })));

    if (signal?.aborted) return;

    // Surface first error encountered across batches (if any)
    const firstError = results.find(r => r.error)?.error ?? null;
    if (firstError) {
      actions.setProviderStatus(firstError);
    }

    // Merge all batch results (include successful batches even if others errored)
    const allRuns: GitHubWorkflowRun[] = [];
    for (const result of results) {
      allRuns.push(...result.runs);
    }

    // Merge new runs into commitDataCache (additive — don't discard other SHAs)
    const newCommitData = buildCommitDataMap(allRuns);
    for (const [sha, data] of newCommitData) {
      commitDataCache.set(sha, data);
    }

    // Merge new badges into graphBadges (additive)
    const newBadges = buildGraphBadges(allRuns);
    const currentBadges = new Map(state.graphBadges());
    for (const [sha, badge] of newBadges) {
      currentBadges.set(sha, badge);
    }
    actions.setGraphBadges(currentBadges);
  }

  // ── Main fetch entry points ───────────────────────────────────────────

  /**
   * Initial / catch-up fetch: query the top INITIAL_SHA_LIMIT SHAs from
   * graphRows that haven't been queried yet.
   *
   * Pass `shas` when the caller has already computed the unqueried list to
   * avoid a redundant collectTopSHAs() call.
   */
  async function doInitialFetch(signal?: AbortSignal, shas?: string[]): Promise<void> {
    if (fetchInFlight) return;
    if (!isAvailable()) {
      const repo = cachedGitHubRepo;
      const token = getGitHubToken(config.tokenEnvVar);
      if (!config.enabled) {
        actions.setProviderStatus("CI provider disabled");
      } else if (!repo) {
        actions.setProviderStatus("No GitHub remote detected");
      } else if (!token) {
        actions.setProviderStatus(`Token not found: $${config.tokenEnvVar}`);
      }
      return;
    }

    const allSHAs = shas ?? collectTopSHAs(INITIAL_SHA_LIMIT);
    const unqueried = allSHAs.filter(sha => !queriedSHAs.has(sha));
    if (unqueried.length === 0) return;

    // Mark as queried before the async call so concurrent triggers don't
    // duplicate the request.
    for (const sha of unqueried) queriedSHAs.add(sha);

    fetchInFlight = true;
    actions.setProviderStatus("loading");
    try {
      await fetchForSHAs(unqueried, signal);
      actions.setProviderStatus(null);
    } catch (err) {
      if (signal?.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[github-actions] initial fetch failed:", err);
      actions.setProviderStatus(`CI fetch error: ${msg}`);
      // On error, un-mark so a future retry can re-query these SHAs
      for (const sha of unqueried) queriedSHAs.delete(sha);
    } finally {
      fetchInFlight = false;
    }
  }

  /**
   * Auto-refresh: only re-query SHAs with running/queued badge status.
   * Cheap — typically 0-5 SHAs, one small GraphQL request.
   */
  async function doRefreshRunning(signal?: AbortSignal): Promise<void> {
    if (fetchInFlight) return;
    if (!isAvailable()) return;

    const runningSHAs = collectRunningSHAs();
    if (runningSHAs.length === 0) return;

    fetchInFlight = true;
    try {
      await fetchForSHAs(runningSHAs, signal);
    } catch (err) {
      if (signal?.aborted) return;
      console.error("[github-actions] refresh failed:", err);
    } finally {
      fetchInFlight = false;
    }
  }

  /**
   * Manual / forced full refresh: clears queriedSHAs and re-queries the top
   * INITIAL_SHA_LIMIT rows.  Called when the user presses `f` or `:reload`.
   */
  async function doForceRefresh(): Promise<void> {
    queriedSHAs.clear();
    commitDataCache = new Map();
    actions.setGraphBadges(new Map());
    actions.setProviderStatus(null);
    await doInitialFetch();
  }

  // ── Lazy initial fetch + auto-refresh while in CI view ───────────────
  let hasFetchedOnce = false;
  let lastFetchedAt = 0;
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let fetchAbortCtrl: AbortController | null = null;

  function startAutoRefresh(): void {
    if (autoRefreshTimer) return;
    const interval = state.autoRefreshInterval();
    if (interval <= 0) return;

    autoRefreshTimer = setInterval(() => {
      if (state.activeProviderView() !== "github-actions") return;
      if (fetchAbortCtrl) fetchAbortCtrl.abort();
      const ctrl = new AbortController();
      fetchAbortCtrl = ctrl;
      doRefreshRunning(ctrl.signal);
      lastFetchedAt = Date.now();
    }, interval);
  }

  function stopAutoRefresh(): void {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (fetchAbortCtrl) {
      fetchAbortCtrl.abort();
      fetchAbortCtrl = null;
    }
  }

  // React to provider view changes:
  //  - Switch TO github-actions → do initial fetch; start refresh timer
  //  - Switch AWAY from github-actions → stop refresh timer
  createEffect(() => {
    const view = state.activeProviderView();
    if (view === "github-actions") {
      if (!hasFetchedOnce) {
        hasFetchedOnce = true;
        const ctrl = new AbortController();
        fetchAbortCtrl = ctrl;
        doInitialFetch(ctrl.signal);
        lastFetchedAt = Date.now();
      } else {
        // Re-check for new unqueried SHAs (e.g. after a git fetch loaded more commits)
        // and catch-up if data is stale
        const interval = state.autoRefreshInterval();
        const staleThreshold = interval > 0 ? interval : 30_000;
        if (Date.now() - lastFetchedAt > staleThreshold) {
          const ctrl = new AbortController();
          fetchAbortCtrl = ctrl;
          doInitialFetch(ctrl.signal);
          lastFetchedAt = Date.now();
        }
      }
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Restart the auto-refresh timer if the interval setting changes
  createEffect(() => {
    const _interval = state.autoRefreshInterval();
    if (state.activeProviderView() === "github-actions") {
      stopAutoRefresh();
      startAutoRefresh();
    }
  });

  // When graphRows changes (new commits loaded after git fetch), query any
  // newly-appeared SHAs that are in the top INITIAL_SHA_LIMIT and not yet queried.
  createEffect(() => {
    // Track graphRows reactively so this effect fires when new commits load
    const rows = state.graphRows();
    if (rows.length === 0) return;
    if (state.activeProviderView() !== "github-actions") return;

    const allSHAs = collectTopSHAs(INITIAL_SHA_LIMIT);
    const newSHAs = allSHAs.filter(sha => !queriedSHAs.has(sha));
    if (newSHAs.length === 0) return;

    const ctrl = new AbortController();
    fetchAbortCtrl = ctrl;
    // Pass newSHAs directly to avoid a redundant collectTopSHAs() call inside doInitialFetch
    doInitialFetch(ctrl.signal, allSHAs);
  });

  onCleanup(() => {
    stopAutoRefresh();
  });

  // ── On-demand job fetching ────────────────────────────────────────────
  async function fetchJobsForRun(run: GitHubWorkflowRun): Promise<GitHubJob[]> {
    const cached = jobsCache.get(run.id);
    if (cached) return cached;

    const repo = cachedGitHubRepo;
    const token = getGitHubToken(config.tokenEnvVar);
    if (!repo || !token) return [];

    const jobs = await fetchRunJobs(repo, token, run.id);
    if (run.status === "completed") {
      jobsCache.set(run.id, jobs);
    }
    return jobs;
  }

  // ── Public API ────────────────────────────────────────────────────────
  return {
    getCommitData: (sha: string) => commitDataCache.get(sha) ?? null,
    fetchJobsForRun,
    refresh: doForceRefresh,
    isAvailable,
  };
}

/** Re-export detail type for consumers that don't need to import from types.ts directly. */
export type { GitHubRunDetail };
