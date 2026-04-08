import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import type { Accessor } from "solid-js";
import type { DetailNavRef } from "../components/detail-types";
import { SHIFT_JUMP } from "../constants";
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
 * `g/G` — jump to top/bottom
 * `space` — range mark (v0.2.0 range selection)
 * `Enter` — open/confirm/activate
 * `Esc` — close/back/cancel cascade
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
    searchInputValue,
    setSearchInputValue,
    clearSearchDebounce,
    getDetailScrollboxRef,
    detailNavRef,
    loadData,
    commandBarMode,
    setCommandBarMode,
    commandBarValue,
    setCommandBarValue,
    onCommandExecute,
    onClearAncestry,
  } = opts;

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
   * Clears ancestry highlighting (mutual exclusivity).
   */
  const openSearch = () => {
    const currentHash = state.selectedCommit()?.hash ?? null;
    actions.setPreSearchCursorHash(currentHash);
    actions.setSearchConfirmed(false);
    actions.setDetailFocused(false);
    // Ancestry and search are mutually exclusive
    onClearAncestry();
    // Pre-fill with the current active query (empty if no filter)
    setSearchInputValue(state.searchQuery());
    setCommandBarMode("search");
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
    setCommandBarMode("idle");
    actions.setSearchConfirmed(true);

    // Always go to the first (top) match
    actions.setCursorIndex(0);
    actions.setScrollTargetIndex(0);
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
    // Cycles command bar mode regardless of current mode, but only when the
    // graph is the active context (no dialog open, detail not focused).
    if (e.shift && (e.name === "left" || e.name === "right") && !dialog() && !state.detailFocused()) {
      e.preventDefault();
      const modes: CommandBarMode[] = ["idle", "command", "search", "path"];
      const cur = modes.indexOf(commandBarMode());
      const delta = e.name === "right" ? 1 : -1;
      const nextMode = modes[(cur + delta + modes.length) % modes.length];
      if (nextMode === "idle") {
        exitCommandBar();
        setSearchFocused(false);
        clearFilterAndRestore(state.preSearchCursorHash() ?? undefined);
      } else if (nextMode === "search") {
        openSearch();
      } else {
        setSearchFocused(false);
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
        const cmd = commandBarValue().trim();
        // Execute BEFORE exitCommandBar so setDialog() fires before blur's requestRender.
        // For commands that set a new mode (e.g. :search, :path), onCommandExecute
        // will set commandBarMode away from "command" — exitCommandBar detects this
        // and skips the redundant mode change.
        if (cmd) onCommandExecute(cmd);
        // Only exit if the command didn't transition to another mode itself
        if (commandBarMode() === "command") exitCommandBar();
        return;
      }
      // All other keys (printable chars, backspace, arrows) pass through to
      // the native <input> widget which manages editing state directly.
      return;
    }

    // ── SEARCH mode ───────────────────────────────────────────────────────────
    if (commandBarMode() === "search") {
      if (e.name === "escape") {
        // Phase 1: close search bar, clear filter, restore pre-search cursor
        setSearchFocused(false);
        clearFilterAndRestore(state.preSearchCursorHash() ?? undefined);
        setCommandBarMode("idle");
        return;
      }
      if (e.name === "return" && searchFocused()) {
        e.preventDefault();
        // Empty input: clear filter and return to idle
        if (!searchInputValue().trim()) {
          setSearchFocused(false);
          clearFilterAndRestore(state.preSearchCursorHash() ?? undefined);
          setCommandBarMode("idle");
        } else {
          confirmSearch();
        }
        return;
      }
      // All other keys pass to the native <input> while focused
      return;
    }

    // ── IDLE mode (no dialog, no search) ─────────────────────────────────────

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

    // Enter while search bar is focused: confirm search → Phase 2
    if (e.name === "return" && searchFocused()) {
      e.preventDefault();
      confirmSearch();
      return;
    }

    // All other keys while search bar is focused: let the input handle them.
    if (searchFocused()) return;

    // If a non-detail dialog is open, only Escape acts (handled above)
    if (dialog() && dialog() !== "detail") return;

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
     * When ancestry highlighting is active, find the nearest highlighted row
     * in the given direction from `from`, stepping `count` entries.
     * Returns the index of the target row, or `from` if no match found.
     */
    const findAncestryIndex = (from: number, direction: 1 | -1, count: number): number => {
      const aSet = state.ancestrySet();
      if (!aSet) return from;
      const rows = state.filteredRows();
      let idx = from;
      let steps = 0;
      let next = from + direction;
      while (next >= 0 && next < rows.length) {
        if (aSet.has(rows[next].commit.hash)) {
          idx = next;
          steps++;
          if (steps >= count) break;
        }
        next += direction;
      }
      return steps > 0 ? idx : from;
    };

    switch (e.name) {
      case "down":
      case "j": {
        e.preventDefault();
        const aSet = state.ancestrySet();
        if (aSet) {
          const count = e.shift ? SHIFT_JUMP : 1;
          const target = findAncestryIndex(state.cursorIndex(), 1, count);
          if (target !== state.cursorIndex()) {
            actions.setCursorIndex(target);
            actions.setScrollTargetIndex(target);
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
        const aSet = state.ancestrySet();
        if (aSet) {
          const count = e.shift ? SHIFT_JUMP : 1;
          const target = findAncestryIndex(state.cursorIndex(), -1, count);
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
      case "space":
        // Space toggles ancestry highlighting (first-parent chain through cursor commit).
        // Shift+Space is reserved for range selection (v0.2.0 #2).
        if (!e.shift) {
          e.preventDefault();
          onCommandExecute("a");
        }
        break;
      case "g": {
        e.preventDefault();
        const aSet = state.ancestrySet();
        if (!e.shift) {
          if (aSet) {
            // Jump to first highlighted row
            const target = findAncestryIndex(-1, 1, 1);
            actions.setCursorIndex(target);
            actions.setScrollTargetIndex(target);
          } else {
            actions.setCursorIndex(0);
            actions.setScrollTargetIndex(0);
          }
        } else {
          if (aSet) {
            // Jump to last highlighted row
            const rows = state.filteredRows();
            const target = findAncestryIndex(rows.length, -1, 1);
            actions.setCursorIndex(target);
            actions.setScrollTargetIndex(target);
          } else {
            const lastIdx = state.filteredRows().length - 1;
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
   * Order: command bar → dialog → search → detail focus → search filter →
   *        path filter (v0.2.0) → branch view
   * Returns true if something was closed, false if there was nothing left.
   */
  function closeOneCascadeStep(): boolean {
    // Step 1: command bar open
    if (commandBarMode() !== "idle") {
      exitCommandBar();
      if (searchFocused()) {
        setSearchFocused(false);
        clearFilterAndRestore(state.preSearchCursorHash() ?? undefined);
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
    // Step 3: search Phase 1 (typing)
    if (searchFocused()) {
      setSearchFocused(false);
      clearFilterAndRestore(state.preSearchCursorHash() ?? undefined);
      return true;
    }
    // Step 4: detail panel focused
    if (state.detailFocused()) {
      actions.setDetailFocused(false);
      return true;
    }
    // Step 5: search Phase 2 (filter active, graph focused)
    if (state.searchQuery()) {
      clearFilterAndRestore(state.selectedCommit()?.hash ?? undefined);
      return true;
    }
    // Step 6: ancestry highlighting active
    if (state.ancestrySet() !== null) {
      onClearAncestry();
      return true;
    }
    // Step 7: branch view active
    if (state.viewingBranch()) {
      actions.setViewingBranch(null);
      loadData();
      return true;
    }
    return false;
  }
}
