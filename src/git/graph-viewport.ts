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

/** The marks at the graph's two edges while it scrolls sideways (empty when it does not). */
export interface EdgeMarks {
  left: GraphChar[];
  right: GraphChar[];
}

/** The character at a position of a full-width row (entries may hold one or two characters). */
function charAt(chars: GraphChar[], position: number): GraphChar | null {
  let pos = 0;
  for (const gc of chars) {
    if (position < pos + gc.char.length) return { char: gc.char[position - pos] ?? " ", color: gc.color };
    pos += gc.char.length;
  }
  return null;
}

/**
 * Marks for the graph's left and right edges while it scrolls sideways, one 2-character column each. A line that
 * runs past an edge gets an arrow there (`◀─` leading into it on the left, `▶` right after it on the right), so it
 * does not seem to come from nothing. A commit whose block is off-screen gets an arrow on its side (`◀ ` or `▶ `).
 *
 * @param fullChars - The row at full width, before slicing
 * @param nodeColumn - The commit's column on a commit row; null for connector and fan-out rows
 * @param color - Muted color for the arrows
 */
export function edgeMarks(
  fullChars: GraphChar[],
  viewportOffset: number,
  depthLimit: number,
  maxColumns: number,
  nodeColumn: number | null,
  color: string,
): EdgeMarks {
  if (depthLimit >= maxColumns) return { left: [], right: [] };
  const blank = (): GraphChar[] => [{ char: "  ", color }];
  const viewportEnd = viewportOffset + depthLimit;

  // A horizontal crosses an edge when the filler between the two columns there is a line.
  const leftFiller = viewportOffset > 0 ? charAt(fullChars, viewportOffset * 2 - 1) : null;
  const rightFiller = charAt(fullChars, viewportEnd * 2 - 1);

  let left = blank();
  if (leftFiller?.char === "─")
    left = [
      { char: "◀", color },
      { char: "─", color: leftFiller.color },
    ];
  else if (nodeColumn !== null && nodeColumn < viewportOffset) left = [{ char: "◀ ", color }];

  const right =
    rightFiller?.char === "─" || (nodeColumn !== null && nodeColumn >= viewportEnd) ? [{ char: "▶ ", color }] : blank();

  return { left, right };
}
