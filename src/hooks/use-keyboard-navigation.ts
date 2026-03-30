import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { Accessor } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import { PAGE_JUMP, SHIFT_JUMP, UNCOMMITTED_HASH } from "../constants";
import type { AppActions, AppState, DetailTab } from "../context/state";

type DialogId = "menu" | "help" | "theme" | null;

interface KeyboardNavigationOptions {
  state: AppState;
  actions: AppActions;
  dialog: Accessor<DialogId>;
  setDialog: (d: DialogId) => void;
  searchFocused: Accessor<boolean>;
  setSearchFocused: (v: boolean) => void;
  /** Returns the current scrollbox ref (may be undefined before mount). */
  getDetailScrollboxRef: () => ScrollBoxRenderable | undefined;
  detailNavRef: DetailNavRef;
  /** Reload git data, optionally preserving scroll position via stickyHash. */
  loadData: (branch?: string, stickyHash?: string) => void;
  /** Fetch from all remotes and reload data. */
  handleFetch: () => void;
}

/**
 * Global keyboard handler for the main app.
 *
 * Handles: dialog toggles (m, Ctrl+T, ?), escape/q cascade,
 * detail panel navigation, graph list navigation, and search focus.
 */
export function useKeyboardNavigation(opts: KeyboardNavigationOptions): void {
  const {
    state,
    actions,
    dialog,
    setDialog,
    searchFocused,
    setSearchFocused,
    getDetailScrollboxRef,
    detailNavRef,
    loadData,
    handleFetch,
  } = opts;

  const renderer = useRenderer();

  useKeyboard(e => {
    if (e.eventType === "release") return;

    // Ctrl+T opens theme dialog regardless of dialog/search state
    if (e.ctrl && e.name === "t") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "theme" ? null : "theme");
      return;
    }

    // m toggles menu (not when typing in search)
    if (e.name === "m" && !searchFocused()) {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "menu" ? null : "menu");
      return;
    }

    // ? opens help (not when typing in search)
    if (e.name === "?" && !searchFocused()) {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "help" ? null : "help");
      return;
    }

    // Escape handling
    if (e.name === "escape") {
      if (dialog()) {
        setDialog(null);
        return;
      }
      if (state.detailFocused()) {
        actions.setDetailFocused(false);
        return;
      }
      if (searchFocused()) {
        setSearchFocused(false);
        return;
      }
      if (state.searchQuery()) {
        actions.setSearchQuery("");
        actions.setCursorIndex(0);
        actions.setScrollTargetIndex(0);
        return;
      }
      if (state.viewingBranch()) {
        actions.setViewingBranch(null);
        loadData();
        return;
      }
      return;
    }

    // q: same cascade as Escape, but quits if nothing left to close
    if (e.name === "q" && !searchFocused()) {
      if (dialog()) {
        setDialog(null);
        return;
      }
      if (state.detailFocused()) {
        actions.setDetailFocused(false);
        return;
      }
      if (state.searchQuery()) {
        actions.setSearchQuery("");
        actions.setCursorIndex(0);
        actions.setScrollTargetIndex(0);
        return;
      }
      if (state.viewingBranch()) {
        actions.setViewingBranch(null);
        loadData();
        return;
      }
      // Nothing to close — quit.
      // renderer.destroy() restores the terminal and resolves the render()
      // promise, letting the process exit cleanly via the event loop.
      // Avoid process.exit() here as it would bypass onCleanup handlers.
      renderer.destroy();
    }

    // If search input is focused, let the input handle all other keys
    if (searchFocused()) return;

    // If a dialog is open, only handle Escape/q/m/? (handled above)
    if (dialog()) return;

    // Detail panel focused: up/down navigate interactive items, enter activates,
    // left/right switch tabs (left on first tab exits detail focus)
    if (state.detailFocused()) {
      const scrollbox = getDetailScrollboxRef();

      /** Get navigable (non-empty) tab IDs based on commit type */
      const getAvailableTabs = (): DetailTab[] => {
        const commit = state.selectedCommit();
        if (commit?.hash === UNCOMMITTED_HASH) {
          const ud = state.uncommittedDetail();
          const tabs: DetailTab[] = [];
          if (ud && ud.unstaged.length > 0) tabs.push("unstaged");
          if (ud && ud.staged.length > 0) tabs.push("staged");
          if (ud && ud.untracked.length > 0) tabs.push("untracked");
          return tabs;
        }
        const tabs: DetailTab[] = [];
        const cd = state.commitDetail();
        if (cd && cd.files.length > 0) {
          tabs.push("files");
        }
        if (state.stashByParent().has(commit?.hash ?? "")) {
          tabs.push("stashes");
        }
        tabs.push("detail");
        return tabs;
      };

      switch (e.name) {
        case "left": {
          e.preventDefault();
          const tabs = getAvailableTabs();
          const currentIdx = tabs.indexOf(state.detailActiveTab());
          if (currentIdx <= 0) {
            // Already on leftmost tab (or unknown tab) — exit detail focus
            actions.setDetailFocused(false);
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
          const tabs = getAvailableTabs();
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
        e.preventDefault();
        if (state.selectedCommit()) {
          detailNavRef.pendingJumpDirection = null;
          actions.setDetailCursorIndex(0);
          actions.setDetailFocused(true);
        }
        break;
      case "left":
        e.preventDefault();
        // Re-center scroll on current cursor position
        actions.setScrollTargetIndex(state.cursorIndex());
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
        actions.setDetailFocused(false);
        setSearchFocused(true);
        break;
      case "r":
        // Shift+R = Reload
        if (e.shift && !e.ctrl) {
          const stickyHash = state.selectedCommit()?.hash;
          loadData(undefined, stickyHash);
        }
        break;
      case "f":
        handleFetch();
        break;
    }
  });
}
