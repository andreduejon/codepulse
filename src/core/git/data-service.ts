/**
 * The repository's Git data for the graph, without any UI framework: the first load and reloads (history, branches,
 * tags, stashes, the working tree; HEAD found past the first page), pages of older history, and fetching (with
 * fast-forward). A reload that brings the same commits and refs keeps the rows and updates only what changed beside
 * them. A newer load supersedes an older one, and nothing from another repository is written.
 *
 * The Solid hook (hooks/use-data-loader.ts) gives it the app's state as ports and runs its timers.
 */
import { BANNER, bannerOrFallback, debugError } from "../banner";
import { buildGraph, getMaxGraphColumns } from "./graph";
import {
  buildStashByParent,
  computeSilentMaxCount,
  computeTargetIndex,
  findCurrentHeadHash,
  injectUncommittedNode,
  isStaleResult,
} from "./loading";
import type { FastForwardResult } from "./log";
import { mergeCommitPages } from "./merge-pages";
import type { GitPort } from "./port";
import type { Branch, Commit, GraphRow, TagInfo } from "./types";
import { isUncommittedHash } from "./types";

/** What the loader reads of the app's state. */
export interface GitDataState {
  commits: () => Commit[];
  branches: () => Branch[];
  tagDetails: () => Map<string, TagInfo>;
  stashByParent: () => Map<string, Commit[]>;
  cursorIndex: () => number;
  selectedCommit: () => Commit | null;
  /** The branch the graph shows on its own, or null for the usual view. */
  viewingBranch: () => string | null;
  showAllBranches: () => boolean;
  /** The page size. */
  maxCount: () => number;
  fetching: () => boolean;
  hasMore: () => boolean;
}

/** What the loader changes in the app's state. */
export interface GitDataActions {
  setCommits: (commits: Commit[]) => void;
  setGraphRows: (rows: GraphRow[]) => void;
  setMaxGraphColumns: (columns: number) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setRepoPath: (path: string) => void;
  setRemoteUrl: (url: string) => void;
  setTagDetails: (tags: Map<string, TagInfo>) => void;
  setStashByParent: (map: Map<string, Commit[]>) => void;
  setCursorIndex: (index: number) => void;
  setScrollTargetIndex: (index: number) => void;
  /** The working tree was read again: the selected Uncommitted row reloads its files. */
  noteWorkingTreeRead: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastFetchTime: (time: Date | null) => void;
  setFetching: (fetching: boolean, history?: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setHistoryError: (failed: boolean) => void;
}

export interface GitDataPorts {
  git: GitPort;
  /** The repository shown now: a load for another one is dropped. */
  repoPath: () => string;
  state: GitDataState;
  actions: GitDataActions;
  /** Applies several changes as one (Solid's batch); calling `fn` will do. */
  batch: (fn: () => void) => void;
  /** Menu → Repository → Preferences → Auto fast-forward: a fetch fast-forwards too. */
  autoFastForward?: () => boolean;
  /** After a fast-forward: `explicit` for ctrl+f and `:pull`, which always report. */
  onFastForward?: (result: FastForwardResult, explicit: boolean) => void;
}

export function createGitDataService(ports: GitDataPorts) {
  const { git, repoPath, state, actions, batch, autoFastForward, onFastForward } = ports;
  const _loadAbortCtrl: AbortController | null = null;
  const _loadMoreAbortCtrl: AbortController | null = null;

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

  return {
    loadData,
    loadMoreData,
    handleFetch,
    /** Another repository: a fetch under way no longer writes. */
    newRepository: () => {
      fetchOperation++;
    },
    /** The owner is gone: running work stops and writes nothing. */
    dispose: () => {
      loadAbortCtrl?.abort();
      loadMoreAbortCtrl?.abort();
      fetchOperation++;
    },
  };
}

export type GitDataService = ReturnType<typeof createGitDataService>;
