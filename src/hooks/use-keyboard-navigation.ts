import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { Accessor } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import { PAGE_JUMP, SHIFT_JUMP } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { getAvailableTabs } from "../utils/tab-utils";

type DialogId = "menu" | "help" | "theme" | "diff-blame" | "detail" | null;
type LayoutMode = "too-small" | "compact" | "normal";

interface KeyboardNavigationOptions {
  state: AppState;
  actions: AppActions;
  dialog: Accessor<DialogId>;
  setDialog: (d: DialogId) => void;
  /** Current adaptive layout mode — controls arrow key behavior and Enter in graph. */
  layoutMode: Accessor<LayoutMode>;
  searchFocused: Accessor<boolean>;
  setSearchFocused: (v: boolean) => void;
  /** Set the local search input value (independent of the active filter). */
  setSearchInputValue: (v: string) => void;
  /** Cancel the pending search debounce timer (for immediate clear on Esc). */
  clearSearchDebounce: () => void;
  /** Returns the current scrollbox ref (may be undefined before mount). */
  getDetailScrollboxRef: () => ScrollBoxRenderable | undefined;
  detailNavRef: DetailNavRef;
  /** Reload git data, optionally preserving scroll position via stickyHash. */
  loadData: (branch?: string, stickyHash?: string, silent?: boolean, preserveLoaded?: boolean) => void;
  /** Fetch from all remotes and reload data. */
  handleFetch: () => void;
}

/**
 * Global keyboard handler for the main app.
 *
 * Handles: dialog toggles (m, Ctrl+T, ?), escape/q cascade,
 * detail panel navigation, graph list navigation, and search focus.
 *
 * ## Search Phases
 *
 * **Phase 1 (typing)**: search bar focused, `searchConfirmed = false`.
 * The display shows the two-zone context window (anchor row pinned at top,
 * h-line divider, then all matches below). All keys except Escape and Enter
 * pass through to the input.
 *
 * **Phase 2 (browsing)**: search bar defocused, `searchConfirmed = true`.
 * The display shows only matching rows. Arrow keys navigate between matches.
 * Right arrow opens the detail panel. Esc clears the filter.
 */
