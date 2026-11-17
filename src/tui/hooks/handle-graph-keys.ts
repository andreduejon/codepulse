/**
 * handleGraphKeys — processes key events for graph navigation (non-detail context).
 *
 * Handles:
 *   - ↑/↓ / j/k  — cursor movement (highlight-aware)
 *   - ←/→ / h/l  — enter detail panel / no-op
 *   - Enter       — focus details in normal mode or open detail dialog in compact mode
 *   - a           — toggle ancestry highlighting
 *   - p           — open path mode
 *   - g/G         — jump to first/last (or first/last highlighted)
 *
 * Returns true when the key was consumed.
 */

import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import type { CommandBarMode, DialogId } from "../../core/app-state";
import { createGraphNavigation } from "../../core/navigation";
import type { DetailNavRef } from "../components/detail-types";
import { SHIFT_JUMP } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { allowRepeatNav } from "../keyboard/repeat";

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

export function openGraphDetails(
  opts: Pick<GraphKeyOptions, "state" | "actions" | "layoutMode" | "setDialog" | "detailNavRef">,
): boolean {
  const mode = opts.layoutMode();
  if (mode === "too-small" || !opts.state.selectedCommit()) return false;
  opts.detailNavRef.pendingJumpDirection = null;
  // The graph's details, also when a jump from the Dashboard calls this as the view changes.
  const graph = opts.actions.detailFor("graph");
  graph.setDetailCursorIndex(0);
  graph.setDetailFocused(true);
  if (mode === "compact") opts.setDialog("detail");
  return true;
}

/**
 * Handle a key event for graph navigation.
 * Returns true if the event was consumed (caller should stop processing).
 */
export function handleGraphKey(e: KeyEvent, opts: GraphKeyOptions): boolean {
  const { state, actions, layoutMode, getDetailScrollboxRef, loadMoreData, onCommandExecute } = opts;

  const scrollbox = getDetailScrollboxRef();

  /** Reset detail scrollbox to top — called when the graph cursor moves. */
  const resetDetailScroll = () => scrollbox?.scrollTo(0);

  const navigation = createGraphNavigation({ state, actions, loadMore: loadMoreData });

  switch (e.name) {
    case "down":
    case "j":
    case "up":
    case "k": {
      e.preventDefault();
      if (!allowRepeatNav()) return true;
      const direction = e.name === "down" || e.name === "j" ? 1 : -1;
      navigation.step(direction, e.shift ? SHIFT_JUMP : 1);
      resetDetailScroll();
      return true;
    }
    case "right":
    case "l":
      // Disabled in compact/too-small — no side panel to enter
      if (layoutMode() !== "normal") return false;
      e.preventDefault();
      openGraphDetails(opts);
      return true;
    case "left":
    case "h":
      // bare ←/h on graph: no-op (Shift+← handled at top level)
      return false;
    case "return":
      if (openGraphDetails(opts)) {
        e.preventDefault();
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
      e.preventDefault();
      onCommandExecute("path");
      return true;
    case "g": {
      e.preventDefault();
      navigation.toEnd(e.shift ? "last" : "first");
      resetDetailScroll();
      return true;
    }
    default:
      return false;
  }
}
