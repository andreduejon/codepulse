import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import type { Accessor } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import { ANCESTRY_PRELOAD_ROWS, SHIFT_JUMP } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { scrollElementIntoView } from "../utils/scroll";
import { getAvailableTabs } from "../utils/tab-utils";

type DialogId = "menu" | "help" | "theme" | "diff-blame" | "detail" | null;
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
  } = opts;

  /**
   * Clear the search filter entirely.
   */
  const clearSearch = () => {
    clearSearchDebounce();
    setSearchInputValue("");
    actions.setSearchQuery("");
  };

  /**
   * Open the search bar. Clears other highlight modes (mutual exclusivity).
   */
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
    const hSet = state.highlightSet();
    if (!hSet || hSet.size === 0) return;
    const rows = state.graphRows();
    const curIdx = state.cursorIndex();
    if (curIdx < rows.length && hSet.has(rows[curIdx].commit.hash)) return; // already on a match

    // Search forward first, then backward
    let fwd = -1;
    for (let i = curIdx + 1; i < rows.length; i++) {
      if (hSet.has(rows[i].commit.hash)) {
        fwd = i;
        break;
      }
    }
    let bwd = -1;
    for (let i = curIdx - 1; i >= 0; i--) {
      if (hSet.has(rows[i].commit.hash)) {
        bwd = i;
        break;
      }
    }

    let target: number;
    if (fwd >= 0 && bwd >= 0) {
      // Pick the closer one; on tie prefer forward
      target = curIdx - bwd <= fwd - curIdx ? bwd : fwd;
    } else {
      target = fwd >= 0 ? fwd : bwd;
    }

    if (target >= 0) {
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

  /**
   * Return to idle mode, clearing any command bar input.
   */
  const exitCommandBar = () => {
    setCommandBarMode("idle");
    setCommandBarValue("");
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;

    // ── Shift+←/→ mode cycling ────────────────────────────────────────────────
    // Cycles through: idle → command → search → path → ancestry.
    // Only when the graph is the active context (no dialog open, detail not focused).
    if (e.shift && (e.name === "left" || e.name === "right") && !dialog() && !state.detailFocused()) {
      e.preventDefault();
      type CycleMode = CommandBarMode | "ancestry";
      const modes: CycleMode[] = ["idle", "command", "search", "path", "ancestry"];
      // Determine the effective current position — ancestry is active when
      // the command bar is idle and ancestrySet is non-null.
      const isAncestry = commandBarMode() === "idle" && state.ancestrySet() !== null;
      const cur = isAncestry ? modes.indexOf("ancestry") : modes.indexOf(commandBarMode());
      const delta = e.name === "right" ? 1 : -1;
      const nextMode = modes[(cur + delta + modes.length) % modes.length];

      // Clear previous mode state
      if (isAncestry) onClearAncestry();
      if (searchFocused()) {
        setSearchFocused(false);
        clearSearch();
      }
      if (commandBarMode() !== "idle") exitCommandBar();

      // Enter the new mode
      if (nextMode === "idle") {
        // Already cleared above
      } else if (nextMode === "search") {
        openSearch();
      } else if (nextMode === "ancestry") {
        onCommandExecute("ancestry");
      } else {
        setCommandBarMode(nextMode);
        setCommandBarValue("");
      }
      return;
    }

    // ── COMMAND mode ──────────────────────────────────────────────────────────
    // When the command bar is open in COMMAND or PATH mode, route keys there.
    if (commandBarMode() === "command" || commandBarMode() === "path") {
      if (e.name === "escape") {
        exitCommandBar();
        return;
      }
      if (e.name === "return") {
        e.preventDefault();
        const value = commandBarValue().trim();
        if (commandBarMode() === "path") {
          // Path mode: apply the typed text as a path filter (empty = clear).
          onPathExecute(value);
          exitCommandBar();
        } else {
          // Command mode: dispatch the typed command.
          // Execute BEFORE exitCommandBar so setDialog() fires before blur's requestRender.
          // For commands that set a new mode (e.g. :search, :path), onCommandExecute
          // will set commandBarMode away from "command" — exitCommandBar detects this
          // and skips the redundant mode change.
          if (value) onCommandExecute(value);
          // Only exit if the command didn't transition to another mode itself
          if (commandBarMode() === "command") exitCommandBar();
        }
        return;
      }
      // All other keys (printable chars, backspace, arrows) pass through to
      // the native <input> widget which manages editing state directly.
      return;
    }

    // ── SEARCH mode ───────────────────────────────────────────────────────────
    if (commandBarMode() === "search") {
      if (e.name === "escape") {
        // Close search bar, clear filter
        setSearchFocused(false);
        clearSearch();
        setCommandBarMode("idle");
        return;
      }
      if (e.name === "return" && searchFocused()) {
        e.preventDefault();
        // Empty input: clear filter and return to idle
        if (!searchInputValue().trim()) {
          setSearchFocused(false);
          clearSearch();
          setCommandBarMode("idle");
        } else {
          confirmSearch();
        }
        return;
      }
      // All other keys pass to the native <input> while focused
      return;
    }

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
      openSearch();
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
    // Available from any context except dialogs (handled above) and text input
    // (command/search/path modes return early above).
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

    // Detail panel focused (or detail dialog open in compact mode):
    if (state.detailFocused() || dialog() === "detail") {
      const scrollbox = getDetailScrollboxRef();

      switch (e.name) {
        case "left":
        case "h": {
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
            // In dialog mode, only esc can close — left does nothing.
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
        case "right":
        case "l": {
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
          return;
        }
        case "up":
        case "k": {
          e.preventDefault();
          const delta = e.shift ? -SHIFT_JUMP : -1;
          actions.moveDetailCursor(delta, detailNavRef.itemCount);
          const newIdx = state.detailCursorIndex();
          const el = detailNavRef.itemRefs[newIdx];
          if (scrollbox && el) scrollElementIntoView(scrollbox, el);
          return;
        }
        case "down":
        case "j": {
          e.preventDefault();
          const delta = e.shift ? SHIFT_JUMP : 1;
          actions.moveDetailCursor(delta, detailNavRef.itemCount);
          const newIdx = state.detailCursorIndex();
          const el = detailNavRef.itemRefs[newIdx];
          if (scrollbox && el) scrollElementIntoView(scrollbox, el);
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

    /**
     * When any highlighting is active, find the nearest highlighted row
     * in the given direction from `from`, stepping `count` entries.
     * Returns the index of the target row, or `from` if no match found.
     */
    const findHighlightedIndex = (from: number, direction: 1 | -1, count: number): number => {
      const hSet = state.highlightSet();
      if (!hSet) return from;
      const rows = state.graphRows();
      let idx = from;
      let steps = 0;
      let next = from + direction;
      while (next >= 0 && next < rows.length) {
        if (hSet.has(rows[next].commit.hash)) {
          idx = next;
          steps++;
          if (steps >= count) break;
        }
        next += direction;
      }
      return steps > 0 ? idx : from;
    };

    /** Count how many highlighted rows exist below `from` (up to `limit`). */
    const countHighlightedBelow = (from: number, limit: number): number => {
      const hSet = state.highlightSet();
      if (!hSet) return 0;
      const rows = state.graphRows();
      let count = 0;
      for (let i = from + 1; i < rows.length && count < limit; i++) {
        if (hSet.has(rows[i].commit.hash)) count++;
      }
      return count;
    };

    switch (e.name) {
      case "down":
      case "j": {
        e.preventDefault();
        const hSet = state.highlightSet();
        if (hSet) {
          const count = e.shift ? SHIFT_JUMP : 1;
          const target = findHighlightedIndex(state.cursorIndex(), 1, count);
          if (target !== state.cursorIndex()) {
            actions.setCursorIndex(target);
            actions.setScrollTargetIndex(target);
            // Preload: when fewer than N highlighted rows remain below the
            // cursor, start loading the next page so the data is ready
            // before the user reaches the boundary.
            if (state.hasMore() && countHighlightedBelow(target, ANCESTRY_PRELOAD_ROWS) < ANCESTRY_PRELOAD_ROWS) {
              loadMoreData();
            }
          } else if (state.hasMore()) {
            // No more highlighted rows in loaded data — trigger lazy load
            loadMoreData();
          }
        } else {
          actions.moveCursor(e.shift ? SHIFT_JUMP : 1);
        }
        resetDetailScroll();
        break;
      }
      case "up":
      case "k": {
        e.preventDefault();
        const hSet = state.highlightSet();
        if (hSet) {
          const count = e.shift ? SHIFT_JUMP : 1;
          const target = findHighlightedIndex(state.cursorIndex(), -1, count);
          if (target !== state.cursorIndex()) {
            actions.setCursorIndex(target);
            actions.setScrollTargetIndex(target);
          }
        } else {
          actions.moveCursor(e.shift ? -SHIFT_JUMP : -1);
        }
        resetDetailScroll();
        break;
      }
      case "right":
      case "l":
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
      case "h":
        // bare ←/h on graph: no-op (Shift+← handled at top level)
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
      case "a":
        // 'a' toggles ancestry highlighting.
        // Blocked during other highlight modes — they are mutually exclusive.
        e.preventDefault();
        if (state.searchQuery() || state.pathFilter()) break;
        onCommandExecute("ancestry");
        break;
      case "p":
        // 'p' opens path mode with the current filter pre-filled for editing.
        e.preventDefault();
        setCommandBarMode("path");
        setCommandBarValue(state.pathFilter() ?? "");
        break;
      case "g": {
        e.preventDefault();
        const hSet = state.highlightSet();
        if (!e.shift) {
          if (hSet) {
            // Jump to first highlighted row
            const target = findHighlightedIndex(-1, 1, 1);
            actions.setCursorIndex(target);
            actions.setScrollTargetIndex(target);
          } else {
            actions.setCursorIndex(0);
            actions.setScrollTargetIndex(0);
          }
        } else {
          if (hSet) {
            // Jump to last highlighted row
            const rows = state.graphRows();
            const target = findHighlightedIndex(rows.length, -1, 1);
            actions.setCursorIndex(target);
            actions.setScrollTargetIndex(target);
            // If the last highlighted row isn't at the very end, trigger lazy load
            if (state.hasMore()) loadMoreData();
          } else {
            const lastIdx = state.graphRows().length - 1;
            actions.setCursorIndex(lastIdx);
            actions.setScrollTargetIndex(lastIdx);
          }
        }
        resetDetailScroll();
        break;
      }
    }
  });

  /**
   * Close the topmost open layer.
   * Order: command bar → dialog → search bar focused → detail focus →
   *        active highlight (search/ancestry/path) → branch view
   * Returns true if something was closed, false if there was nothing left.
   */
  function closeOneCascadeStep(): boolean {
    // Step 1: command bar open
    if (commandBarMode() !== "idle") {
      exitCommandBar();
      if (searchFocused()) {
        setSearchFocused(false);
        clearSearch();
      }
      return true;
    }
    // Step 2: dialog open
    if (dialog()) {
      if (dialog() === "detail") {
        actions.setDetailFocused(false);
        setDialog(null);
      } else if (dialog() === "diff-blame" && layoutMode() === "compact" && state.detailFocused()) {
        setDialog("detail");
      } else {
        setDialog(null);
      }
      return true;
    }
    // Step 3: search bar focused (typing)
    if (searchFocused()) {
      setSearchFocused(false);
      clearSearch();
      return true;
    }
    // Step 4: detail panel focused
    if (state.detailFocused()) {
      actions.setDetailFocused(false);
      return true;
    }
    // Step 5: any active highlight mode (search / ancestry / path)
    if (state.highlightSet() !== null) {
      // Clear whichever is active
      if (state.searchQuery()) {
        clearSearch();
        return true;
      }
      if (state.ancestrySet() !== null) {
        onClearAncestry();
        return true;
      }
      if (state.pathFilter()) {
        actions.setPathFilter(null);
        actions.setPathMatchSet(null);
        return true;
      }
    }
    // Step 6: branch view active
    if (state.viewingBranch()) {
      actions.setViewingBranch(null);
      loadData();
      return true;
    }
    return false;
  }
}
