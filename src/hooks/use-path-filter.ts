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
import { createEffect } from "solid-js";
import type { createAppState } from "../context/state";
import { getPathMatchingHashes } from "../git/repo";

type AppState = ReturnType<typeof createAppState>["state"];
type AppActions = ReturnType<typeof createAppState>["actions"];

interface UsePathFilterOptions {
  repoPath: string;
  state: AppState;
  actions: AppActions;
  clearAnchor: () => void;
  setSearchInputValue: (value: string) => void;
  clearSearchDebounce: () => void;
}

export function usePathFilter({
  repoPath,
  state,
  actions,
  clearAnchor,
  setSearchInputValue,
  clearSearchDebounce,
}: UsePathFilterOptions) {
  // Re-compute pathMatchSet when graphRows changes and path filter is active
  // (pagination / auto-refresh may load new commits that touch the path).
  // Uses the same prevGraphRows guard pattern as the ancestry effect — the
  // initial path execution already sets the match set; this only fires on
  // subsequent graphRows changes.
  let prevPathGraphRows: readonly object[] | null = null;
  createEffect(() => {
    const rows = state.graphRows();
    if (rows === prevPathGraphRows) return;
    prevPathGraphRows = rows;
    const pf = state.pathFilter();
    if (!pf) return;
    // Re-run the hash query asynchronously
    const viewBranch = state.viewingBranch();
    const effectiveAll = viewBranch ? false : state.showAllBranches();
    getPathMatchingHashes(repoPath, pf, {
      branch: viewBranch ?? undefined,
      all: effectiveAll,
    }).then(hashes => {
      // Only update if path filter is still the same (guard against race)
      if (state.pathFilter() === pf) {
        actions.setPathMatchSet(hashes.size > 0 ? hashes : new Set());
        // If cursor is on a non-matching row, jump to the nearest match
        const matchSet = hashes;
        if (matchSet.size > 0) {
          const rows = state.graphRows();
          const curIdx = state.cursorIndex();
          if (curIdx >= rows.length || !matchSet.has(rows[curIdx].commit.hash)) {
            let fwd = -1;
            for (let i = curIdx + 1; i < rows.length; i++) {
              if (matchSet.has(rows[i].commit.hash)) {
                fwd = i;
                break;
              }
            }
            let bwd = -1;
            for (let i = curIdx - 1; i >= 0; i--) {
              if (matchSet.has(rows[i].commit.hash)) {
                bwd = i;
                break;
              }
            }
            let target: number;
            if (fwd >= 0 && bwd >= 0) {
              target = curIdx - bwd <= fwd - curIdx ? bwd : fwd;
            } else {
              target = fwd >= 0 ? fwd : bwd;
            }
            if (target >= 0) {
              actions.setCursorIndex(target);
              actions.setScrollTargetIndex(target);
            }
          }
        }
      }
    });
  });

  /**
   * Apply a path filter from the command bar PATH_INPUT mode.
   * Empty string clears the filter; non-empty sets it and computes
   * the set of matching commit hashes for display-level dimming.
   * Mutually exclusive with search and ancestry.
   */
  const handlePathExecute = async (pathValue: string) => {
    const newPath = pathValue || null;
    actions.setPathFilter(newPath);
    if (!newPath) {
      actions.setPathMatchSet(null);
      return;
    }
    // Clear other highlight modes (mutual exclusion)
    actions.setSearchQuery("");
    setSearchInputValue("");
    clearSearchDebounce();
    clearAnchor();
    // Compute matching hashes using the same branch/all settings as the current view
    const viewBranch = state.viewingBranch();
    const effectiveAll = viewBranch ? false : state.showAllBranches();
    const hashes = await getPathMatchingHashes(repoPath, newPath, {
      branch: viewBranch ?? undefined,
      all: effectiveAll,
    });
    actions.setPathMatchSet(hashes.size > 0 ? hashes : new Set());
  };

  return { handlePathExecute };
}
