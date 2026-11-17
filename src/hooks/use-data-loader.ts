import { type Accessor, batch, createEffect, onCleanup, untrack } from "solid-js";
import type { AppActions, AppState } from "../context/state";
import { BANNER, bannerOrFallback, debugError } from "../core/banner";
import { buildGraph, getMaxGraphColumns } from "../core/git/graph";
import type { FastForwardResult } from "../core/git/log";
import { mergeCommitPages } from "../core/git/merge-pages";
import type { GitPort } from "../core/git/port";
import { isUncommittedHash } from "../core/git/types";
import {
  buildStashByParent,
  computeSilentMaxCount,
  computeTargetIndex,
  findCurrentHeadHash,
  injectUncommittedNode,
  isStaleResult,
} from "../utils/data-loader-utils";

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
  // ── loadData ──────────────────────────────────────────────────────
  let loadAbortCtrl: AbortController | null = null;
  let loadMoreAbortCtrl: AbortController | null = null;

  async function loadData(branch?: string, stickyHash?: string, silent = false, preserveLoaded = false) {
    const path = repoPath();
    // Cancel any in-flight load — user-initiated actions take priority. A page of older history belongs to the
    // previous load (another branch or view), so it must not merge into this one.
    if (loadAbortCtrl) loadAbortCtrl.abort();
    const ctrl = new AbortController();
    loadAbortCtrl = ctrl;
    // Installed first: clearing `fetching` lets the graph ask for a page right away, and `loadAbortCtrl` is what
    // turns that request down (it would use the old graph's offset on the new branch).
    if (loadMoreAbortCtrl) {
      loadMoreAbortCtrl.abort();
      loadMoreAbortCtrl = null;
      actions.setFetching(false);
    }

    if (!silent) actions.setLoading(true);
    // Reset pagination on every fresh load, including a failed older page from before (or another repository)
    actions.setHasMore(true);
    actions.setHistoryError(false);
    try {
      actions.setRepoPath(path);

      // When viewing a specific branch perspective, scope the log to that branch
      const viewBranch = state.viewingBranch();
      const effectiveBranch = viewBranch ?? branch;
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      // Preserve scroll depth when reloading due to settings changes or manual refresh:
      // fetch at least as many commits as are currently loaded so the user doesn't
      // lose history they've already paged through.
      const pageSize = state.maxCount();
      const silentMaxCount = computeSilentMaxCount(pageSize, state.commits(), silent, preserveLoaded);

      const logOptions = { branch: effectiveBranch, all: effectiveAll };
      let [commits, branches, currentBranch, remoteUrl, tagDetails, stashes, wtStatus] = await Promise.all([
        git.getCommits(path, { ...logOptions, maxCount: silentMaxCount }, ctrl.signal),
        git.getBranches(path, ctrl.signal),
        git.getCurrentBranch(path, ctrl.signal),
        git.getRemoteUrl(path, ctrl.signal),
        git.getTagDetails(path, ctrl.signal),
        git.getStashList(path, ctrl.signal),
        git.getWorkingTreeStatus(path, ctrl.signal),
      ]);

      // If we were superseded by a newer loadData call, discard results
      if (ctrl.signal.aborted || repoPath() !== path) return;

      // HEAD can sit past the first page (an old branch checked out while --all shows newer work).
      // Without it there is no selection anchor and no uncommitted row, so widen the page a few times.
      const logIncludesHead = effectiveAll || !effectiveBranch;
      for (
        let count = silentMaxCount;
        !silent && logIncludesHead && !findCurrentHeadHash(commits) && commits.length >= count && count < pageSize * 16;
      ) {
        count *= 2;
        commits = await git.getCommits(path, { ...logOptions, maxCount: count }, ctrl.signal);
        if (ctrl.signal.aborted || repoPath() !== path) return;
      }

      // Detect whether more commits exist beyond this page.
      // Compare raw git result count against the requested page size (not silentMaxCount,
      // which may be larger — we only care about the configured page size for hasMore).
      const rawCount = commits.length;
      actions.setHasMore(rawCount >= pageSize);

      // Capture the HEAD commit hash before any synthetic commits are injected.
      const headHash = findCurrentHeadHash(commits);

      // Build stash-by-parent map and inject stash badges onto parent commits.
      const stashByParent = buildStashByParent(stashes, commits);

      // Inject a synthetic "uncommitted changes" node at index 0 when the
      // working tree is dirty. Its parent is the current HEAD commit so
      // buildGraph draws it as a side branch off the tip.
      if (wtStatus && headHash) {
        injectUncommittedNode(commits, headHash);
      }

      // The same commits and refs: the rows stay as they are (no rebuild, no flicker). What can change beside them still
      // shows: the remote, the branches' tracking, a tag's message, a stash replaced by another, the working tree.
      if (silent && isStaleResult(state.commits(), commits)) {
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        batch(() => {
          actions.setRemoteUrl(remoteUrl);
          actions.setCurrentBranch(currentBranch);
          if (!same(state.branches(), branches)) actions.setBranches(branches);
          if (!same([...state.tagDetails()], [...tagDetails])) actions.setTagDetails(tagDetails);
          if (!same([...state.stashByParent()], [...stashByParent])) actions.setStashByParent(stashByParent);
          if (wtStatus) actions.noteWorkingTreeRead();
        });
        return;
      }

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
      actions.setError(bannerOrFallback(err, BANNER.git.logFailed, "Git"));
    } finally {
      // Only clear loading/controller if we're still the active load
      if (loadAbortCtrl === ctrl) {
        loadAbortCtrl = null;
        if (!silent) actions.setLoading(false);
      }
    }
  }

  // ── loadMoreData ──────────────────────────────────────────────────

  async function loadMoreData() {
    const path = repoPath();
    // Guards: don't load if there's nothing more, or if any fetch/load is already running
    if (!state.hasMore()) return;
    if (state.fetching()) return; // handleFetch in-flight
    if (loadAbortCtrl !== null) return; // loadData in-flight
    if (loadMoreAbortCtrl) return;

    const ctrl = new AbortController();
    loadMoreAbortCtrl = ctrl;
    actions.setFetching(true, true);
    actions.setHistoryError(false);

    try {
      const pageSize = state.maxCount();

      // Skip past already-loaded real commits (exclude synthetic uncommitted node)
      const existingCommits = state.commits().filter(c => !isUncommittedHash(c.hash));
      const skip = existingCommits.length;

      const viewBranch = state.viewingBranch();
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      const newCommits = await git.getCommits(
        path,
        {
          maxCount: pageSize,
          skip,
          branch: viewBranch ?? undefined,
          all: effectiveAll,
        },
        ctrl.signal,
      );

      if (ctrl.signal.aborted || repoPath() !== path) return;

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
      // Non-fatal: the loaded graph stays valid; the graph's last row says so and scrolling to the end retries.
      debugError("Git", err);
      if (repoPath() === path) actions.setHistoryError(true);
    } finally {
      if (loadMoreAbortCtrl === ctrl) {
        loadMoreAbortCtrl = null;
        actions.setFetching(false);
      }
    }
  }

  // ── handleFetch ───────────────────────────────────────────────────
  let fetchOperation = 0;
  async function handleFetch(mode: "fetch" | "pull" = "fetch") {
    const path = repoPath();
    const fastForward = mode === "pull" || (autoFastForward?.() ?? false);
    if (state.fetching()) return; // guard against double-fetch
    const operation = ++fetchOperation;
    const isCurrent = () => operation === fetchOperation && repoPath() === path;
    actions.setFetching(true);
    try {
      const result = await git.fetchRemote(path);
      if (!isCurrent()) return;
      if (result.ok) {
        const fetchTime = await git.getLastFetchTime(path);
        if (!isCurrent()) return;
        actions.setLastFetchTime(fetchTime);
        if (fastForward) {
          const moved = await git.fastForwardBranches(path);
          if (!isCurrent()) return;
          onFastForward?.(moved, mode === "pull");
        }
        const stickyHash = state.selectedCommit()?.hash;
        // silent=true: don't toggle state.loading() — that unmounts the entire
        // graph <For> list and destroys the scrollbox position.  state.fetching()
        // already drives the footer spinner, so there is no visual regression.
        await loadData(undefined, stickyHash, true, true);
        if (!isCurrent()) return;
      } else {
        actions.setError(result.error ?? BANNER.git.fetchFailed);
      }
    } catch (err) {
      if (!isCurrent()) return;
      actions.setError(bannerOrFallback(err, BANNER.git.fetchFailed, "Git"));
    } finally {
      if (isCurrent()) actions.setFetching(false);
    }
  }

  // ── Initial load on mount ─────────────────────────────────────────
  createEffect(() => {
    const path = repoPath();
    fetchOperation++;
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
    loadAbortCtrl?.abort();
    loadMoreAbortCtrl?.abort();
    fetchOperation++;
  });

  return { loadData, loadMoreData, handleFetch };
}
