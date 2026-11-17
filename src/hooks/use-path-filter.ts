/**
 * usePathFilter — manages path-filter state for the commit graph.
 *
 * Watches graphRows changes and re-queries matching hashes when a path filter
 * is active (handles lazy-loading / auto-refresh). Exposes `handlePathExecute`
 * for applying a new path filter from the command bar.
 *
 * Mutual exclusion with search and ancestry is handled here for path execution,
 * and the caller's `clearSearchDebounce` / `setSearchInputValue` callbacks are
 * called to keep those modes in sync.
 *
 * @param repoPath         Absolute path to the git repository.
 * @param state            App state (reactive reads).
 * @param actions          App actions.
 * @param clearAnchor      Callback to deactivate ancestry mode (from useAncestry).
 * @param setSearchInputValue Setter for the live search input value.
 * @param clearSearchDebounce Callback to cancel the pending search debounce timer.
 */

import { type Accessor, createEffect, untrack } from "solid-js";
import type { createAppState } from "../context/state";
import { createPathFilter } from "../core/git/path-filter";
import type { GitPort } from "../core/git/port";

type AppState = ReturnType<typeof createAppState>["state"];
type AppActions = ReturnType<typeof createAppState>["actions"];

interface UsePathFilterOptions {
  /** Git, through the app's port. */
  git: GitPort;
  repoPath: Accessor<string>;
  state: AppState;
  actions: AppActions;
  clearAnchor: () => void;
  setSearchInputValue: (value: string) => void;
  clearSearchDebounce: () => void;
}

export function usePathFilter({
  repoPath,
  git,
  state,
  actions,
  clearAnchor,
  setSearchInputValue,
  clearSearchDebounce,
}: UsePathFilterOptions) {
  const pathFilter = createPathFilter({ git, repoPath, state, actions });

  // The graph changed (pages, a refresh, another scope) while path mode is on: its matches are worked out again. The
  // path's first matches come from handlePathExecute; this only runs for what changes after.
  let previousIdentity = "";
  createEffect(() => {
    const rows = state.graphRows();
    const pf = state.pathFilter();
    const path = repoPath();
    const viewBranch = state.viewingBranch();
    const effectiveAll = viewBranch ? false : state.showAllBranches();
    const identity = JSON.stringify({ rows: rows.map(row => row.commit.hash), pf, path, viewBranch, effectiveAll });
    if (identity === previousIdentity) return;
    previousIdentity = identity;
    untrack(() => void pathFilter.refresh());
  });

  /**
   * Apply a path filter from the command bar PATH_INPUT mode. Empty clears it; a path sets it and dims the commits
   * that don't touch it. Search and ancestry end (one highlight mode at a time).
   */
  const handlePathExecute = (pathValue: string) =>
    pathFilter.apply(pathValue, () => {
      actions.setSearchQuery("");
      setSearchInputValue("");
      clearSearchDebounce();
      clearAnchor();
    });

  return { handlePathExecute };
}
