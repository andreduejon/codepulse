/**
 * GitHub Actions provider — reactive data hook.
 *
 * Manages the full lifecycle of CI data for the GitHub Actions provider:
 *   - Registers the provider in the shared registry
 *   - Lazy initial fetch (triggered on first Tab switch to CI view)
 *   - Auto-refresh only while the CI provider view is active
 *   - ETag-based conditional requests (304 = no data transfer)
 *   - On-demand job/step fetching when a run is expanded in the detail panel
 *   - In-memory caches: runs per SHA, jobs per run ID
 *
 * Accepts state/actions directly (not via useContext) because this hook is
 * called during AppContent setup — before the AppStateContext.Provider
 * renders in JSX (see AGENTS.md rule 5).
 */

import { createEffect, onCleanup } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import type { GraphBadge } from "../../providers/provider";
import { registerProvider } from "../../providers/provider";
import {
  buildCommitDataMap,
  buildGraphBadges,
  fetchRunJobs,
  fetchWorkflowRuns,
  getGitHubToken,
  parseGitHubRemote,
} from "./api";
import type { GitHubCommitData, GitHubJob, GitHubProviderConfig, GitHubRunDetail, GitHubWorkflowRun } from "./types";
import { DEFAULT_GITHUB_CONFIG } from "./types";

export interface UseGitHubCIResult {
  /** Retrieve all runs for a given commit SHA (null if not fetched yet). */
  getCommitData: (sha: string) => GitHubCommitData | null;
  /** Retrieve cached jobs for a run.  null = not yet fetched. */
  getCachedJobs: (runId: number) => GitHubJob[] | null;
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
  // Compute once per remoteUrl change; parseGitHubRemote is pure
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
    displayName: "GitHub Actions",
    isAvailable,
  });

  // ── In-memory caches ──────────────────────────────────────────────────
  /** SHA → all runs for that commit */
  let commitDataCache = new Map<string, GitHubCommitData>();
  /** runId → jobs (fetched on demand; permanent for completed runs) */
  const jobsCache = new Map<number, GitHubJob[]>();
  /** ETag from last successful fetchWorkflowRuns response */
  let lastEtag: string | null = null;
  /** Timestamp of last successful fetch (ms) */
  let lastFetchedAt = 0;
  /** Guard: is a fetch already in-flight? */
  let fetchInFlight = false;

  // ── Core fetch function ───────────────────────────────────────────────
  async function doFetch(forceRefresh = false, signal?: AbortSignal): Promise<void> {
    if (fetchInFlight) return;
    if (!isAvailable()) return;

    const repo = cachedGitHubRepo;
    const token = getGitHubToken(config.tokenEnvVar);
    if (!repo || !token) return;

    fetchInFlight = true;
    try {
      const etag = forceRefresh ? null : lastEtag;
      const result = await fetchWorkflowRuns(repo, token, { etag, signal });

      if (signal?.aborted) return;

      if (!result.changed) {
        // 304 Not Modified — nothing to update
        return;
      }

      lastEtag = result.etag;
      lastFetchedAt = Date.now();

      // Rebuild caches from the new data
      commitDataCache = buildCommitDataMap(result.runs);

      // Invalidate job cache for in-progress runs (their jobs may have changed)
      for (const run of result.runs) {
        if (run.status !== "completed") {
          jobsCache.delete(run.id);
        }
      }

      // Build badges and update state
      const badges: Map<string, GraphBadge> = buildGraphBadges(result.runs);
      actions.setGraphBadges(badges);
    } catch (err) {
      if (signal?.aborted) return; // intentional cancellation — not an error
      console.error("[github-actions] fetch failed:", err);
    } finally {
      fetchInFlight = false;
    }
  }

  // ── Lazy initial fetch + auto-refresh while in CI view ───────────────
  // We track whether we've done the initial fetch to support lazy loading.
  let hasFetchedOnce = false;
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let fetchAbortCtrl: AbortController | null = null;

  function startAutoRefresh(): void {
    if (autoRefreshTimer) return;
    const interval = state.autoRefreshInterval();
    if (interval <= 0) return;

    autoRefreshTimer = setInterval(() => {
      // Only refresh when CI view is active
      if (state.activeProviderView() !== "github-actions") return;
      if (fetchAbortCtrl) fetchAbortCtrl.abort();
      const ctrl = new AbortController();
      fetchAbortCtrl = ctrl;
      doFetch(false, ctrl.signal);
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
  //  - Switch TO github-actions → do initial/catch-up fetch; start refresh timer
  //  - Switch AWAY from github-actions → stop refresh timer
  createEffect(() => {
    const view = state.activeProviderView();
    if (view === "github-actions") {
      if (!hasFetchedOnce) {
        hasFetchedOnce = true;
        const ctrl = new AbortController();
        fetchAbortCtrl = ctrl;
        doFetch(false, ctrl.signal);
      } else {
        // Check staleness: re-fetch if data is older than the refresh interval
        const interval = state.autoRefreshInterval();
        const staleThreshold = interval > 0 ? interval : 30000;
        if (Date.now() - lastFetchedAt > staleThreshold) {
          const ctrl = new AbortController();
          fetchAbortCtrl = ctrl;
          doFetch(false, ctrl.signal);
        }
      }
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Also restart the auto-refresh timer if the interval setting changes
  createEffect(() => {
    const _interval = state.autoRefreshInterval(); // track reactive dependency
    if (state.activeProviderView() === "github-actions") {
      stopAutoRefresh();
      startAutoRefresh();
    }
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
    // Only cache permanently for completed runs; in-progress runs may update
    if (run.status === "completed") {
      jobsCache.set(run.id, jobs);
    }
    return jobs;
  }

  // ── Public API ────────────────────────────────────────────────────────
  return {
    getCommitData: (sha: string) => commitDataCache.get(sha) ?? null,
    getCachedJobs: (runId: number) => jobsCache.get(runId) ?? null,
    fetchJobsForRun,
    refresh: () => doFetch(true),
    isAvailable,
  };
}

/** Re-export detail type for consumers that don't need to import from types.ts directly. */
export type { GitHubRunDetail };
