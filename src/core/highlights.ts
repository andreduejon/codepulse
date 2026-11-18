/** The graph's highlights as the app turns them on and off: one at a time (ancestry, path or search). */
import type { AppActions, AppState } from "./app-state";

export interface HighlightPorts {
  state: Pick<AppState, "ancestrySet" | "selectedCommit">;
  actions: Pick<AppActions, "setSearchQuery" | "setPathFilter" | "setPathMatchSet">;
  /** Highlights the first-parent chain through a commit: its ancestors and descendants. */
  setAnchor: (hash: string) => void;
  clearAnchor: () => void;
}

/** Ancestry on the selected commit, or off when it is on. Turning it on ends search and path mode. */
export function toggleAncestry(ports: HighlightPorts): void {
  if (ports.state.ancestrySet() !== null) {
    ports.clearAnchor();
    return;
  }
  ports.actions.setSearchQuery("");
  ports.actions.setPathFilter(null);
  ports.actions.setPathMatchSet(null);
  const anchor = ports.state.selectedCommit()?.hash;
  if (anchor) ports.setAnchor(anchor);
}