export function useKeyboardNavigation(opts: KeyboardNavigationOptions): void {
  const {
    state,
    actions,
    dialog,
    setDialog,
    layoutMode,
    searchFocused,
    setSearchFocused,
    setSearchInputValue,
    clearSearchDebounce,
    getDetailScrollboxRef,
    detailNavRef,
    loadData,
    handleFetch,
  } = opts;

  const renderer = useRenderer();

  /**
   * Clear the search filter entirely and restore the cursor to its pre-search
   * position (or keep the currently selected commit in Phase 2).
   */
  const clearFilterAndRestore = (restoreHash?: string) => {
    clearSearchDebounce();
    setSearchInputValue("");
    actions.setSearchQuery("");
    actions.setSearchConfirmed(false);
    actions.setPreSearchCursorHash(null);
    if (restoreHash) {
      const rows = state.graphRows();
      const idx = rows.findIndex(r => r.commit.hash === restoreHash);
      if (idx >= 0) {
        actions.setCursorIndex(idx);
        actions.setPendingScrollHash(restoreHash);
        return;
      }
    }
    actions.setCursorIndex(0);
    actions.setScrollTargetIndex(0);
  };

  /**
   * Open the search bar (Phase 1). Saves the current cursor position
   * as the anchor for the two-zone context window.
   */
  const openSearch = () => {
    const currentHash = state.selectedCommit()?.hash ?? null;
    actions.setPreSearchCursorHash(currentHash);
    actions.setSearchConfirmed(false);
    actions.setDetailFocused(false);
    // Pre-fill with the current active query (empty if no filter)
    setSearchInputValue(state.searchQuery());
    setSearchFocused(true);
  };

  /**
   * Confirm the search (Enter from Phase 1 → Phase 2).
   * Defocuses the search bar and positions the cursor on the first match
   * (index 0) in the filtered list.
   */
  const confirmSearch = () => {
    const matches = state.searchMatchRows();
    if (matches.length === 0) return; // nothing to confirm

    setSearchFocused(false);
    actions.setSearchConfirmed(true);

    // Always go to the first (top) match
    actions.setCursorIndex(0);
    actions.setScrollTargetIndex(0);
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;

    // Ctrl+T opens theme dialog regardless of dialog/search state
    if (e.ctrl && e.name === "t") {
      setSearchFocused(false);
      const opening = dialog() !== "theme";
      if (opening) actions.setDetailFocused(false);
      setDialog(opening ? "theme" : null);
      return;
    }

    // m toggles menu (not when typing in search)
    if (e.name === "m" && !searchFocused()) {
      setSearchFocused(false);
      const opening = dialog() !== "menu";
      if (opening) actions.setDetailFocused(false);
      setDialog(opening ? "menu" : null);
      return;
    }

    // ? opens help (not when typing in search)
    if (e.name === "?" && !searchFocused()) {
      setSearchFocused(false);
      const opening = dialog() !== "help";
      if (opening) actions.setDetailFocused(false);
      setDialog(opening ? "help" : null);
      return;
    }

    /**
     * Close the topmost open layer (dialog → search → detail focus → filter → branch).
     * Returns true if something was closed, false if there was nothing left to close.
     * Used by both Escape and q to share the same cascade logic.
     */
    const closeOneCascadeStep = (skipSearch = false): boolean => {
      if (dialog()) {
        // Closing the detail dialog must also clear detailFocused
        if (dialog() === "detail") {
          actions.setDetailFocused(false);
          setDialog(null);
        } else if (dialog() === "diff-blame" && layoutMode() === "compact" && state.detailFocused()) {
          // In compact mode, closing diff-blame returns to the detail dialog
          setDialog("detail");
        } else {
          setDialog(null);
        }
        return true;
      }
      if (!skipSearch && searchFocused()) {
        // Phase 1: close search bar, clear filter, restore pre-search cursor
        setSearchFocused(false);
        clearFilterAndRestore(state.preSearchCursorHash() ?? undefined);
        return true;
      }
      if (state.detailFocused()) {
        actions.setDetailFocused(false);
        return true;
      }
      if (state.searchQuery()) {
        // Phase 2 (graph focused + filter active): clear filter, keep cursor
        // on the currently selected commit
        clearFilterAndRestore(state.selectedCommit()?.hash ?? undefined);
        return true;
      }
      if (state.viewingBranch()) {
        actions.setViewingBranch(null);
        loadData();
        return true;
      }
      return false;
    };

    // Escape handling
    if (e.name === "escape") {
      closeOneCascadeStep();
      return;
    }

    // q: same cascade as Escape, but quits if nothing left to close
    if (e.name === "q" && !searchFocused()) {
      if (!closeOneCascadeStep(/* skipSearch */ true)) {
        // Nothing to close — quit.
        // renderer.destroy() restores the terminal and resolves the render()
        // promise, letting the process exit cleanly via the event loop.
        // Avoid process.exit() here as it would bypass onCleanup handlers.
        renderer.destroy();
      }
    }

    // Enter while search bar is focused: confirm search → Phase 2
    if (e.name === "return" && searchFocused()) {
      e.preventDefault();
      confirmSearch();
      return;
    }

    // All other keys while search bar is focused: let the input handle them.
    // This includes arrow keys (text cursor navigation), backspace, etc.
    if (searchFocused()) return;

    // If a non-detail dialog is open, only handle Escape/q/m/? (handled above)
    if (dialog() && dialog() !== "detail") return;

    // Detail panel focused (or detail dialog open in compact mode):
    // up/down navigate interactive items, enter activates,
    // left/right switch tabs (left on first tab exits detail focus / closes dialog)
    if (state.detailFocused() || dialog() === "detail") {
      const scrollbox = getDetailScrollboxRef();

      switch (e.name) {
        case "left": {
          e.preventDefault();
          const tabs = getAvailableTabs({
            commit: state.selectedCommit(),
            uncommittedDetail: state.uncommittedDetail(),
            commitDetail: state.commitDetail(),
            stashByParent: state.stashByParent(),
          });
          const currentIdx = tabs.indexOf(state.detailActiveTab());
          if (currentIdx <= 0) {
            // In normal mode, left on first tab exits detail focus.
            // In dialog mode, only esc/q can close — left does nothing.
            if (dialog() !== "detail") {
              actions.setDetailFocused(false);
            }
          } else {
            actions.setDetailCursorAction(null);
            actions.setDetailActiveTab(tabs[currentIdx - 1]);
            actions.setDetailCursorIndex(0);
            scrollbox?.scrollTo(0);
          }
          return;
        }
        case "right": {
          e.preventDefault();
          const tabs = getAvailableTabs({
            commit: state.selectedCommit(),
            uncommittedDetail: state.uncommittedDetail(),
            commitDetail: state.commitDetail(),
            stashByParent: state.stashByParent(),
          });
          const currentIdx = tabs.indexOf(state.detailActiveTab());
          if (currentIdx < tabs.length - 1) {
            actions.setDetailCursorAction(null);
            actions.setDetailActiveTab(tabs[currentIdx + 1]);
            actions.setDetailCursorIndex(0);
            scrollbox?.scrollTo(0);
          }
          // On rightmost tab, do nothing
          return;
        }
        case "up": {
          e.preventDefault();
          const delta = e.shift ? -SHIFT_JUMP : -1;
          actions.moveDetailCursor(delta, detailNavRef.itemCount);
          scrollbox?.scrollBy(delta, "absolute");
          return;
        }
        case "down": {
          e.preventDefault();
          const delta = e.shift ? SHIFT_JUMP : 1;
          actions.moveDetailCursor(delta, detailNavRef.itemCount);
          scrollbox?.scrollBy(delta, "absolute");
          return;
        }
        case "return":
          e.preventDefault();
          detailNavRef.activateCurrentItem();
          return;
        case "pageup":
          e.preventDefault();
          scrollbox?.scrollBy(-0.5, "viewport");
          return;
        case "pagedown":
          e.preventDefault();
          scrollbox?.scrollBy(0.5, "viewport");
          return;
        case "g":
          e.preventDefault();
          if (!e.shift) {
            actions.setDetailCursorIndex(0);
            scrollbox?.scrollTo(0);
          } else {
            const lastIdx = detailNavRef.itemCount - 1;
            actions.setDetailCursorIndex(Math.max(0, lastIdx));
            scrollbox?.scrollTo(Infinity);
          }
          return;
        case "/":
          e.preventDefault();
          openSearch();
          return;
      }
      return; // swallow all other keys when detail is focused
    }

    const scrollbox = getDetailScrollboxRef();

    /** Reset detail scrollbox to top — called when the graph cursor moves. */
    const resetDetailScroll = () => scrollbox?.scrollTo(0);

    switch (e.name) {
      case "down":
        e.preventDefault();
        actions.moveCursor(e.shift ? SHIFT_JUMP : 1);
        resetDetailScroll();
        break;
      case "up":
        e.preventDefault();
        actions.moveCursor(e.shift ? -SHIFT_JUMP : -1);
        resetDetailScroll();
        break;
      case "right":
        // Disabled in compact/too-small — no side panel to enter
        if (layoutMode() !== "normal") break;
        e.preventDefault();
        if (state.selectedCommit()) {
          detailNavRef.pendingJumpDirection = null;
          actions.setDetailCursorIndex(0);
          actions.setDetailFocused(true);
        }
        break;
      case "left":
        // Disabled in compact/too-small — no panel tab to re-center
        if (layoutMode() !== "normal") break;
        e.preventDefault();
        // Re-center scroll on current cursor position
        actions.setScrollTargetIndex(state.cursorIndex());
        break;
      case "return":
        // In compact mode, Enter opens the detail dialog
        if (layoutMode() === "compact" && state.selectedCommit()) {
          e.preventDefault();
          actions.setDetailCursorIndex(0);
          actions.setDetailFocused(true);
          setDialog("detail");
        }
        break;
      case "g":
        e.preventDefault();
        if (!e.shift) {
          actions.setCursorIndex(0);
          actions.setScrollTargetIndex(0);
        } else {
          const lastIdx = state.filteredRows().length - 1;
          actions.setCursorIndex(lastIdx);
          actions.setScrollTargetIndex(lastIdx);
        }
        resetDetailScroll();
        break;
      case "pagedown":
        e.preventDefault();
        actions.moveCursor(PAGE_JUMP);
        resetDetailScroll();
        break;
      case "pageup":
        e.preventDefault();
        actions.moveCursor(-PAGE_JUMP);
        resetDetailScroll();
        break;
      case "/":
        e.preventDefault();
        openSearch();
        break;
      case "r":
        // Shift+R = Reload
        if (e.shift && !e.ctrl) {
          const stickyHash = state.selectedCommit()?.hash;
          loadData(undefined, stickyHash, false, true);
        }
        break;
      case "f":
        handleFetch();
        break;
    }
  });
}
