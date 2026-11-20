/**
 * A pull request's merge, before it happens: while its tab is open, a muted dotted line from the commit its branch
 * points at to the one the target branch points at, as the merge would join them. It runs in the first column right of
 * both that no line uses between them, drawn over the rows as they are: the graph's own lanes do not move. Only when
 * every column is taken does it get one more, right of the lanes.
 */
import type { GraphRow } from "../../core/git/types";
import type { GraphChar } from "./render";

/** What to join: the pull request's head and its target, by the commit GitHub names, else by the branch. */
export interface MergePreview {
  head: string;
  base: string;
  baseRef: string;
}

/** Where the line runs: the rows of its two ends (top above bottom), their nodes' columns, and its own column. */
export interface MergePreviewSpan {
  top: number;
  bottom: number;
  topNode: number;
  bottomNode: number;
  column: number;
  /** Its column is one more than the graph has: the graph is that much wider while it shows. */
  extra: boolean;
}

/** Whether no line of the row (its own, its connector, its fan-out lines) uses the column. */
const isFree = (row: GraphRow, column: number) =>
  !row.columns[column]?.active &&
  !row.connectors.some(connector => connector.column === column) &&
  !(row.fanOutRows ?? []).some(line => line.some(connector => connector.column === column));

/** The target's row: the commit GitHub names, else the one its branch (remote first) points at. */
function baseIndex(rows: readonly GraphRow[], preview: MergePreview): number {
  const byHash = rows.findIndex(row => row.commit.hash.toLowerCase() === preview.base.toLowerCase());
  if (byHash >= 0 || !preview.baseRef) return byHash;
  const byRef = (type: string, name: string) =>
    rows.findIndex(row => row.commit.refs.some(ref => ref.type === type && ref.name === name));
  const remote = byRef("remote", `origin/${preview.baseRef}`);
  return remote >= 0 ? remote : byRef("branch", preview.baseRef);
}

/**
 * The line for these rows; null when the graph lacks either end, they are one commit, or no column is left (every one
 * taken and the graph already as wide as it shows without scrolling sideways).
 */
export function mergePreviewSpan(
  rows: readonly GraphRow[],
  preview: MergePreview | null,
  columns: number,
  maxColumns: number,
): MergePreviewSpan | null {
  if (!preview) return null;
  const head = rows.findIndex(row => row.commit.hash.toLowerCase() === preview.head.toLowerCase());
  const base = baseIndex(rows, preview);
  if (head < 0 || base < 0 || head === base) return null;
  const top = Math.min(head, base);
  const bottom = Math.max(head, base);
  const topNode = rows[top]?.nodeColumn ?? 0;
  const bottomNode = rows[bottom]?.nodeColumn ?? 0;
  const between = rows.slice(top, bottom + 1);
  let column = Math.max(topNode, bottomNode) + 1;
  while (column < columns && !between.every(row => isFree(row, column))) column++;
  const extra = column >= columns;
  if (extra && columns + 1 > maxColumns) return null;
  return { top, bottom, topNode, bottomNode, column, extra };
}

/** Which of a commit's graph lines: the fan-out lines above it, its own, the connector below it. */
export type GraphLinePart = "above" | "commit" | "below";

/**
 * A graph line with the preview drawn on it: `┆` between the ends, and on each end's own line a dotted `┄` from its
 * node to the column (over empty cells only: a lane it crosses stays) ending in `╮` at the top or `╯` at the bottom.
 */
export function withMergePreview(
  chars: GraphChar[],
  span: MergePreviewSpan | null,
  index: number,
  part: GraphLinePart,
  color: string,
): GraphChar[] {
  if (!span || index < span.top || index > span.bottom) return chars;
  const isEnd = (index === span.top || index === span.bottom) && part === "commit";
  const through =
    (index > span.top && index < span.bottom) ||
    (index === span.top && part === "below") ||
    (index === span.bottom && part === "above");
  if (!isEnd && !through) return chars;
  const cells = chars.flatMap(gc => [...gc.char].map(char => ({ ...gc, char })));
  while (cells.length < span.column * 2 + 2) cells.push({ char: " ", color });
  const at = span.column * 2;
  if (!through) {
    const node = index === span.top ? span.topNode : span.bottomNode;
    for (let cell = node * 2 + 1; cell < at; cell++) if (cells[cell]?.char === " ") cells[cell] = { char: "┄", color };
  }
  cells[at] = { char: through ? "┆" : index === span.top ? "╮" : "╯", color };
  return cells;
}
