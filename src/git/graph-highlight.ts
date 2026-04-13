/**
 * Pure functions for ancestry-highlight column computation and graph-char dimming.
 *
 * These are extracted from the reactive component code in graph.tsx so they can
 * be unit-tested without a SolidJS runtime.
 */

import type { GraphChar } from "./graph-render";
import type { GraphRow } from "./types";

// ── Bright-column computation ───────────────────────────────────────────────

export interface BrightColumns {
  /** Per-row-hash set of column indices where │ passthroughs and █ nodes stay bright. */
  vertical: Map<string, Set<number>>;
  /** Per-row-hash, per-fan-out-row-index set of column indices where ─, corners,
   *  and tees stay bright (the arm connecting an ancestry child to the parent's
   *  nodeColumn). Only the specific fan-out row that reaches the ancestry child
   *  gets brightened — other fan-out rows stay dimmed. */
  fanOutHorizontal: Map<string, Map<number, Set<number>>>;
  /** Per-row-hash set of column indices where horizontal glyphs on the commit row
   *  itself stay bright (when the ancestry connection uses the commit row's own
   *  connectors rather than a fan-out row). */
  commitHorizontal: Map<string, Set<number>>;
}

/**
 * For each row, compute which column indices should stay bright when ancestry
 * highlighting is active.
 *
 * Algorithm:
 *   1. Walk rows top-to-bottom, collecting ancestry row indices.
 *   2. For each ancestry row: add its nodeColumn to vertical.
 *   3. For each consecutive pair (child @ i, parent @ j):
 *      Intermediate rows r in (i, j): add childCol if active to vertical.
 *      The parent's column is NOT added — it's just that branch's own
 *      passthrough, not the ancestry path.
 *   4. When childCol ≠ parentCol, find the specific fan-out row on the parent
 *      that reaches childCol, and store its index + column span in fanOutHorizontal.
 *      If the connection is on the commit row itself (no matching fan-out row),
 *      store the column span in commitHorizontal instead.
 */
