import { createEffect, onCleanup } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import { isUncommittedHash } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { getCommitDetail, getUncommittedDetail } from "../git/repo";
import { getAvailableTabs } from "../utils/tab-utils";

const DETAIL_DEBOUNCE_MS = 150;

interface UseDetailLoaderOptions {
  /** Absolute path to the git repository. */
  repoPath: string;
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
  // ── Detail load on commit change ──────────────────────────────────
  let detailAbortCtrl: AbortController | null = null;
  let detailDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const commit = state.selectedCommit();
    // Read activeProviderView reactively so this effect re-fires when the user
    // switches between git and github-actions views (lazy load on view change).
    const isProviderMode = state.activeProviderView() === "github-actions";

    // Cancel any pending debounce and abort in-flight git subprocesses
    if (detailDebounceTimer) {
      clearTimeout(detailDebounceTimer);
      detailDebounceTimer = null;
    }
    if (detailAbortCtrl) {
      detailAbortCtrl.abort();
      detailAbortCtrl = null;
    }

    if (!commit) {
      actions.setCommitDetail(null);
      actions.setUncommittedDetail(null);
      actions.setDetailLoading(false);
      return;
    }

    const isUncommitted = isUncommittedHash(commit.hash);

    // Reset active tab — but preserve it on child/parent jump navigation
    // so the user stays on the Details tab when walking the commit graph.
    // getIsJumpNavigation() is a plain JS flag set synchronously by handleJumpToCommit
    // around the setCursorIndex call. Since SolidJS effects run synchronously when
    // a signal updates, this flag is still true when this effect fires.
    if (getIsJumpNavigation()) {
      // Jump — keep current tab, don't reset cursor (detail.tsx cursor effect
      // will position it on the correct parent/child entry using pendingJumpDirection).
    } else {
      // In CI mode default to the "github-actions" tab; otherwise default to "files" (or
      // "unstaged" for the uncommitted node).
      const defaultTab = isUncommitted ? "unstaged" : isProviderMode ? "github-actions" : "files";
      actions.setDetailActiveTab(defaultTab);
      actions.setDetailCursorIndex(0);
      // Clear any stale jump direction on normal (non-jump) navigation
      detailNavRef.pendingJumpDirection = null;
    }

    // Clear stale detail immediately so the old file tree nodes are removed
    // from the render tree during scroll (a 334-file commit's tree = ~3K nodes).
    actions.setCommitDetail(null);
    actions.setUncommittedDetail(null);

    // In provider mode there is no Files tab — skip the git subprocess entirely.
    // The loading spinner should only reflect CI data fetching (providerStatus),
    // not file-diff loading that will never be displayed.
    // When the user later tabs back to "git" view, activeProviderView changes,
    // this effect re-fires, and the detail is loaded at that point.
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
      try {
        if (isUncommitted) {
          // Uncommitted node: load staged/unstaged/untracked file lists in parallel
          const ud = await getUncommittedDetail(repoPath, ctrl.signal);
          if (!ctrl.signal.aborted) {
            actions.setUncommittedDetail(ud);
            // Also set a basic CommitDetail so any fallback code still has commit info
            actions.setCommitDetail({ ...commit, files: [...ud.staged, ...ud.unstaged, ...ud.untracked] });
            actions.setDetailLoading(false);
          }
        } else {
          const detail = await getCommitDetail(repoPath, commit.hash, commit, ctrl.signal);
          if (!ctrl.signal.aborted) {
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

  onCleanup(() => {
    if (detailDebounceTimer) {
      clearTimeout(detailDebounceTimer);
      detailDebounceTimer = null;
    }
    if (detailAbortCtrl) {
      detailAbortCtrl.abort();
      detailAbortCtrl = null;
    }
  });

  // ── Auto-switch away from empty tabs after detail data loads ──────
  // Finds the first non-disabled tab if the current tab has 0 items.
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
      if (tab === "unstaged") isEmpty = ud.unstaged.length === 0;
      else if (tab === "staged") isEmpty = ud.staged.length === 0;
      else if (tab === "untracked") isEmpty = ud.untracked.length === 0;
    } else if (!isUncommitted && cd) {
      if (tab === "files") isEmpty = cd.files.length === 0;
    } else if (!isUncommitted && tab === "github-actions" && getCommitData) {
      // Actions tab: treat as empty when the fetch is not in-flight and there
      // is no CI data for this commit — mirrors the Files tab behaviour.
      const isLoading = getProviderLoading?.() ?? false;
      if (!isLoading) {
        isEmpty = !getCommitData(commit.hash);
      }
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
}
