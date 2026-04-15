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

// ── Settings constants (shared by menu dialog and setup screen) ────────
/** Available page-size options for the "Page size" setting. */
export const MAX_COUNT_OPTIONS = [10, 20, 50, 100, 200, 500];

/** Available auto-refresh interval labels. */
export const AUTO_REFRESH_OPTIONS = ["off", "10s", "30s", "60s"];

/** Maps an auto-refresh label to its millisecond value. */
export const AUTO_REFRESH_MS: Record<string, number> = {
  off: 0,
  "10s": 10000,
  "30s": 30000,
  "60s": 60000,
};

/** Maps a millisecond value to its display label. */
export const MS_TO_LABEL: Record<number, string> = {
  0: "off",
  10000: "10s",
  30000: "30s",
  60000: "60s",
};
