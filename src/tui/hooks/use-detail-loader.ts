import { type Accessor, createEffect, on, onCleanup, untrack } from "solid-js";
import { createCommitDetailService } from "../../core/git/commit-detail";
import type { GitPort } from "../../core/git/port";
import { isUncommittedHash } from "../../core/git/types";
import type { DetailNavRef } from "../components/detail-types";
import type { AppActions, AppState } from "../context/state";
import { getAvailableTabs, getDefaultDetailTab } from "../utils/tab-utils";

interface UseDetailLoaderOptions {
  /** Git, through the app's port. */
  git: GitPort;
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
  /** A provider tab's label for a commit: null hides a tab only some commits have (GitHub's Pull requests). */
  tabLabel?: (tab: string, sha: string) => string | null | undefined;
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
  git,
  state,
  actions,
  getIsJumpNavigation,
  detailNavRef,
  getCommitData,
  tabLabel,
  getProviderLoading,
}: UseDetailLoaderOptions): void {
  const details = createCommitDetailService({
    git,
    repoPath,
    selectedHash: () => state.selectedCommit()?.hash,
    actions,
  });
  /** The graph's details: the Dashboard has its own, which the graph's commit leaves alone. */
  const graphDetail = state.detailFor("graph");
  const setGraphDetail = actions.detailFor("graph");

  // Another selected commit (or another view, which may load what the details show): its tab, then its details. Back
  // from the Dashboard on the same commit in the same view, the details are as they were left (a mutable ref: it
  // outlives the effect's runs while the Dashboard shows).
  const shownFor = { path: "", hash: null as string | null, view: null as string | null };
  createEffect(() => {
    const path = repoPath();
    const commit = state.selectedCommit();
    const activeProvider = state.activeProviderView();
    // The Dashboard has details of its own: the graph's wait for it to go.
    if (activeProvider === "dashboard") return;
    const hash = commit?.hash ?? null;
    // A jump from the Dashboard opens the event's own tab, once: also back on the commit and view it was left on.
    const wanted = detailNavRef.pendingTab;
    detailNavRef.pendingTab = undefined;
    if (path === shownFor.path && hash === shownFor.hash && activeProvider === shownFor.view) {
      if (wanted) {
        setGraphDetail.setDetailActiveTab(wanted);
        setGraphDetail.setDetailCursorIndex(0);
      }
      return;
    }
    Object.assign(shownFor, { path, hash, view: activeProvider });
    /*
     * The tab starts over, except on a jump to a child or parent: walking the graph keeps the Details tab. The jump's
     * flag is set around the cursor change, and this effect runs inside it.
     */
    if (commit && !getIsJumpNavigation()) {
      setGraphDetail.setDetailActiveTab(wanted ?? getDefaultDetailTab(commit, activeProvider, state.providers.set));
      setGraphDetail.setDetailCursorIndex(0);
      detailNavRef.pendingJumpDirection = null;
    }
    untrack(() => details.select(commit));
  });

  // Auto-switch away from empty tabs after detail loads (the graph's tabs: not while the dashboard shows its own).
  createEffect(() => {
    if (state.activeProviderView() === "dashboard") return;
    const commit = state.selectedCommit();
    const cd = state.commitDetail();
    const ud = state.uncommittedDetail();
    const tab = graphDetail.detailActiveTab();
    if (!commit) return;

    const isUncommitted = isUncommittedHash(commit.hash);

    const owner = state.providers.set.providerOfTab(tab);
    // A tab a provider adds (Snyk's Dependencies): it goes when the commit has nothing for it.
    if (owner && owner.id !== tab) {
      const provider = state.activeProviderView();
      const available = getAvailableTabs({
        providers: state.providers.set,
        commit,
        uncommittedDetail: ud,
        commitDetail: cd,
        stashByParent: state.stashByParent(),
        activeProviderView: provider,
        getCommitData,
        tabLabel,
      });
      if (!available.includes(tab)) {
        setGraphDetail.setDetailActiveTab(getDefaultDetailTab(commit, provider, state.providers.set));
        setGraphDetail.setDetailCursorIndex(0);
        actions.setDetailCursorAction(null);
      }
      return;
    }

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
    } else if (!isUncommitted && owner) {
      // Provider tabs own their empty/loading UI. Never auto-switch away.
    }

    if (!isEmpty) return;

    // Switch to the first non-empty tab
    const available = getAvailableTabs({
      providers: state.providers.set,
      commit,
      uncommittedDetail: ud,
      commitDetail: cd,
      stashByParent: state.stashByParent(),
      activeProviderView: state.activeProviderView(),
      getCommitData,
      providerLoading: getProviderLoading?.(),
      tabLabel,
    });
    if (available.length > 0) {
      setGraphDetail.setDetailActiveTab(available[0]);
    }
  });

  // A refresh that read a dirty working tree: the selected uncommitted row shows its files again, quietly (the cursor
  // and tab stay). The rows themselves may be the same, so the selection doesn't change for it.
  createEffect(
    on(
      state.workingTreeReads,
      () => {
        const commit = untrack(state.selectedCommit);
        if (commit) details.reloadWorkingTree(commit);
      },
      { defer: true },
    ),
  );

  onCleanup(() => details.dispose());
}
