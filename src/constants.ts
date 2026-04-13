/** Default number of commits to load when no --max-count flag is provided. */
export const DEFAULT_MAX_COUNT = 200;

/** Column widths for the graph table (character count). */
export const HASH_COL_WIDTH = 9;
export const AUTHOR_COL_WIDTH = 15;
export const DATE_COL_WIDTH = 15;

/** Keyboard navigation jump distances (number of entries). */
export const SHIFT_JUMP = 10;
export const PAGE_JUMP = 20;

/** When navigating in ancestry mode, preload the next page when fewer than
 *  this many ancestry rows remain below the cursor. */
export const ANCESTRY_PRELOAD_ROWS = 5;

/** Detail panel width as a fraction of terminal width. */
export const DETAIL_PANEL_WIDTH_FRACTION = 0.25;

/** Terminal size breakpoints for adaptive layout. */
export const MIN_TERMINAL_WIDTH = 90;
export const MIN_TERMINAL_HEIGHT = 30;
export const COMPACT_THRESHOLD_WIDTH = 180;

/** Sentinel hash used for the synthetic "uncommitted changes" node. */
export const UNCOMMITTED_HASH = "0".repeat(40);

/** Returns true when `hash` refers to the synthetic uncommitted-changes node. */
export const isUncommittedHash = (hash: string): boolean => hash === UNCOMMITTED_HASH;

/** Placeholder text shown in columns where the uncommitted node has no real value. */
export const UNCOMMITTED_PLACEHOLDER = "\u00b7".repeat(7);