export function computeBrightColumns(ancestrySet: Set<string>, rows: GraphRow[]): BrightColumns {
  const vertical = new Map<string, Set<number>>();
  const fanOutHorizontal = new Map<string, Map<number, Set<number>>>();
  const commitHorizontal = new Map<string, Set<number>>();

  const addCol = (hash: string, col: number) => {
    let set = vertical.get(hash);
    if (!set) {
      set = new Set<number>();
      vertical.set(hash, set);
    }
    set.add(col);
  };

  const addFoHCol = (hash: string, foIdx: number, col: number) => {
    let byRow = fanOutHorizontal.get(hash);
    if (!byRow) {
      byRow = new Map<number, Set<number>>();
      fanOutHorizontal.set(hash, byRow);
    }
    let set = byRow.get(foIdx);
    if (!set) {
      set = new Set<number>();
      byRow.set(foIdx, set);
    }
    set.add(col);
  };

  const addCommitHCol = (hash: string, col: number) => {
    let set = commitHorizontal.get(hash);
    if (!set) {
      set = new Set<number>();
      commitHorizontal.set(hash, set);
    }
    set.add(col);
  };

  // Gather ancestry row indices and seed each with its nodeColumn
  const ancestryIndices: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (ancestrySet.has(rows[i].commit.hash)) {
      ancestryIndices.push(i);
      addCol(rows[i].commit.hash, rows[i].nodeColumn);
    }
  }

  // For each consecutive pair of ancestry rows, compute passthrough columns
  // and per-fan-out-row horizontal bright sets.
  for (let p = 0; p + 1 < ancestryIndices.length; p++) {
    const childIdx = ancestryIndices[p];
    const parentIdx = ancestryIndices[p + 1];
    const childRow = rows[childIdx];
    const parentRow = rows[parentIdx];
    const childCol = childRow.nodeColumn;
    const parentCol = parentRow.nodeColumn;

    // Intermediate rows: brighten only the child's column if the lane is active.
    // The parent's column on intermediate rows is just that branch's own
    // passthrough — the ancestry path doesn't run through it until the
    // horizontal fan-out/merge connection at the parent's row.
    for (let r = childIdx + 1; r < parentIdx; r++) {
      const row = rows[r];
      if (row.columns[childCol]?.active) {
        addCol(row.commit.hash, childCol);
      }
    }

    // When two consecutive ancestry nodes are in different lanes, find the
    // specific fan-out row that reaches the ancestry child's column and mark
    // only that row's columns [lo..hi] as bright. If the connection goes through
    // the commit row's own connectors instead, mark commitHorizontal.
    //
    // NOTE: childCol is NOT added to the parent's vertical bright set. The
    // vertical set is shared across commit, connector, and fan-out rows for
    // this hash. Adding childCol would incorrectly brighten │ on the connector
    // row below (which belongs to a different branch's passthrough). Junctions
    // like ┼ at childCol on the fan-out row are handled by the horizontal
    // bright set — isJunctionOnHorizontalAncestry replaces them with ─.
    if (childCol !== parentCol) {
      const lo = Math.min(childCol, parentCol);
      const hi = Math.max(childCol, parentCol);
      const parentHash = parentRow.commit.hash;

      let foundInFanOut = false;
      const foRows = parentRow.fanOutRows;
      if (foRows) {
        for (let fi = 0; fi < foRows.length; fi++) {
          const reachesChild = foRows[fi].some(
            c => c.column === childCol && (c.type === "corner-bottom-right" || c.type === "corner-bottom-left"),
          );
          if (reachesChild) {
            for (let c = lo; c <= hi; c++) addFoHCol(parentHash, fi, c);
            foundInFanOut = true;
            break;
          }
        }
      }

      // If the connection wasn't found in a fan-out row, it must be on the
      // commit row's own connectors (merge arm). Brighten those columns.
      if (!foundInFanOut) {
        const hasConnectorToChild = parentRow.connectors.some(
          c =>
            c.column === childCol &&
            (c.type === "horizontal" ||
              c.type === "tee-left" ||
              c.type === "tee-right" ||
              c.type === "corner-top-right" ||
              c.type === "corner-top-left" ||
              c.type === "corner-bottom-right" ||
              c.type === "corner-bottom-left"),
        );
        if (hasConnectorToChild) {
          for (let c = lo; c <= hi; c++) addCommitHCol(parentHash, c);
        }
      }
    }
  }

  return { vertical, fanOutHorizontal, commitHorizontal };
}

// ── Debug flag ──────────────────────────────────────────────────────────────
// Set to true to replace bright chars with 'o' and dimmed chars with 'x'
// instead of actual dimming. Makes it immediately visible in the TUI
// which glyphs the algorithm considers bright vs dimmed.
const DEBUG_DIM = false;

// ── Graph-char dimming ──────────────────────────────────────────────────────

export interface DimOptions {
  /** Whether this row is the synthetic uncommitted-changes node. */
  isUncommitted: boolean;
  /** Whether ancestry highlighting is currently active. */
  ancestryActive: boolean;
  /** Column indices where │ passthroughs and █ nodes stay bright. */
  brightColumns?: Set<number>;
  /** Column indices where ─, corners, and tees stay bright (fan-out rows). */
  brightHorizontal?: Set<number>;
}

