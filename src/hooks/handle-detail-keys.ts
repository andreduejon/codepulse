/**
 * handleDetailKeys — processes key events when the detail panel is focused.
 *
 * Handles tab navigation (←/→), cursor movement (↑/↓/j/k/g/G),
 * enter activation, and page scrolling within the detail panel.
 *
 * Returns true when the key was consumed.
 */
import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import type { DetailNavRef } from "../components/detail-types";
import { SHIFT_JUMP } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { scrollElementIntoView } from "../utils/scroll";
import { getAvailableTabs } from "../utils/tab-utils";
import type { DialogId } from "./use-keyboard-navigation";

export interface DetailKeyOptions {
  state: AppState;
  actions: AppActions;
  dialog: () => DialogId;
  getDetailScrollboxRef: () => ScrollBoxRenderable | undefined;
  detailNavRef: DetailNavRef;
}

/**
 * Handle a key event while the detail panel is focused (or the detail dialog is open).
 * Returns true if the event was consumed (caller should stop processing).
 */
export function handleDetailKey(e: KeyEvent, opts: DetailKeyOptions): boolean {
  const { state, actions, dialog, getDetailScrollboxRef, detailNavRef } = opts;

  // Only active when detail is focused or the detail dialog is open
  if (!state.detailFocused() && dialog() !== "detail") return false;

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
      return true;
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
      return true;
    }
    case "up":
    case "k": {
      e.preventDefault();
      const delta = e.shift ? -SHIFT_JUMP : -1;
      actions.moveDetailCursor(delta, detailNavRef.itemCount);
      const newIdx = state.detailCursorIndex();
      const el = detailNavRef.itemRefs[newIdx];
      if (scrollbox && el) scrollElementIntoView(scrollbox, el);
      return true;
    }
    case "down":
    case "j": {
      e.preventDefault();
      const delta = e.shift ? SHIFT_JUMP : 1;
      actions.moveDetailCursor(delta, detailNavRef.itemCount);
      const newIdx = state.detailCursorIndex();
      const el = detailNavRef.itemRefs[newIdx];
      if (scrollbox && el) scrollElementIntoView(scrollbox, el);
      return true;
    }
    case "return":
      e.preventDefault();
      detailNavRef.activateCurrentItem();
      return true;
    case "pageup":
      e.preventDefault();
      scrollbox?.scrollBy(-0.5, "viewport");
      return true;
    case "pagedown":
      e.preventDefault();
      scrollbox?.scrollBy(0.5, "viewport");
      return true;
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
      return true;
    default:
      // Swallow all other keys when detail is focused
      return true;
  }
}
