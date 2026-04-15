/**
 * handleGraphKeys — processes key events for graph navigation (non-detail context).
 *
 * Handles:
 *   - ↑/↓ / j/k  — cursor movement (highlight-aware)
 *   - ←/→ / h/l  — enter detail panel / no-op
 *   - Enter       — open detail dialog in compact mode
 *   - a           — toggle ancestry highlighting
 *   - p           — open path mode
 *   - g/G         — jump to first/last (or first/last highlighted)
 *
 * Returns true when the key was consumed.
 */
import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import type { DetailNavRef } from "../components/detail-types";
import { ANCESTRY_PRELOAD_ROWS, SHIFT_JUMP } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { countHighlightedBelow, findHighlightedIndex } from "../utils/keyboard-nav-utils";
import type { CommandBarMode, DialogId } from "./use-keyboard-navigation";

export interface GraphKeyOptions {
  state: AppState;
  actions: AppActions;
  layoutMode: () => "too-small" | "compact" | "normal";
  setDialog: (d: DialogId) => void;
  getDetailScrollboxRef: () => ScrollBoxRenderable | undefined;
  detailNavRef: DetailNavRef;
  loadMoreData: () => void;
  onCommandExecute: (cmd: string) => void;
  setCommandBarMode: (m: CommandBarMode) => void;
  setCommandBarValue: (v: string) => void;
}

/**
 * Handle a key event for graph navigation.
 * Returns true if the event was consumed (caller should stop processing).
 */
export function handleGraphKey(e: KeyEvent, opts: GraphKeyOptions): boolean {
  const {
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
  } = opts;

  const scrollbox = getDetailScrollboxRef();

  /** Reset detail scrollbox to top — called when the graph cursor moves. */
  const resetDetailScroll = () => scrollbox?.scrollTo(0);

  /**
   * When any highlighting is active, find the nearest highlighted row
   * in the given direction from `from`, stepping `count` entries.
   */
  const findHighlighted = (from: number, direction: 1 | -1, count: number): number =>
    findHighlightedIndex(state.graphRows(), state.highlightSet(), from, direction, count);

  /** Count how many highlighted rows exist below `from` (up to `limit`). */
  const countBelow = (from: number, limit: number): number =>
    countHighlightedBelow(state.graphRows(), state.highlightSet(), from, limit);

  switch (e.name) {
    case "down":
    case "j": {
      e.preventDefault();
      const hSet = state.highlightSet();
      if (hSet) {
        const count = e.shift ? SHIFT_JUMP : 1;
        const target = findHighlighted(state.cursorIndex(), 1, count);
        if (target !== state.cursorIndex()) {
          actions.setCursorIndex(target);
          actions.setScrollTargetIndex(target);
          // Preload: when fewer than N highlighted rows remain below the cursor,
          // start loading the next page so data is ready before the user reaches
          // the boundary.
          if (state.hasMore() && countBelow(target, ANCESTRY_PRELOAD_ROWS) < ANCESTRY_PRELOAD_ROWS) {
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
      return true;
    }
    case "up":
    case "k": {
      e.preventDefault();
      const hSet = state.highlightSet();
      if (hSet) {
        const count = e.shift ? SHIFT_JUMP : 1;
        const target = findHighlighted(state.cursorIndex(), -1, count);
        if (target !== state.cursorIndex()) {
          actions.setCursorIndex(target);
          actions.setScrollTargetIndex(target);
        }
      } else {
        actions.moveCursor(e.shift ? -SHIFT_JUMP : -1);
      }
      resetDetailScroll();
      return true;
    }
    case "right":
    case "l":
      // Disabled in compact/too-small — no side panel to enter
      if (layoutMode() !== "normal") return false;
      e.preventDefault();
      if (state.selectedCommit()) {
        detailNavRef.pendingJumpDirection = null;
        actions.setDetailCursorIndex(0);
        actions.setDetailFocused(true);
      }
      return true;
    case "left":
    case "h":
      // bare ←/h on graph: no-op (Shift+← handled at top level)
      return false;
    case "return":
      // In compact mode, Enter opens the detail dialog
      if (layoutMode() === "compact" && state.selectedCommit()) {
        e.preventDefault();
        actions.setDetailCursorIndex(0);
        actions.setDetailFocused(true);
        setDialog("detail");
        return true;
      }
      return false;
    case "a":
      // 'a' toggles ancestry highlighting.
      // Blocked during other highlight modes — they are mutually exclusive.
      e.preventDefault();
      if (state.searchQuery() || state.pathFilter()) return true;
      onCommandExecute("ancestry");
      return true;
    case "p":
      // 'p' opens path mode with the current filter pre-filled for editing.
      e.preventDefault();
      setCommandBarMode("path");
      setCommandBarValue(state.pathFilter() ?? "");
      return true;
    case "g": {
      e.preventDefault();
      const hSet = state.highlightSet();
      if (!e.shift) {
        if (hSet) {
          const target = findHighlighted(-1, 1, 1);
          actions.setCursorIndex(target);
          actions.setScrollTargetIndex(target);
        } else {
          actions.setCursorIndex(0);
          actions.setScrollTargetIndex(0);
        }
      } else {
        if (hSet) {
          const rows = state.graphRows();
          const target = findHighlighted(rows.length, -1, 1);
          actions.setCursorIndex(target);
          actions.setScrollTargetIndex(target);
          if (state.hasMore()) loadMoreData();
        } else {
          const lastIdx = state.graphRows().length - 1;
          actions.setCursorIndex(lastIdx);
          actions.setScrollTargetIndex(lastIdx);
        }
      }
      resetDetailScroll();
      return true;
    }
    default:
      return false;
  }
}
