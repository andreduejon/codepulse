import { type Accessor, createEffect, onCleanup } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import { isUncommittedHash } from "../constants";
import type { AppActions, AppState, DetailTab } from "../context/state";
import { getCommitDetail, getUncommittedDetail } from "../git/repo";
import { getAvailableTabs } from "../utils/tab-utils";

const DETAIL_DEBOUNCE_MS = 150;
const PROVIDER_VIEWS = new Set(["github-actions", "jenkins", "openshift"]);

function cancelPending(timer: ReturnType<typeof setTimeout> | null, ctrl: AbortController | null): void {
  if (timer) clearTimeout(timer);
  if (ctrl) ctrl.abort();
}

interface UseDetailLoaderOptions {
  /** Absolute path to the git repository. */
  repoPath: Accessor<string>;
  /** Reactive app state — passed directly to avoid reading from context before the Provider renders. */
  state: AppState;
  /** App actions — passed directly to avoid reading from context before the Provider renders. */
  actions: AppActions;
  /**
   * Returns true when the current cursor change is a child/parent jump navigation.
   * Read synchronously when the commit-change effect fires.
   */
  getIsJumpNavigation: () => boolean;
  /** Mutable navigation ref shared with the detail panel component. */
  detailNavRef: DetailNavRef;
  /**
   * CI data getter from the GitHub Actions provider.  When provided, used to
   * determine whether the Actions tab has data for the current commit — mirroring
   * how the Files tab is disabled when a commit has no changed files.
   */
  getCommitData?: (sha: string) => unknown;
  /**
   * Returns true while the initial CI fetch is in-flight.  Passed to
   * getAvailableTabs so the Actions tab is not switched away from prematurely
   * before the first fetch completes.
   */
  getProviderLoading?: () => boolean;
}

/**
 * Manages reactive commit detail loading with debounce, abort-on-supersede, and
 * automatic tab switching when the loaded data reveals an empty active tab.
 *
 * Sets up two `createEffect`s:
 * 1. Loads commit detail (or uncommitted detail) whenever the selected commit changes.
 * 2. Auto-switches away from empty tabs after detail data arrives.
 *
 * Also resets `detailNavRef.pendingJumpDirection` on non-jump navigations.
 *
 * Accepts `state` and `actions` directly rather than calling `useAppState()`, because
 * this hook is called during AppContent's setup phase — before the AppStateContext.Provider
 * is rendered in the JSX return. Reading from context at that point would return undefined.
 */
export function useDetailLoader({
  repoPath,
  state,
  actions,
  getIsJumpNavigation,
  detailNavRef,
  getCommitData,
  getProviderLoading,
}: UseDetailLoaderOptions): void {
  let detailAbortCtrl: AbortController | null = null;
  let detailDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Load commit detail whenever the selected commit changes.
  createEffect(() => {
    const path = repoPath();
    const commit = state.selectedCommit();
    // Read activeProviderView reactively so this effect re-fires when the user
    // switches between git and provider views (lazy load on view change).
    const activeProvider = state.activeProviderView();
    const isProviderMode = PROVIDER_VIEWS.has(activeProvider);

    // Cancel any pending debounce and abort in-flight git subprocesses
    cancelPending(detailDebounceTimer, detailAbortCtrl);
    detailDebounceTimer = detailAbortCtrl = null;

    if (!commit) {
      actions.setCommitDetail(null);
      actions.setUncommittedDetail(null);
      actions.setDetailLoading(false);
      return;
    }

    const isUncommitted = isUncommittedHash(commit.hash);

    /*
     * Reset active tab — but preserve it on child/parent jump navigation
     * so the user stays on the Details tab when walking the commit graph.
     * getIsJumpNavigation() is a plain JS flag set synchronously by
     * handleJumpToCommit around the setCursorIndex call. Since SolidJS
     * effects run synchronously when a signal updates, this flag is still
     * true when this effect fires.
     */
    if (!getIsJumpNavigation()) {
      let defaultTab: DetailTab = "files";

      if (isUncommitted) {
        defaultTab = "unstaged";
      }

      if (isProviderMode) {
        defaultTab = activeProvider as DetailTab;
      }

      actions.setDetailActiveTab(defaultTab);
      actions.setDetailCursorIndex(0);
      // Clear any stale jump direction on normal (non-jump) navigation
      detailNavRef.pendingJumpDirection = null;
    }

    // Clear stale detail immediately so the old file tree nodes are removed.
    actions.setCommitDetail(null);
    actions.setUncommittedDetail(null);

    // In provider mode there is no files tab. In this case skip the git subprocess entirely.

    if (isProviderMode && !isUncommitted) {
      actions.setDetailLoading(false);
      return;
    }

    actions.setDetailLoading(true);

    // Debounce the detail load to avoid spawning git subprocesses on rapid navigation
    detailDebounceTimer = setTimeout(async () => {
      detailDebounceTimer = null;
      const ctrl = new AbortController();
      detailAbortCtrl = ctrl;

      const notSuperseded = () => !ctrl.signal.aborted && repoPath() === path;

      try {
        if (isUncommitted) {
          // Uncommitted node: load staged/unstaged/untracked file lists in parallel
          const ud = await getUncommittedDetail(path, ctrl.signal);
          if (notSuperseded()) {
            actions.setUncommittedDetail(ud);
            // Also set a basic CommitDetail so any fallback code still has commit info
            actions.setCommitDetail({ ...commit, files: [...ud.staged, ...ud.unstaged, ...ud.untracked] });
            actions.setDetailLoading(false);
          }
        } else {
          const detail = await getCommitDetail(path, commit.hash, commit, ctrl.signal);
          if (notSuperseded()) {
            actions.setCommitDetail(detail);
            actions.setDetailLoading(false);
          }
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          actions.setCommitDetail(null);
          actions.setUncommittedDetail(null);
          actions.setDetailLoading(false);
          actions.setError(err instanceof Error ? err.message : String(err));
        }
      }
    }, DETAIL_DEBOUNCE_MS);
  });

  // Auto-switch away from empty tabs after detail loads.
  createEffect(() => {
    const commit = state.selectedCommit();
    const cd = state.commitDetail();
    const ud = state.uncommittedDetail();
    const tab = state.detailActiveTab();
    if (!commit) return;

    const isUncommitted = isUncommittedHash(commit.hash);

    // Check if current tab is empty
    let isEmpty = false;
    if (isUncommitted && ud) {
      switch (tab) {
        case "unstaged":
          isEmpty = ud.unstaged.length === 0;
          break;
        case "staged":
          isEmpty = ud.staged.length === 0;
          break;
        case "untracked":
          isEmpty = ud.untracked.length === 0;
          break;
      }
    } else if (!isUncommitted && cd) {
      isEmpty = tab === "files" && cd.files.length === 0;
    } else if (!isUncommitted && PROVIDER_VIEWS.has(tab)) {
      // Provider tabs own their empty/loading UI. Never auto-switch away.
    }

    if (!isEmpty) return;

    // Switch to the first non-empty tab
    const available = getAvailableTabs({
      commit,
      uncommittedDetail: ud,
      commitDetail: cd,
      stashByParent: state.stashByParent(),
      activeProviderView: state.activeProviderView(),
      getCommitData,
      providerLoading: getProviderLoading?.(),
    });
    if (available.length > 0) {
      actions.setDetailActiveTab(available[0]);
    }
  });

  // Cancel any pending debounce timers and abort in-flight git subprocesses.
  onCleanup(() => {
    cancelPending(detailDebounceTimer, detailAbortCtrl);
    detailDebounceTimer = detailAbortCtrl = null;
  });
}
