/**
 * The graph and its details: loading the history (pages, refresh, fetch), the selected commit's details, selecting a
 * row, jumping to a child or parent from the details, a branch view, and the scroll positions of both. The details'
 * cursor, tab and focus are the graph's own (`state.detailFor("graph")`); the Dashboard has its own.
 */
import type { ScrollBoxRenderable } from "@opentui/core";
import { type Accessor, batch, createEffect } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import type { AppActions, AppState } from "../context/state";
import type { FastForwardResult } from "../core/git/log";
import { useDataLoader } from "../hooks/use-data-loader";
import { useDetailLoader } from "../hooks/use-detail-loader";

export function useGraphController(opts: {
  state: AppState;
  actions: AppActions;
  repoPath: Accessor<string>;
  /** The branch the command line asked for, for the first load. */
  initialBranch?: string;
  autoFastForward: Accessor<boolean>;
  onFastForward: (result: FastForwardResult, explicit: boolean) => void;
  /** The graph's details' rows to activate and scroll to (the Dashboard has its own). */
  navRef: DetailNavRef;
  /** The shown provider's data for a commit: which detail tabs have something. */
  commitData: (sha: string) => unknown;
  /** Before a row is selected with the mouse: the ancestry follows it, the command bar is left. */
  beforeSelect: (hash: string) => void;
}) {
  const { state, actions, navRef } = opts;
  let graphScrollbox: ScrollBoxRenderable | undefined;
  let detailScrollbox: ScrollBoxRenderable | undefined;
  /**
   * Set while a jump to a child or parent moves the cursor: the detail loader keeps the tab instead of resetting it. A
   * plain flag: the cursor's change reaches the loader synchronously, inside the jump.
   */
  let isJumpNavigation = false;

  // All Git data: the first load, pages, fetch, and the refresh timers.
  const { loadData, loadMoreData, handleFetch } = useDataLoader({
    repoPath: opts.repoPath,
    initialBranch: opts.initialBranch,
    state,
    actions,
    autoFastForward: opts.autoFastForward,
    onFastForward: opts.onFastForward,
  });

  // The selected commit's details, once the cursor rests (stale loads are cancelled); an empty tab gives way.
  useDetailLoader({
    repoPath: opts.repoPath,
    state,
    actions,
    getIsJumpNavigation: () => isJumpNavigation,
    detailNavRef: navRef,
    getCommitData: opts.commitData,
    getProviderLoading: () => state.providerStatus().kind === "loading",
  });

  // Another tab: its rows from the top.
  createEffect(() => {
    state.detailActiveTab();
    detailScrollbox?.scrollTo(0);
  });

  // Fewer rows than before (a branch view, a reload): the cursor stays on one.
  createEffect(() => {
    const rows = state.graphRows();
    const idx = state.cursorIndex();
    if (rows.length === 0) {
      if (idx !== 0) {
        actions.setCursorIndex(0);
        actions.setScrollTargetIndex(0);
      }
    } else if (idx >= rows.length) {
      const clamped = rows.length - 1;
      actions.setCursorIndex(clamped);
      actions.setScrollTargetIndex(clamped);
    }
  });

  return {
    loadData,
    loadMoreData,
    handleFetch,
    /** A child or parent in the details: that commit, with the same tab. */
    jumpToCommit: (hash: string, from: "child" | "parent") => {
      const idx = state.graphRows().findIndex(row => row.commit.hash === hash);
      if (idx < 0) return;
      navRef.lastJumpFrom = from;
      navRef.pendingJumpDirection = from;
      isJumpNavigation = true;
      actions.setCursorIndex(idx);
      isJumpNavigation = false;
      actions.setScrollTargetIndex(idx);
      detailScrollbox?.scrollTo(0);
    },
    /** The graph from a branch's view (null: all branches again, at the checked-out one). */
    viewBranch: (branch: string | null) => {
      actions.setViewingBranch(branch);
      // Into a branch the cursor tries to stay on its commit; back out, it goes to the checked-out branch's head.
      const stickyHash = branch ? state.selectedCommit()?.hash : undefined;
      loadData(undefined, stickyHash);
    },
    /** A click on a row: it is selected, and the graph has the keyboard. */
    selectRow: (index: number) => {
      const commit = state.graphRows()[index]?.commit;
      if (!commit) return;
      batch(() => {
        opts.beforeSelect(commit.hash);
        actions.setDetailFocused(false);
        actions.setCursorIndex(index);
        actions.setScrollTargetIndex(index);
      });
      navRef.pendingJumpDirection = null;
      detailScrollbox?.scrollTo(0);
    },
    setGraphScrollbox: (element: ScrollBoxRenderable) => {
      graphScrollbox = element;
    },
    setDetailScrollbox: (element: ScrollBoxRenderable) => {
      detailScrollbox = element;
    },
    detailScrollbox: () => detailScrollbox,
    graphScroll: {
      top: () => graphScrollbox?.scrollTop ?? 0,
      scrollTo: (top: number) => graphScrollbox?.scrollTo(top),
    },
  };
}

export type GraphController = ReturnType<typeof useGraphController>;