/**
 * Apply ancestry dimming to a rendered GraphChar[] array.
 *
 * Rules:
 *   - uncommitted node        → full dim always
 *   - ancestry inactive       → no dim (pass through)
 *   - bright set present      → char-position tracking: colIdx = floor(pos/2)
 *                               where pos accumulates char.length.
 *                               Vertical-bright cols keep │ and █ vivid.
 *                               Junction glyphs (┼, ├, ┤, ┬, ┴) on
 *                               vertical-bright columns are replaced with
 *                               │. The ─ that follows (always a separate
 *                               entry) is dimmed normally by the standard
 *                               bright-check logic.
 *                               Junctions on horizontal-bright (but NOT
 *                               vertical-bright) columns are replaced with
 *                               ─ (the vertical arm is removed).
 *                               Horizontal-bright cols keep ─ and corners
 *                               vivid.
 *   - no bright set           → full dim
 *
 * NOTE: array index ≠ column index because a single column can be split into
 * two 1-char entries. Char-position tracking is the only correct mapping:
 * column c occupies char positions [c*2, c*2+2).
 */
export function dimGraphChars(chars: GraphChar[], mutedColor: string, opts: DimOptions): GraphChar[] {
  if (opts.isUncommitted) return chars.map(c => ({ ...c, color: mutedColor, bold: false }));
  if (!opts.ancestryActive) return chars;

  const bright = opts.brightColumns;
  const hBright = opts.brightHorizontal;
  const hasBright = (bright && bright.size > 0) || (hBright && hBright.size > 0);

  if (hasBright) {
    let pos = 0;
    return chars.map((c, i) => {
      const colIdx = Math.floor(pos / 2);
      pos += c.char.length;
      const ch = c.char[0];

      // Vertical passthrough │ and node █ stay bright at vertical-bright columns.
      const isVerticalBright = bright?.has(colIdx) && (ch === "│" || ch === "█");

      // Junction glyphs (┼, ├, ┤, ┬, ┴) on vertical-bright columns are
      // replaced with │ — the horizontal arm through them is removed so the
      // ancestry line appears as a clean uninterrupted vertical line.
      // On horizontal-bright columns (but NOT vertical-bright), junctions are
      // replaced with ─ — the vertical arm is removed so the ancestry
      // horizontal connection appears as a clean line.
      const isJunction = ch === "┼" || ch === "├" || ch === "┤" || ch === "┬" || ch === "┴";
      const isJunctionOnVerticalAncestry = isJunction && bright?.has(colIdx);
      const isJunctionOnHorizontalAncestry = isJunction && !isJunctionOnVerticalAncestry && hBright?.has(colIdx);

      if (isJunctionOnVerticalAncestry) {
        // Replace junction glyph with │. All junctions are 1-char entries
        // (├ is always split from ─ in the renderer), so the separate ─
        // entry that follows will be dimmed normally by the rest of the logic.
        // ┤ renders as "┤ " (2-char with space) — slice(1) keeps the space.
        const replacement = "│" + c.char.slice(1);
        return { ...c, char: replacement, bold: true };
      }

      if (isJunctionOnHorizontalAncestry) {
        // Replace junction glyph with ─ (keep the horizontal arm, remove
        // the vertical). 2-char entries like "┤ " → "─ ".
        // The junction's original color is the vertical lane's color, which
        // is wrong for the replacement ─. Pick up the horizontal color from
        // the adjacent ─ entry (the next char in the array).
        const replacement = "─" + c.char.slice(1);
        const hColor = chars[i + 1]?.color ?? c.color;
        return { ...c, char: replacement, color: hColor };
      }

      // Horizontal glyphs (─, corners) stay bright at horizontal-bright columns.
      // Junctions not on the ancestry lane and │/█ are excluded.
      const isHorizontalBright = hBright?.has(colIdx) && !isJunction && ch !== "│" && ch !== "█";

      const isBright = isVerticalBright || isHorizontalBright;

      if (DEBUG_DIM) {
        const isSpace = c.char.trim().length === 0;
        if (isSpace) return c;
        const marker = isBright ? "o" : "x";
        const debugChar = marker + c.char.slice(1);
        return { ...c, char: debugChar };
      }

      return isBright ? c : { ...c, color: mutedColor, bold: false };
    });
  }

  return chars.map(c => ({ ...c, color: mutedColor, bold: false }));
}
