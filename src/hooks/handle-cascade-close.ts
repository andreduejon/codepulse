/**
 * createCloseOneCascadeStep — factory that returns the closeOneCascadeStep function.
 *
 * Closes the topmost open layer on each Escape press.
 * Order: command bar → dialog → search bar focused → detail focus →
 *        active highlight (search/ancestry/path) → branch view
 *
 * Returns true if something was closed, false if there was nothing left.
 */
import type { AppActions, AppState } from "../context/state";
import { computeCascadeTarget } from "../utils/keyboard-nav-utils";
import type { CommandBarMode, DialogId } from "./use-keyboard-navigation";

export interface CascadeCloseOptions {
  state: AppState;
  actions: AppActions;
  dialog: () => DialogId;
  setDialog: (d: DialogId) => void;
  layoutMode: () => "too-small" | "compact" | "normal";
  commandBarMode: () => CommandBarMode;
  searchFocused: () => boolean;
  setSearchFocused: (v: boolean) => void;
  clearSearch: () => void;
  exitCommandBar: () => void;
  onClearAncestry: () => void;
  loadData: (branch?: string, stickyHash?: string, silent?: boolean, preserveLoaded?: boolean) => void;
}

export function createCloseOneCascadeStep(opts: CascadeCloseOptions): () => boolean {
  const {
    state,
    actions,
    dialog,
    setDialog,
    layoutMode,
    commandBarMode,
    searchFocused,
    setSearchFocused,
    clearSearch,
    exitCommandBar,
    onClearAncestry,
    loadData,
  } = opts;

  return function closeOneCascadeStep(): boolean {
    const target = computeCascadeTarget({
      commandBarMode: commandBarMode(),
      searchFocused: searchFocused(),
      dialog: dialog(),
      layoutMode: layoutMode(),
      detailFocused: state.detailFocused(),
      highlightSet: state.highlightSet(),
      searchQuery: state.searchQuery(),
      ancestrySet: state.ancestrySet(),
      pathFilter: state.pathFilter(),
      viewingBranch: state.viewingBranch(),
    });

    switch (target) {
      case "command-bar":
        exitCommandBar();
        if (searchFocused()) {
          setSearchFocused(false);
          clearSearch();
        }
        return true;
      case "detail-dialog":
        actions.setDetailFocused(false);
        setDialog(null);
        return true;
      case "diff-blame-compact":
        setDialog("detail");
        return true;
      case "dialog":
        setDialog(null);
        return true;
      case "search-focused":
        setSearchFocused(false);
        clearSearch();
        return true;
      case "detail-focused":
        actions.setDetailFocused(false);
        return true;
      case "search-highlight":
        clearSearch();
        return true;
      case "ancestry-highlight":
        onClearAncestry();
        return true;
      case "path-highlight":
        actions.setPathFilter(null);
        actions.setPathMatchSet(null);
        return true;
      case "branch-view":
        actions.setViewingBranch(null);
        loadData();
        return true;
      default:
        return false;
    }
  };
}
