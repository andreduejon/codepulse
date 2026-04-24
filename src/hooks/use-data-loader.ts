import { batch, createEffect, onCleanup, onMount } from "solid-js";
import { isUncommittedHash } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { buildGraph, getMaxGraphColumns } from "../git/graph";
import { mergeCommitPages } from "../git/merge-pages";
import {
  fetchRemote,
  getBranches,
  getCommits,
  getCurrentBranch,
  getLastFetchTime,
  getRemoteUrl,
  getStashList,
  getTagDetails,
  getWorkingTreeStatus,
} from "../git/repo";
import {
  buildStashByParent,
  computeSilentMaxCount,
  computeTargetIndex,
  injectUncommittedNode,
  isStaleResult,
} from "../utils/data-loader-utils";

interface UseDataLoaderOptions {
  /** Absolute path to the git repository. */
  repoPath: string;
  /** Initial branch to scope the log to on mount. */
  initialBranch?: string;
  /** Reactive app state — passed directly to avoid reading from context before the Provider renders. */
  state: AppState;
  /** App actions — passed directly to avoid reading from context before the Provider renders. */
  actions: AppActions;
}

interface UseDataLoaderResult {
  /** Reload all git data (branches, commits, stashes, working tree). */
  loadData: (branch?: string, stickyHash?: string, silent?: boolean, preserveLoaded?: boolean) => Promise<void>;
  /** Load the next page of commits and append to the existing list. */
  loadMoreData: () => Promise<void>;
  /** Fetch from the configured remote and reload data. */
  handleFetch: () => Promise<void>;
}

/**
 * Manages all git data loading for the app:
 * - Initial load on mount
 * - `loadData`: full reload (branches, commits, stashes, working tree)
 * - `loadMoreData`: pagination (next page of commits)
 * - `handleFetch`: fetch from remote then reload
 * - Auto-refresh timer (driven by `state.autoRefreshInterval()`)
 *
 * All abort controllers and timers are cleaned up via `onCleanup`.
 *
 * Accepts `state` and `actions` directly rather than calling `useAppState()`, because
 * this hook is called during AppContent's setup phase — before the AppStateContext.Provider
 * is rendered in the JSX return. Reading from context at that point would return undefined.
 */
