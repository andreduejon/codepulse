import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import type { Accessor } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import type { AppActions, AppState } from "../context/state";
import { createCloseOneCascadeStep } from "./handle-cascade-close";
import {
  createCommandBarHelpers,
  handleCommandOrPathKey,
  handleModeCycling,
  handleSearchKey,
} from "./handle-command-bar-keys";
import { handleDetailKey } from "./handle-detail-keys";
import { handleGraphKey } from "./handle-graph-keys";

export type DialogId = "menu" | "help" | "theme" | "diff-blame" | "detail" | "job-log" | null;
type LayoutMode = "too-small" | "compact" | "normal";

/** Command bar mode — drives placeholder text and key routing. */
export type CommandBarMode = "idle" | "command" | "search" | "path";

interface KeyboardNavigationOptions {
  state: AppState;
  actions: AppActions;
  dialog: Accessor<DialogId>;
  setDialog: (d: DialogId) => void;
  /** Current adaptive layout mode — controls arrow key behavior and Enter in graph. */
  layoutMode: Accessor<LayoutMode>;
  searchFocused: Accessor<boolean>;
  setSearchFocused: (v: boolean) => void;
  /** Current search input value (the raw text in the input, before debounce). */
  searchInputValue: Accessor<string>;
  /** Set the local search input value (independent of the active filter). */
  setSearchInputValue: (v: string) => void;
  /** Cancel the pending search debounce timer (for immediate clear on Esc). */
  clearSearchDebounce: () => void;
  /** Returns the current scrollbox ref (may be undefined before mount). */
  getDetailScrollboxRef: () => ScrollBoxRenderable | undefined;
  detailNavRef: DetailNavRef;
  /** Reload git data, optionally preserving scroll position via stickyHash. */
  loadData: (branch?: string, stickyHash?: string, silent?: boolean, preserveLoaded?: boolean) => void;
  /** Load more commits (pagination) — triggered when highlight navigation reaches the end of loaded data. */
  loadMoreData: () => void;
  /** Fetch from all remotes and reload data. */
  handleFetch: () => void;
  /** Current command bar mode. */
  commandBarMode: Accessor<CommandBarMode>;
  setCommandBarMode: (m: CommandBarMode) => void;
  /** Raw text typed into the command bar. */
  commandBarValue: Accessor<string>;
  setCommandBarValue: (v: string) => void;
  /** Callback to execute a command (dispatched from the keyboard handler). */
  onCommandExecute: (cmd: string) => void;
  /** Callback to apply a path filter (dispatched when Enter is pressed in path mode). */
  onPathExecute: (pathValue: string) => void;
  /** Callback to clear ancestry highlighting (called when search opens or on Esc). */
  onClearAncestry: () => void;
  /** CI data getter — forwarded to handleDetailKey for tab availability checks. */
  getCommitData?: (sha: string) => unknown;
  /** Returns true while the initial CI fetch is in-flight. */
  getProviderLoading?: () => boolean;
}

/**
 * Global keyboard handler for the main app.
 *
 * ## Command Bar
 *
 * `:` opens COMMAND mode. User types a command and presses Enter to execute.
 * `/` opens SEARCH mode directly (bypasses command bar). `:search` also opens SEARCH.
 * `:path` (or `:p`) opens PATH mode — type a path, Enter applies.
 *
 * ## Navigation (bare keys)
 *
 * `↑/↓`, `j/k` — navigate 1 row (Shift = 10 rows)
 * `←/→`, `h/l` — switch focus / navigate tabs
 * `g/G` — jump to top/bottom (when highlight is active: first/last highlighted)
 * `Enter` — open/confirm/activate
 * `Esc` — close/back/cancel cascade
 *
 * ## Unified Highlighting
 *
 * Search, ancestry, and path are mutually exclusive highlighting modes.
 * When any is active, j/k skip dimmed rows (jump to next/prev highlighted).
 * Esc clears the active highlight mode.
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
    searchInputValue,
    setSearchInputValue,
    clearSearchDebounce,
    getDetailScrollboxRef,
    detailNavRef,
    loadData,
    loadMoreData,
    commandBarMode,
    setCommandBarMode,
    commandBarValue,
    setCommandBarValue,
    onCommandExecute,
    onPathExecute,
    onClearAncestry,
    getCommitData,
    getProviderLoading,
  } = opts;

  // Build command-bar helpers (clearSearch, openSearch, confirmSearch, exitCommandBar)
  const cbOpts = {
    state,
    actions,
    commandBarMode,
    setCommandBarMode,
    commandBarValue,
    setCommandBarValue,
    searchFocused,
    setSearchFocused,
    searchInputValue,
    setSearchInputValue,
    clearSearchDebounce,
    onCommandExecute,
    onPathExecute,
    onClearAncestry,
  };
  const helpers = createCommandBarHelpers(cbOpts);
  const { clearSearch, exitCommandBar } = helpers;

  // Build cascade-close step
  const closeOneCascadeStep = createCloseOneCascadeStep({
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
  });

  useKeyboard(e => {
    if (e.eventType === "release") return;

    // ── Shift+←/→ mode cycling ────────────────────────────────────────────────
    if (handleModeCycling(e, cbOpts, helpers)) return;

    // ── COMMAND / PATH mode ───────────────────────────────────────────────────
    if (handleCommandOrPathKey(e, cbOpts, helpers)) return;

    // ── SEARCH mode ───────────────────────────────────────────────────────────
    if (handleSearchKey(e, cbOpts, helpers, setCommandBarMode)) return;

    // ── IDLE mode (no dialog, no search bar open) ───────────────────────────

    // `:` opens COMMAND mode
    if (e.sequence === ":" && !searchFocused()) {
      e.preventDefault();
      setCommandBarMode("command");
      setCommandBarValue("");
      return;
    }

    // `/` opens SEARCH mode directly
    if (e.name === "/" && !searchFocused()) {
      e.preventDefault();
      helpers.openSearch();
      return;
    }

    // Escape cascade
    if (e.name === "escape") {
      closeOneCascadeStep();
      return;
    }

    // All other keys while search bar is focused: let the input handle them.
    if (searchFocused()) return;

    // If a non-detail dialog is open, only Escape acts (handled above)
    if (dialog() && dialog() !== "detail") return;

    // ── Global single-key shortcuts ─────────────────────────────────────────
    if (e.name === "tab") {
      e.preventDefault();
      actions.cycleProviderView();
      return;
    }
    if (e.name === "q") {
      e.preventDefault();
      onCommandExecute("quit");
      return;
    }
    if (e.name === "m") {
      e.preventDefault();
      onCommandExecute("menu");
      return;
    }
    if (e.name === "f" && !e.shift) {
      e.preventDefault();
      onCommandExecute("fetch");
      return;
    }
    if (e.sequence === "?") {
      e.preventDefault();
      onCommandExecute("help");
      return;
    }

    // ── Detail panel focused (or detail dialog open in compact mode) ─────────
    if (
      handleDetailKey(e, {
        state,
        actions,
        dialog,
        getDetailScrollboxRef,
        detailNavRef,
        getCommitData,
        getProviderLoading,
      })
    )
      return;

    // ── Graph navigation ─────────────────────────────────────────────────────
    handleGraphKey(e, {
      state,
      actions,
      layoutMode,
      setDialog,
      getDetailScrollboxRef,
      detailNavRef,
      loadMoreData,
      onCommandExecute,
      setCommandBarMode,
      setCommandBarValue,
    });
  });
}
