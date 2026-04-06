import type { GraphChar, RenderOptions } from "./graph-render";
import type { GraphRow } from "./types";

/**
 * Maximum number of graph columns to display. Commits on lanes beyond this
 * depth are still tracked but not rendered.
 */
export const MAX_GRAPH_COLUMNS = 12;

/**
 * Compute the maximum graph width (in columns) across all rows.
 * This ensures consistent alignment for content after the graph.
 */
export function getMaxGraphColumns(rows: GraphRow[]): number {
  let max = 0;
  for (const row of rows) {
    let maxCol = 0;
    for (const c of row.connectors) {
      if (c.column + 1 > maxCol) maxCol = c.column + 1;
    }
    maxCol = Math.max(maxCol, row.columns.length);
    // Also account for fan-out rows
    if (row.fanOutRows) {
      for (const foRow of row.fanOutRows) {
        for (const c of foRow) {
          if (c.column + 1 > maxCol) maxCol = c.column + 1;
        }
      }
    }
    if (maxCol > max) max = maxCol;
  }
  return max;
}

/**
 * Compute a single viewport offset for a given node column.
 *
 * Used reactively: when the selected commit changes, compute the offset
 * needed to keep its node column visible. The same offset is applied
 * to all visible rows, giving a horizontal "scroll" effect.
 *
 * @param prevOffset - The current/previous viewport offset (for smooth transitions)
 * @param nodeColumn - The selected commit's node column
 * @param depthLimit - Number of visible columns
 * @param maxColumns - Total graph columns
 * @returns The new viewport offset
 */
export function computeSingleViewportOffset(
  prevOffset: number,
  nodeColumn: number,
  depthLimit: number,
  maxColumns: number,
): number {
  if (depthLimit >= maxColumns) return 0;

  let offset = prevOffset;

  if (nodeColumn >= offset + depthLimit) {
    // Node is to the right — shift right, place node 2 from right edge
    offset = nodeColumn - depthLimit + 2;
  } else if (nodeColumn < offset) {
    // Node is to the left — shift left, place node 1 from left edge
    offset = Math.max(0, nodeColumn - 1);
  }

  // Clamp to valid range
  return Math.max(0, Math.min(offset, maxColumns - depthLimit));
}

/**
 * Slice a rendered GraphChar[] array to the viewport window.
 *
 * Each graph column occupies 2 characters. The viewport shows columns
 * [viewportOffset, viewportOffset + depthLimit). Pure slicer — no edge
 * decoration. Edge indicators (◀/▶) are handled separately by the component.
 *
 * @param chars - The full-width rendered GraphChar[] from renderGraphRow / renderConnectorRow / renderFanOutRow
 * @param viewportOffset - The first visible column index
 * @param depthLimit - Number of columns in the viewport
 * @param row - The GraphRow (used for early-exit check)
 * @param opts - RenderOptions (for padToColumns check)
 * @returns Sliced GraphChar[] fitting within depthLimit columns
 */
export function sliceGraphToViewport(
  chars: GraphChar[],
  viewportOffset: number,
  depthLimit: number,
  row: GraphRow,
  opts: RenderOptions = {},
): GraphChar[] {
  // No slicing needed
  if (viewportOffset === 0 && depthLimit >= (opts.padToColumns ?? row.columns.length)) {
    return chars;
  }

  const padColor = opts.padColor ?? "#6c7086";

  // Each graph column = 2 character positions. The viewport covers char
  // positions [startCharPos, endCharPos). Instead of flattening the entire
  // GraphChar[] to per-character entries, we walk the sparse array and only
  // emit entries that overlap with the viewport window.
  const startCharPos = viewportOffset * 2;
  const endCharPos = (viewportOffset + depthLimit) * 2;

  const result: GraphChar[] = [];
  let pos = 0; // current character position in the full-width row

  for (const gc of chars) {
    const gcLen = gc.char.length;
    const gcEnd = pos + gcLen;

    if (gcEnd <= startCharPos) {
      // Entirely before viewport — skip
      pos = gcEnd;
      continue;
    }
    if (pos >= endCharPos) {
      // Past viewport — done
      break;
    }

    if (pos >= startCharPos && gcEnd <= endCharPos) {
      // Entirely within viewport — emit as-is
      result.push(gc);
    } else {
      // Partially overlapping — need to split.
      // This happens when a 2-char entry straddles the viewport boundary.
      const clipStart = Math.max(0, startCharPos - pos);
      const clipEnd = Math.min(gcLen, endCharPos - pos);
      for (let i = clipStart; i < clipEnd; i++) {
        result.push({ char: gc.char[i], color: gc.color, bold: gc.bold });
      }
    }

    pos = gcEnd;
  }

  // Pad if the rendered content didn't fill the viewport
  const targetWidth = depthLimit * 2;
  let currentWidth = 0;
  for (const gc of result) currentWidth += gc.char.length;
  while (currentWidth < targetWidth) {
    result.push({ char: "  ", color: padColor });
    currentWidth += 2;
  }

  return result;
}

/**
 * Build a single edge indicator GraphChar for a commit row.
 *
 * When the viewport is scrolled and a commit's node (█) is off-screen,
 * a muted triangle (◀ or ▶) is shown in a fixed 2-char-wide column
 * appended to the right side of the graph area.
 *
 * A commit node can only be off-screen in ONE direction, so a single
 * indicator column suffices. This keeps the graph starting at column 0
 * with no extra left padding.
 *
 * Returns a single 2-char GraphChar:
 *   "◀ " when node is off-screen to the left
 *   " ▶" when node is off-screen to the right
 *   "  " when node is in viewport or for non-commit rows
 *
 * @param nodeColumn - The commit's node column
 * @param viewportOffset - The first visible column index
 * @param depthLimit - Number of columns in the viewport
 * @param maxColumns - Total graph columns
 * @param indicatorColor - Muted color for the triangle
 * @param isCommitRow - true for commit rows, false for connector/fan-out rows
 */
export function buildEdgeIndicator(
  nodeColumn: number,
  viewportOffset: number,
  depthLimit: number,
  maxColumns: number,
  indicatorColor: string,
  isCommitRow: boolean = true,
): GraphChar {
  const blank: GraphChar = { char: "  ", color: indicatorColor };

  if (depthLimit >= maxColumns) {
    return blank;
  }

  if (!isCommitRow) {
    return blank;
  }

  if (nodeColumn < viewportOffset) {
    return { char: "◀ ", color: indicatorColor };
  }

  const viewportEnd = viewportOffset + depthLimit;
  if (nodeColumn >= viewportEnd) {
    return { char: " ▶", color: indicatorColor };
  }

  return blank;
}
