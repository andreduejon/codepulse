/**
 * handleCommandBarKeys — processes key events while the command bar is active.
 *
 * Covers three modes:
 *   - "command" : user types a command and presses Enter to execute it
 *   - "path"    : user types a path and presses Enter to apply the filter
 *   - "search"  : user types a search query; Enter applies, Esc cancels edits
 *
 * Returns true when the key was consumed and the caller should stop processing.
 */
import type { KeyEvent } from "@opentui/core";
import type { AppActions, AppState } from "../context/state";
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
  onSearchExecute: (query: string) => void;
  onClearAncestry: () => void;
}

/** Build the helper closures that operate on command-bar state. */
export function createCommandBarHelpers(opts: CommandBarKeyOptions) {
  const { actions, setCommandBarMode, setCommandBarValue, setSearchFocused, setSearchInputValue, clearSearchDebounce } =
    opts;

  /** Clear the search filter entirely. */
  const clearSearch = () => {
    clearSearchDebounce();
    setSearchInputValue("");
    actions.setSearchQuery("");
  };

  /** Return to idle mode, clearing any command bar input. */
  const exitCommandBar = () => {
    setSearchFocused(false);
    setCommandBarMode("idle");
    setCommandBarValue("");
  };

  return { clearSearch, exitCommandBar };
}

export type CommandBarHelpers = ReturnType<typeof createCommandBarHelpers>;

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
  opts: Pick<CommandBarKeyOptions, "commandBarMode" | "searchInputValue" | "onSearchExecute">,
  helpers: Pick<CommandBarHelpers, "exitCommandBar">,
): boolean {
  const { commandBarMode, searchInputValue, onSearchExecute } = opts;

  if (commandBarMode() !== "search") return false;

  if (e.name === "escape") {
    helpers.exitCommandBar();
    return true;
  }
  if (e.name === "return") {
    e.preventDefault();
    onSearchExecute(searchInputValue().trim());
    helpers.exitCommandBar();
    return true;
  }
  // All other keys pass to the native <input> while focused
  return true;
}
