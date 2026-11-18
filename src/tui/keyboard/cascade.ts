/** Esc in the terminal: which one step it takes back (the command bar, a dialog, the details, a highlight, a branch view). */

/**
 * Determine which cascade step to close next, given the current UI state.
 *
 * Returns a string token describing what should be closed, or null if nothing
 * is open. The caller is responsible for executing the actual state mutations.
 *
 * Cascade order (highest priority first):
 *   command-bar → dialog → search-focused → detail-focused →
 *   search-highlight → ancestry-highlight → path-highlight → branch-view → nothing
 */
export type CascadeTarget =
  | "command-bar"
  | "detail-dialog"
  | "back-to-detail"
  | "dialog"
  | "search-focused"
  | "detail-focused"
  | "search-highlight"
  | "ancestry-highlight"
  | "path-highlight"
  | "branch-view"
  | null;

export interface CascadeState {
  commandBarMode: "idle" | "command" | "search" | "path";
  searchFocused: boolean;
  dialog: string | null;
  layoutMode: "too-small" | "compact" | "normal";
  detailFocused: boolean;
  highlightSet: Set<string> | null;
  searchQuery: string;
  ancestrySet: Set<string> | null;
  pathFilter: string | null;
  viewingBranch: string | null;
  /** The dashboard shows: the graph's search, highlights and branch view are behind it, so Esc leaves them. */
  dashboard?: boolean;
}

/** Dialogs opened from the details: in compact layout, closing one goes back to the details dialog. */
export const DETAIL_CHILD_DIALOGS: ReadonlySet<string> = new Set(["diff-blame", "job-log", "provider"]);

export function computeCascadeTarget(s: CascadeState): CascadeTarget {
  if (s.commandBarMode !== "idle") return "command-bar";
  if (s.dialog) {
    // The dashboard's compact details close like the graph's: the events have the keyboard again.
    if (s.dialog === "detail" || s.dialog === "dashboard-event") return "detail-dialog";
    // A dialog opened from compact details (a diff, a log, a provider's own) goes back to them.
    if (DETAIL_CHILD_DIALOGS.has(s.dialog) && s.layoutMode === "compact" && s.detailFocused) return "back-to-detail";
    return "dialog";
  }
  // The dashboard has no graph highlights or branch to clear: only its provider tab gives the keyboard back.
  if (s.dashboard) return s.detailFocused ? "detail-focused" : null;
  if (s.searchFocused) return "search-focused";
  if (s.detailFocused) return "detail-focused";
  if (s.highlightSet !== null) {
    if (s.searchQuery) return "search-highlight";
    if (s.ancestrySet !== null) return "ancestry-highlight";
    if (s.pathFilter) return "path-highlight";
  }
  if (s.viewingBranch) return "branch-view";
  return null;
}
