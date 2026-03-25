import { useKeyboard, useRenderer } from "@opentui/solid";
import type { Accessor } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { AppState, AppActions } from "../context/state";
import type { DetailNavRef } from "../components/detail";
import { SHIFT_JUMP, PAGE_JUMP } from "../constants";

type DialogId = "branch" | "help" | "theme" | "settings" | null;

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
}

/**
 * Global keyboard handler for the main app.
 *
 * Handles: dialog toggles (Ctrl+S, Ctrl+T, F1), refresh (F5), escape,
 * detail panel navigation, graph list navigation, search focus, and
 * branch dialog shortcuts.
 */
export function useKeyboardNavigation(opts: KeyboardNavigationOptions): void {
  const {
    state, actions,
    dialog, setDialog,
    searchFocused, setSearchFocused,
    getDetailScrollboxRef, detailNavRef,
    loadData,
  } = opts;

  const renderer = useRenderer();

  useKeyboard((e) => {
    if (e.eventType === "release") return;

    // Ctrl+S opens settings regardless of dialog/search state
    if (e.ctrl && e.name === "s") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "settings" ? null : "settings");
      return;
    }

    // Ctrl+Q quits the application
    if (e.ctrl && e.name === "q") {
      renderer.destroy();
      process.exit(0);
    }

    // Ctrl+T opens theme dialog regardless of dialog/search state
    if (e.ctrl && e.name === "t") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "theme" ? null : "theme");
      return;
    }

    // Ctrl+H opens help regardless of dialog/search state
    if (e.ctrl && e.name === "h") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "help" ? null : "help");
      return;
    }

    // Ctrl+R refreshes git data, preserving scroll position
    if (e.ctrl && e.name === "r") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      if (dialog()) setDialog(null);
      const stickyHash = state.selectedCommit()?.hash;
      loadData(undefined, stickyHash);
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
      return;
    }

    // If search input is focused, let the input handle all other keys
    if (searchFocused()) return;

    // If a dialog is open, only handle Escape (handled above)
    if (dialog()) return;

    // Detail panel focused: up/down navigate interactive items, enter activates
    if (state.detailFocused()) {
      const scrollbox = getDetailScrollboxRef();
      switch (e.name) {
        case "left":
          e.preventDefault();
          actions.setDetailFocused(false);
          return;
        case "up":
          e.preventDefault();
          actions.moveDetailCursor(-1, detailNavRef.itemCount);
          scrollbox?.scrollBy(-1, "absolute");
          return;
        case "down":
          e.preventDefault();
          actions.moveDetailCursor(1, detailNavRef.itemCount);
          scrollbox?.scrollBy(1, "absolute");
          return;
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
      }
      return; // swallow all other keys when detail is focused
    }

    const scrollbox = getDetailScrollboxRef();

    switch (e.name) {
      case "down":
        e.preventDefault();
        actions.moveCursor(e.shift ? SHIFT_JUMP : 1);
        scrollbox?.scrollTo(0);
        break;
      case "up":
        e.preventDefault();
        actions.moveCursor(e.shift ? -SHIFT_JUMP : -1);
        scrollbox?.scrollTo(0);
        break;
      case "return":
        e.preventDefault();
        // Reset detail scroll to top when selecting a new commit
        scrollbox?.scrollTo(0);
        break;
      case "right":
        e.preventDefault();
        if (state.selectedCommit()) {
          actions.setDetailOriginHash(null);
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
        scrollbox?.scrollTo(0);
        break;
      case "pagedown":
        e.preventDefault();
        actions.moveCursor(PAGE_JUMP);
        scrollbox?.scrollTo(0);
        break;
      case "pageup":
        e.preventDefault();
        actions.moveCursor(-PAGE_JUMP);
        scrollbox?.scrollTo(0);
        break;
      case "/":
        actions.setDetailFocused(false);
        setSearchFocused(true);
        break;
      case "b":
        actions.setDetailFocused(false);
        setDialog("branch");
        break;
      case "a": {
        const newAll = !state.showAllBranches();
        actions.setShowAllBranches(newAll);
        loadData(newAll ? undefined : state.currentBranch());
        break;
      }
    }
  });
}
