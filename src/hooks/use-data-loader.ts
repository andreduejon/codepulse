import { type Accessor, batch, createEffect, onCleanup, untrack } from "solid-js";
import type { AppActions, AppState } from "../context/state";
import { createGitDataService } from "../core/git/data-service";
import type { FastForwardResult } from "../core/git/log";
import type { GitPort } from "../core/git/port";

interface UseDataLoaderOptions {
  /** Git, through the app's port. */
  git: GitPort;
  /** Absolute path to the git repository. */
  repoPath: Accessor<string>;
  /** Initial branch to scope the log to on mount. */
  initialBranch?: string;
  /** Reactive app state — passed directly to avoid reading from context before the Provider renders. */
  state: AppState;
  /** App actions — passed directly to avoid reading from context before the Provider renders. */
  actions: AppActions;
  /** Menu → Repository → Preferences → Auto fast-forward: `f` and Auto fetch fast-forward too. Off by default. */
  autoFastForward?: Accessor<boolean>;
  /** After a fast-forward: `explicit` for ctrl+f and `:pull`, which always report. */
  onFastForward?: (result: FastForwardResult, explicit: boolean) => void;
}

interface UseDataLoaderResult {
  /** Reload all git data (branches, commits, stashes, working tree). */
  loadData: (branch?: string, stickyHash?: string, silent?: boolean, preserveLoaded?: boolean) => Promise<void>;
  /** Load the next page of commits and append to the existing list. */
  loadMoreData: () => Promise<void>;
  /** Fetch from the configured remote and reload data; `pull` (ctrl+f, `:pull`) also fast-forwards. */
  handleFetch: (mode?: "fetch" | "pull") => Promise<void>;
}

/**
 * Manages all git data loading for the app:
 * - Initial load on mount
 * - `loadData`: full reload (branches, commits, stashes, working tree)
 * - `loadMoreData`: pagination (next page of commits)
 * - `handleFetch`: fetch from remote then reload
 * - Local auto-refresh timer (driven by `state.autoRefreshInterval()`)
 * - Remote auto-fetch timer (driven by `state.autoFetchInterval()`)
 *
 * All abort controllers and timers are cleaned up via `onCleanup`.
 *
 * Accepts `state` and `actions` directly rather than calling `useAppState()`, because
 * this hook is called during AppContent's setup phase — before the AppStateContext.Provider
 * is rendered in the JSX return. Reading from context at that point would return undefined.
 */
export function useDataLoader({
  repoPath,
  git,
  initialBranch,
  state,
  actions,
  autoFastForward,
  onFastForward,
}: UseDataLoaderOptions): UseDataLoaderResult {
  const initialRepoPath = repoPath();
  const service = createGitDataService({
    git,
    repoPath,
    state,
    actions,
    batch,
    autoFastForward,
    onFastForward,
  });
  const { loadData, handleFetch } = service;

  // ── Initial load on mount ─────────────────────────────────────────
  createEffect(() => {
    const path = repoPath();
    service.newRepository();
    actions.setFetching(false);
    untrack(() => {
      const stickyHash = state.selectedCommit()?.hash;
      void loadData(path === initialRepoPath ? initialBranch : undefined, stickyHash);
    });
    // Load initial fetch time
    git.getLastFetchTime(path).then(time => {
      if (repoPath() === path) actions.setLastFetchTime(time);
    });
  });

  // ── Local auto-refresh timer ──────────────────────────────────────
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const interval = state.autoRefreshInterval();
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (interval > 0) {
      autoRefreshTimer = setInterval(() => {
        if (state.fetching()) return;
        const stickyHash = state.selectedCommit()?.hash;
        void loadData(undefined, stickyHash, true, true);
      }, interval);
    }
  });

  // ── Remote auto-fetch timer ───────────────────────────────────────
  let autoFetchTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const interval = state.autoFetchInterval();
    if (autoFetchTimer) {
      clearInterval(autoFetchTimer);
      autoFetchTimer = null;
    }
    if (interval > 0) {
      autoFetchTimer = setInterval(() => {
        void handleFetch();
      }, interval);
    }
  });
  onCleanup(() => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (autoFetchTimer) clearInterval(autoFetchTimer);
    // Stop in-flight git work so it cannot write into state after disposal.
    service.dispose();
  });

  return { loadData, loadMoreData: service.loadMoreData, handleFetch };
}
