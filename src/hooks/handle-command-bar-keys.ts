/**
 * handleCommandBarKeys — processes key events while the command bar is active.
 *
 * Covers three modes:
 *   - "command" : user types a command and presses Enter to execute it
 *   - "path"    : user types a path and presses Enter to apply the filter
 *   - "search"  : user types a search query; Enter confirms, Esc clears
 *
 * Returns true when the key was consumed and the caller should stop processing.
 */
import type { KeyEvent } from "@opentui/core";
import type { AppActions, AppState } from "../context/state";
import { computeDisplacedIndex } from "../utils/keyboard-nav-utils";
import type { CommandBarMode } from "./use-keyboard-navigation";

export interface CommandBarKeyOptions {
  state: AppState;
  actions: AppActions;
  commandBarMode: () => CommandBarMode;
  setCommandBarMode: (m: CommandBarMode) => void;
  commandBarValue: () => string;
  setCommandBarValue: (v: string) => void;
  searchFocused: () => boolean;
  setSearchFocused: (v: boolean) => void;
  searchInputValue: () => string;
  setSearchInputValue: (v: string) => void;
  clearSearchDebounce: () => void;
  onCommandExecute: (cmd: string) => void;
  onPathExecute: (pathValue: string) => void;
  onClearAncestry: () => void;
}

/** Build the helper closures that operate on command-bar state. */
export function createCommandBarHelpers(opts: CommandBarKeyOptions) {
  const {
    actions,
    state,
    setCommandBarMode,
    setCommandBarValue,
    setSearchFocused,
    setSearchInputValue,
    clearSearchDebounce,
    onClearAncestry,
  } = opts;

  /** Clear the search filter entirely. */
  const clearSearch = () => {
    clearSearchDebounce();
    setSearchInputValue("");
    actions.setSearchQuery("");
  };

  /** Open the search bar. Clears other highlight modes (mutual exclusivity). */
  const openSearch = () => {
    actions.setDetailFocused(false);
    // Mutual exclusion: clear ancestry and path
    onClearAncestry();
    actions.setPathFilter(null);
    actions.setPathMatchSet(null);
    // Pre-fill with the current active query (empty if no filter)
    setSearchInputValue(state.searchQuery());
    setCommandBarMode("search");
    setSearchFocused(true);
  };

  /**
   * If the cursor is on a dimmed (non-highlighted) row, jump to the nearest
   * highlighted row. Prefers forward direction, falls back to backward.
   */
  const displaceIfDimmed = () => {
    const target = computeDisplacedIndex(state.graphRows(), state.highlightSet(), state.cursorIndex());
    if (target !== state.cursorIndex()) {
      actions.setCursorIndex(target);
      actions.setScrollTargetIndex(target);
    }
  };

  /**
   * Confirm the search (Enter in search mode).
   * Closes the search bar but keeps the highlight active.
   */
  const confirmSearch = () => {
    setSearchFocused(false);
    setCommandBarMode("idle");
    // searchQuery stays set — highlighting persists via highlightSet
    // If cursor is on a dimmed row, jump to the nearest match
    displaceIfDimmed();
  };

  /** Return to idle mode, clearing any command bar input. */
  const exitCommandBar = () => {
    setCommandBarMode("idle");
    setCommandBarValue("");
  };

  return { clearSearch, openSearch, confirmSearch, exitCommandBar };
}

export type CommandBarHelpers = ReturnType<typeof createCommandBarHelpers>;

/**
 * Handle Shift+←/→ mode cycling.
 * Returns true if the key was consumed.
 */
export function handleModeCycling(e: KeyEvent, opts: CommandBarKeyOptions, helpers: CommandBarHelpers): boolean {
  const {
    state,
    commandBarMode,
    setCommandBarMode,
    setCommandBarValue,
    searchFocused,
    onClearAncestry,
    onCommandExecute,
  } = opts;
  const { clearSearch, openSearch, exitCommandBar } = helpers;

  if (!e.shift || (e.name !== "left" && e.name !== "right")) return false;
  if (state.detailFocused()) return false;

  e.preventDefault();
  type CycleMode = CommandBarMode | "ancestry";
  const modes: CycleMode[] = ["idle", "command", "search", "path", "ancestry"];
  // Determine the effective current position
  const isAncestry = commandBarMode() === "idle" && state.ancestrySet() !== null;
  const cur = isAncestry ? modes.indexOf("ancestry") : modes.indexOf(commandBarMode());
  const delta = e.name === "right" ? 1 : -1;
  const nextMode = modes[(cur + delta + modes.length) % modes.length];

  // Clear previous mode state
  if (isAncestry) onClearAncestry();
  if (searchFocused()) {
    opts.setSearchFocused(false);
    clearSearch();
  }
  if (commandBarMode() !== "idle") exitCommandBar();

  // Enter the new mode
  if (nextMode === "search") {
    openSearch();
  } else if (nextMode === "ancestry") {
    onCommandExecute("ancestry");
  } else if (nextMode !== "idle") {
    setCommandBarMode(nextMode);
    setCommandBarValue("");
  }
  return true;
}

/**
 * Handle key events while in "command" or "path" mode.
 * Returns true if the key was consumed.
 */
export function handleCommandOrPathKey(
  e: KeyEvent,
  opts: Pick<CommandBarKeyOptions, "commandBarMode" | "commandBarValue" | "onCommandExecute" | "onPathExecute">,
  helpers: Pick<CommandBarHelpers, "exitCommandBar">,
): boolean {
  const { commandBarMode, commandBarValue, onCommandExecute, onPathExecute } = opts;
  const { exitCommandBar } = helpers;

  if (commandBarMode() !== "command" && commandBarMode() !== "path") return false;

  if (e.name === "escape") {
    exitCommandBar();
    return true;
  }
  if (e.name === "return") {
    e.preventDefault();
    const value = commandBarValue().trim();
    if (commandBarMode() === "path") {
      onPathExecute(value);
      exitCommandBar();
    } else {
      // Execute BEFORE exitCommandBar so setDialog() fires before blur's requestRender.
      if (value) onCommandExecute(value);
      // Only exit if the command didn't transition to another mode itself
      if (commandBarMode() === "command") exitCommandBar();
    }
    return true;
  }
  // All other keys pass through to the native <input> widget
  return true;
}

/**
 * Handle key events while in "search" mode.
 * Returns true if the key was consumed.
 */
export function handleSearchKey(
  e: KeyEvent,
  opts: Pick<CommandBarKeyOptions, "commandBarMode" | "searchFocused" | "setSearchFocused" | "searchInputValue">,
  helpers: Pick<CommandBarHelpers, "clearSearch" | "confirmSearch">,
  setCommandBarMode: (m: CommandBarMode) => void,
): boolean {
  const { commandBarMode, searchFocused, setSearchFocused, searchInputValue } = opts;
  const { clearSearch, confirmSearch } = helpers;

  if (commandBarMode() !== "search") return false;

  if (e.name === "escape") {
    setSearchFocused(false);
    clearSearch();
    setCommandBarMode("idle");
    return true;
  }
  if (e.name === "return" && searchFocused()) {
    e.preventDefault();
    if (!searchInputValue().trim()) {
      setSearchFocused(false);
      clearSearch();
      setCommandBarMode("idle");
    } else {
      confirmSearch();
    }
    return true;
  }
  // All other keys pass to the native <input> while focused
  return true;
}
