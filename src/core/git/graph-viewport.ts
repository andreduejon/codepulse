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
