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
 *                               Horizontal-bright cols keep ─, corners, and
 *                               tees vivid.
 *                               Crossings (┼) stay bright only when the
 *                               vertical lane through them is in the
 *                               ancestry path (the glyph carries the
 *                               vertical lane's color). The ─ after a ┼
 *                               follows normal horizontal-bright rules.
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
    return chars.map(c => {
      const colIdx = Math.floor(pos / 2);
      pos += c.char.length;
      const ch = c.char[0];

      // Vertical passthrough │ and node █ stay bright at vertical-bright columns.
      const isVerticalBright = bright?.has(colIdx) && (ch === "│" || ch === "█");

      // Crossings (┼) stay bright only when the vertical lane through them is
      // in the ancestry path. The ┼ glyph is rendered with the vertical lane's
      // color, so it must stay bright to avoid a dimmed "hole" in an otherwise
      // bright vertical lane. When only the horizontal arm is ancestry, the ┼
      // is dimmed because we can't recolor it to the horizontal arm's color.
      const isCrossing = ch === "┼";
      const isCrossingBright = isCrossing && bright?.has(colIdx);

      // Horizontal glyphs (─, corners, tees) stay bright at horizontal-bright
      // columns. The ─ after a ┼ also stays bright when the horizontal is bright
      // (it represents the horizontal arm continuing through the crossing).
      const isHorizontalBright = hBright?.has(colIdx) && !isCrossing && ch !== "│";

      const isBright = isVerticalBright || isCrossingBright || isHorizontalBright;
      return isBright ? c : { ...c, color: mutedColor, bold: false };
    });
  }

  return chars.map(c => ({ ...c, color: mutedColor, bold: false }));
}