export function useDataLoader({ repoPath, initialBranch, state, actions }: UseDataLoaderOptions): UseDataLoaderResult {
  // ── loadData ──────────────────────────────────────────────────────
  let loadAbortCtrl: AbortController | null = null;

  async function loadData(branch?: string, stickyHash?: string, silent = false, preserveLoaded = false) {
    // Cancel any in-flight load — user-initiated actions take priority
    if (loadAbortCtrl) loadAbortCtrl.abort();
    const ctrl = new AbortController();
    loadAbortCtrl = ctrl;

    if (!silent) actions.setLoading(true);
    // Reset pagination on every fresh load
    actions.setHasMore(true);
    try {
      actions.setRepoPath(repoPath);

      // When viewing a specific branch perspective, scope the log to that branch
      const viewBranch = state.viewingBranch();
      const effectiveBranch = viewBranch ?? branch;
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      // Preserve scroll depth when reloading due to settings changes or manual refresh:
      // fetch at least as many commits as are currently loaded so the user doesn't
      // lose history they've already paged through.
      const pageSize = state.maxCount();
      const silentMaxCount = computeSilentMaxCount(pageSize, state.commits(), silent, preserveLoaded);

      const [commits, branches, currentBranch, remoteUrl, tagDetails, stashes, wtStatus] = await Promise.all([
        getCommits(
          repoPath,
          {
            maxCount: silentMaxCount,
            branch: effectiveBranch,
            all: effectiveAll,
          },
          ctrl.signal,
        ),
        getBranches(repoPath, ctrl.signal),
        getCurrentBranch(repoPath, ctrl.signal),
        getRemoteUrl(repoPath, ctrl.signal),
        getTagDetails(repoPath, ctrl.signal),
        getStashList(repoPath, ctrl.signal),
        getWorkingTreeStatus(repoPath, ctrl.signal),
      ]);

      // If we were superseded by a newer loadData call, discard results
      if (ctrl.signal.aborted) return;

      // Detect whether more commits exist beyond this page.
      // Compare raw git result count against the requested page size (not silentMaxCount,
      // which may be larger — we only care about the configured page size for hasMore).
      const rawCount = commits.length;
      actions.setHasMore(rawCount >= pageSize);

      // Capture the HEAD commit hash before any synthetic commits are injected.
      const headHash = commits[0]?.hash;

      // Build stash-by-parent map and inject stash badges onto parent commits.
      const stashByParent = buildStashByParent(stashes, commits);

      // Inject a synthetic "uncommitted changes" node at index 0 when the
      // working tree is dirty. Its parent is the current HEAD commit so
      // buildGraph draws it as a side branch off the tip.
      if (wtStatus && headHash) {
        injectUncommittedNode(commits, headHash);
      }

      // Skip update if nothing changed (avoids flicker on auto-refresh)
      if (silent && isStaleResult(state.commits(), commits)) return;

      const rows = buildGraph(commits);

      // Selection priority: sticky hash > current branch tip > 0
      const targetIndex = computeTargetIndex(rows, stickyHash);

      // Batch all signal updates to avoid intermediate reactive cascades
      batch(() => {
        actions.setCommits(commits);
        actions.setGraphRows(rows);
        actions.setMaxGraphColumns(getMaxGraphColumns(rows));
        actions.setBranches(branches);
        actions.setCurrentBranch(currentBranch);
        actions.setRemoteUrl(remoteUrl);
        actions.setTagDetails(tagDetails);
        actions.setStashByParent(stashByParent);
        actions.setError(null);
        actions.setCursorIndex(targetIndex);
        actions.setScrollTargetIndex(targetIndex);
      });
    } catch (err) {
      if (ctrl.signal.aborted) return; // superseded — ignore
      actions.setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Only clear loading/controller if we're still the active load
      if (loadAbortCtrl === ctrl) {
        loadAbortCtrl = null;
        if (!silent) actions.setLoading(false);
      }
    }
  }

  // ── loadMoreData ──────────────────────────────────────────────────
  let loadMoreAbortCtrl: AbortController | null = null;

  async function loadMoreData() {
    // Guards: don't load if there's nothing more, or if any fetch/load is already running
    if (!state.hasMore()) return;
    if (state.fetching()) return; // handleFetch in-flight
    if (loadAbortCtrl !== null) return; // loadData in-flight
    if (loadMoreAbortCtrl) return;

    const ctrl = new AbortController();
    loadMoreAbortCtrl = ctrl;
    actions.setFetching(true);

    try {
      const pageSize = state.maxCount();

      // Skip past already-loaded real commits (exclude synthetic uncommitted node)
      const existingCommits = state.commits().filter(c => !isUncommittedHash(c.hash));
      const skip = existingCommits.length;

      const viewBranch = state.viewingBranch();
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      const newCommits = await getCommits(
        repoPath,
        {
          maxCount: pageSize,
          skip,
          branch: viewBranch ?? undefined,
          all: effectiveAll,
        },
        ctrl.signal,
      );

      if (ctrl.signal.aborted) return;

      // If we got fewer commits than a full page, we've reached the end
      actions.setHasMore(newCommits.length >= pageSize);

      if (newCommits.length === 0) return;

      // Merge: existing commits + new page (handles uncommitted node & stash badges)
      const merged = mergeCommitPages(state.commits(), newCommits, state.stashByParent());

      const rows = buildGraph(merged);

      // Preserve current cursor position (don't jump on page load)
      const stickyHash = state.selectedCommit()?.hash;
      const targetIndex = stickyHash
        ? (() => {
            const idx = rows.findIndex(r => r.commit.hash === stickyHash);
            return idx >= 0 ? idx : state.cursorIndex();
          })()
        : state.cursorIndex();

      batch(() => {
        actions.setCommits(merged);
        actions.setGraphRows(rows);
        actions.setMaxGraphColumns(getMaxGraphColumns(rows));
        actions.setCursorIndex(targetIndex);
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      // Non-fatal: log but don't surface to user (partial data is still valid)
      console.error("loadMoreData failed:", err);
    } finally {
      if (loadMoreAbortCtrl === ctrl) {
        loadMoreAbortCtrl = null;
        actions.setFetching(false);
      }
    }
  }

  // ── handleFetch ───────────────────────────────────────────────────
  async function handleFetch() {
    if (state.fetching()) return; // guard against double-fetch
    actions.setFetching(true);
    try {
      const result = await fetchRemote(repoPath);
      if (result.ok) {
        const fetchTime = await getLastFetchTime(repoPath);
        actions.setLastFetchTime(fetchTime);
        const stickyHash = state.selectedCommit()?.hash;
        // silent=true: don't toggle state.loading() — that unmounts the entire
        // graph <For> list and destroys the scrollbox position.  state.fetching()
        // already drives the footer spinner, so there is no visual regression.
        await loadData(undefined, stickyHash, true, true);
      } else {
        actions.setError(result.error ?? "Fetch failed");
      }
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : String(err));
    } finally {
      actions.setFetching(false);
    }
  }

  // ── Initial load on mount ─────────────────────────────────────────
  onMount(() => {
    void (async () => {
      await loadData(initialBranch);
      await handleFetch();
    })();
    // Load initial fetch time
    getLastFetchTime(repoPath).then(time => actions.setLastFetchTime(time));
  });

  // ── Auto-refresh timer ────────────────────────────────────────────
  // Fetches remote refs and re-reads local git data at the configured interval.
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const interval = state.autoRefreshInterval();
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (interval > 0) {
      autoRefreshTimer = setInterval(() => {
        void handleFetch();
      }, interval);
    }
  });
  onCleanup(() => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  });

  return { loadData, loadMoreData, handleFetch };
}
