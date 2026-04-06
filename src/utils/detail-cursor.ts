import type { AppState } from "../context/state";
import type { Theme } from "../context/theme";

/**
 * Shared cursor/highlight helpers for detail panel views.
 *
 * Both CommitDetailView and UncommittedDetailView render interactive item
 * lists with cursor highlighting. These functions capture the shared pattern:
 * pure functions of `state` and the current theme.
 */

/**
 * Returns the highlight background color for item at `itemIndex`,
 * or undefined if it is not the currently-cursored item.
 */
export const itemHighlightBg = (state: AppState, t: Theme, itemIndex: number): string | undefined => {
  if (state.detailFocused() && state.detailCursorIndex() === itemIndex) {
    return t.backgroundElementActive;
  }
  return undefined;
};

/** Returns true if `itemIndex` is the currently-focused cursor position. */
export const isCursored = (state: AppState, itemIndex: number): boolean =>
  state.detailFocused() && state.detailCursorIndex() === itemIndex;
