import { batch } from "solid-js";
import type { RepoSessionSnapshot } from "./app-types";
import type { AppActions, AppState } from "./context/app-state-types";

/** The graph state of the current repository, kept while another repository is shown. */
export function captureRepoSession(state: AppState, graphScrollTop: number): RepoSessionSnapshot {
  return {
    commits: state.commits(),
    graphRows: state.graphRows(),
    branches: state.branches(),
    currentBranch: state.currentBranch(),
    repoPath: state.repoPath(),
    remoteUrl: state.remoteUrl(),
    tagDetails: new Map(state.tagDetails()),
    stashByParent: new Map(state.stashByParent()),
    cursorIndex: state.cursorIndex(),
    scrollTargetIndex: state.scrollTargetIndex(),
    maxGraphColumns: state.maxGraphColumns(),
    hasMore: state.hasMore(),
    lastFetchTime: state.lastFetchTime(),
    activeProviderView: state.activeProviderView(),
    graphScrollTop,
  };
}

/** Shows a kept repository again without reloading it; the caller restores the graph scroll position. */
export function applyRepoSession(actions: AppActions, snapshot: RepoSessionSnapshot): void {
  batch(() => {
    actions.setCommits(snapshot.commits);
    actions.setGraphRows(snapshot.graphRows);
    actions.setBranches(snapshot.branches);
    actions.setCurrentBranch(snapshot.currentBranch);
    actions.setRepoPath(snapshot.repoPath);
    actions.setRemoteUrl(snapshot.remoteUrl);
    actions.setTagDetails(new Map(snapshot.tagDetails));
    actions.setStashByParent(new Map(snapshot.stashByParent));
    actions.setCursorIndex(snapshot.cursorIndex);
    actions.setScrollTargetIndex(snapshot.scrollTargetIndex);
    actions.setMaxGraphColumns(snapshot.maxGraphColumns);
    actions.setHasMore(snapshot.hasMore);
    actions.setLastFetchTime(snapshot.lastFetchTime);
    actions.setActiveProviderView(snapshot.activeProviderView);
    actions.setLoading(false);
    actions.setFetching(false);
    actions.setDetailLoading(false);
  });
}
