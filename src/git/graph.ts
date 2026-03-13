import type { Commit, GraphRow, GraphColumn, Connector, ConnectorType } from "./types";
import { StyledText, fg, bold } from "@opentui/core";

// Fallback colors if no theme colors provided
const DEFAULT_COLORS = [
  "#f38ba8", "#a6e3a1", "#89b4fa", "#f9e2af",
  "#cba6f7", "#94e2d5", "#fab387", "#74c7ec",
  "#f2cdcd", "#89dceb", "#b4befe", "#eba0ac",
];

export function getColorForColumn(column: number, colors: string[] = DEFAULT_COLORS): string {
  return colors[column % colors.length];
}

/**
 * Get the display color for a column, respecting focus mode.
 * If focus mode is active (focusColumns is set), non-focused columns use dimColor.
 */
function getDisplayColor(column: number, opts: RenderOptions): string {
  const colors = opts.themeColors ?? DEFAULT_COLORS;
  if (opts.focusColumns && opts.dimColor) {
    return opts.focusColumns.has(column) ? colors[column % colors.length] : opts.dimColor;
  }
  return colors[column % colors.length];
}

export function getColorIndex(column: number): number {
  return column;
}

/**
 * Build graph layout from a list of commits.
 *
 * Each commit is assigned a column (the "lane" it lives in).
 * Active lanes are tracked as we go top-to-bottom through the commit list.
 * When a commit has multiple parents, new lanes are opened for the merges.
 * When a lane's commit appears, that lane is consumed.
 *
 * This version also emits merge/branch connectors between the node column
 * and secondary parent lanes so that diagonal lines are drawn properly.
 */
export function buildGraph(commits: Commit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  // Active lanes: each lane tracks a commit hash it's waiting for
  let lanes: (string | null)[] = [];

  // Build a set of hashes reachable via first-parent from the current branch tip.
  // These commits "belong" to the current branch for focus-mode purposes.
  const currentBranchHashes = new Set<string>();
  {
    const commitMap = new Map<string, Commit>();
    for (const c of commits) commitMap.set(c.hash, c);

    // Find the current branch tip: commit with isCurrent ref
    let tipHash: string | undefined;
    for (const c of commits) {
      if (c.refs.some((r) => r.isCurrent)) {
        tipHash = c.hash;
        break;
      }
    }
    // Walk first-parent chain
    if (tipHash) {
      let h: string | undefined = tipHash;
      while (h) {
        currentBranchHashes.add(h);
        const c = commitMap.get(h);
        h = c?.parents[0]; // first parent only
      }
    }
  }

  // Track which commits have already been processed and their node column.
  // This is needed to detect when a parent commit was already rendered
  // (and its lane reassigned) so the current lane can close properly
  // instead of becoming an orphan.
  const processedColumns = new Map<string, number>();

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    // Find which lane this commit occupies
    let nodeColumn = lanes.indexOf(commit.hash);
    if (nodeColumn === -1) {
      // New commit not in any lane -- always append to get its own column.
      // Do NOT reuse empty lanes here; that would place independent branch
      // tips at the same horizontal level which looks wrong.
      nodeColumn = lanes.length;
      lanes.push(commit.hash);
    }

    // Build connectors for this row
    const connectors: Connector[] = [];

    // First, draw all passing-through lanes and the node
    for (let col = 0; col < lanes.length; col++) {
      if (col === nodeColumn) {
        connectors.push({
          type: "node",
          color: col,
          column: col,
        });
      } else if (lanes[col] !== null) {
        connectors.push({
          type: "straight",
          color: col,
          column: col,
        });
      } else {
        connectors.push({
          type: "empty",
          color: 0,
          column: col,
        });
      }
    }

    // Helper: add connectors spanning from nodeColumn to targetColumn.
    // `color` is the color index for these connectors.
    // `kind` is "merge" (lane closing, merging into existing lane)
    //       or "branch" (new lane opening from this node).
    //
    // For "merge": the target column has an existing active lane, so it gets
    //   a T-junction (├ or ┤). The node already has ● so horizontal connects from it.
    //
    // For "branch": the target column is a newly opened lane, so it gets a
    //   rounded corner (╮ or ╭) showing the lane starting. The node has ● so
    //   horizontal connects from it.
    function addSpanningConnectors(
      from: number,
      to: number,
      color: number,
      kind: "merge" | "branch",
    ) {
      if (from === to) return;

      const goingRight = to > from;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);

      // Intermediate columns between node and target get horizontal lines
      for (let col = lo + 1; col < hi; col++) {
        connectors.push({
          type: "horizontal",
          color,
          column: col,
        });
      }

      // Target column connector
      if (kind === "merge") {
        // Merging into an existing active lane → T-junction
        connectors.push({
          type: goingRight ? "tee-right" : "tee-left",
          color,
          column: to,
        });
      } else {
        // Branching into a new lane → rounded corner (line turns down)
        connectors.push({
          type: goingRight ? "corner-top-right" : "corner-top-left",
          color,
          column: to,
        });
      }
    }

    // Now handle parents and generate merge/branch connectors
    const parents = commit.parents;

    if (parents.length === 0) {
      // Root commit -- close this lane
      lanes[nodeColumn] = null;
    } else if (parents.length === 1) {
      const parentHash = parents[0];
      const existingLane = lanes.indexOf(parentHash);
      if (existingLane !== -1 && existingLane !== nodeColumn) {
        // Parent is already tracked in another lane -- this lane merges into that one
        addSpanningConnectors(nodeColumn, existingLane, nodeColumn, "merge");
        lanes[nodeColumn] = null;
      } else if (existingLane === nodeColumn) {
        // Parent is tracked in our own lane (shouldn't happen, but safe)
        lanes[nodeColumn] = parentHash;
      } else if (processedColumns.has(parentHash)) {
        // Parent was already processed (appeared earlier in the list) and its
        // lane was reassigned. Close this lane and draw a connector back
        // to the column where the parent was rendered.
        const parentCol = processedColumns.get(parentHash)!;
        if (parentCol !== nodeColumn) {
          // Use "merge" if the target column has an active lane (T-junction),
          // or "branch" if empty (corner connector for a clean merge-back line).
          const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, kind);
        }
        lanes[nodeColumn] = null;
      } else {
        lanes[nodeColumn] = parentHash;
      }
    } else {
      // Merge commit -- first parent continues the lane, others open new lanes
      const firstParent = parents[0];
      const firstParentLane = lanes.indexOf(firstParent);
      if (firstParentLane !== -1 && firstParentLane !== nodeColumn) {
        // First parent already tracked in another lane — merge into it
        addSpanningConnectors(nodeColumn, firstParentLane, nodeColumn, "merge");
        lanes[nodeColumn] = null;
      } else if (processedColumns.has(firstParent) && firstParentLane === -1) {
        // First parent already processed and not in any lane — close this lane
        const parentCol = processedColumns.get(firstParent)!;
        if (parentCol !== nodeColumn) {
          const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, kind);
        }
        lanes[nodeColumn] = null;
      } else {
        lanes[nodeColumn] = firstParent;
      }

      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        const existingLane = lanes.indexOf(parentHash);
        if (existingLane !== -1) {
          // Parent already tracked - add spanning merge connectors
          if (existingLane !== nodeColumn) {
            addSpanningConnectors(nodeColumn, existingLane, existingLane, "merge");
          }
        } else if (processedColumns.has(parentHash)) {
          // Parent already processed — draw connector to its column but
          // don't open a new lane (it's already consumed)
          const parentCol = processedColumns.get(parentHash)!;
          if (parentCol !== nodeColumn) {
            const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
            addSpanningConnectors(nodeColumn, parentCol, parentCol, kind);
          }
        } else {
          // Open a new lane for this parent
          const emptyIdx = lanes.indexOf(null);
          let newLane: number;
          if (emptyIdx !== -1) {
            newLane = emptyIdx;
            lanes[emptyIdx] = parentHash;
          } else {
            newLane = lanes.length;
            lanes.push(parentHash);
          }
          // Add spanning connectors from nodeColumn to the new lane
          addSpanningConnectors(nodeColumn, newLane, newLane, "branch");
        }
      }
    }

    // Clean up trailing null lanes, but only if the next commit is already
    // tracked in a lane. If the next commit is a new branch tip (not in any
    // lane), we want to preserve the current lane width so the new tip gets
    // a unique, higher column index rather than reusing a freshly-popped one.
    const nextCommit = i + 1 < commits.length ? commits[i + 1] : null;
    const nextIsTracked = nextCommit !== null && lanes.indexOf(nextCommit.hash) !== -1;
    if (nextIsTracked || nextCommit === null) {
      while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
        lanes.pop();
      }
    }

    // Build the columns for this row (snapshot of active lanes AFTER parent processing)
    const columns: GraphColumn[] = lanes.map((lane, idx) => ({
      color: idx,
      active: lane !== null,
    }));

    // Determine which columns belong to the current branch at this row.
    // A column belongs to the current branch if the lane at that column
    // is tracking a hash that's in the current branch's first-parent chain.
    const currentBranchCols = new Set<number>();
    if (currentBranchHashes.has(commit.hash)) {
      currentBranchCols.add(nodeColumn);
    }
    for (let col = 0; col < lanes.length; col++) {
      if (lanes[col] !== null && currentBranchHashes.has(lanes[col]!)) {
        currentBranchCols.add(col);
      }
    }

    rows.push({
      commit,
      columns,
      nodeColumn,
      connectors,
      currentBranchColumns: currentBranchCols,
      isOnCurrentBranch: currentBranchHashes.has(commit.hash),
    });

    // Record this commit as processed with its column, so later commits
    // whose parents point here can detect the parent was already rendered.
    processedColumns.set(commit.hash, nodeColumn);
  }

  return rows;
}

/**
 * Render a graph row to a string with Unicode characters.
 * Returns an array of { char, color } segments.
 */
export interface GraphChar {
  char: string;
  color: string;
  bold?: boolean;
}

export interface RenderOptions {
  themeColors?: string[];
  padToColumns?: number;
  /** When set, only these columns render in full color; others use dimColor */
  focusColumns?: Set<number>;
  /** Color to use for non-focused columns (e.g. foregroundMuted) */
  dimColor?: string;
  /** When focus mode is active and this is false, the node dot is also dimmed */
  isNodeFocused?: boolean;
}

/**
 * Convert an array of GraphChars into a StyledText object using the
 * OpenTUI core API. This bypasses JSX <span> modifiers which don't
 * work reliably inside <For>/<Show> control flow.
 */
export function graphCharsToContent(chars: GraphChar[]): StyledText {
  const chunks = chars.map((gc) => {
    if (gc.bold) {
      return bold(fg(gc.color)(gc.char));
    }
    return fg(gc.color)(gc.char);
  });
  return new StyledText(chunks);
}

/**
 * Render the connector (continuation) row that sits below a commit row.
 * This draws only vertical lines (│) for active lanes, providing visual
 * continuity so that the ● node doesn't create gaps in the graph lines.
 */
export function renderConnectorRow(row: GraphRow, opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const result: GraphChar[] = [];

  for (let col = 0; col < row.columns.length; col++) {
    if (row.columns[col].active) {
      const color = getDisplayColor(col, opts);
      // Use bold for focused columns so the │ has the same visual weight as the ● node
      const isFocused = !opts.focusColumns || opts.focusColumns.has(col);
      result.push({ char: "│ ", color, bold: isFocused });
    } else {
      result.push({ char: "  ", color: getDisplayColor(col, opts) });
    }
  }

  // Pad to fixed width if requested
  if (padToColumns !== undefined) {
    while (result.length < padToColumns) {
      result.push({ char: "  ", color: getDisplayColor(0, opts) });
    }
  }

  return result;
}

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
    if (maxCol > max) max = maxCol;
  }
  return max;
}

export function renderGraphRow(row: GraphRow, opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const nodeChar = "●";
  const result: GraphChar[] = [];

  // Determine the max column we need to render
  let maxCol = 0;
  for (const c of row.connectors) {
    if (c.column >= maxCol) maxCol = c.column + 1;
  }
  for (const c of row.columns) {
    maxCol = Math.max(maxCol, row.columns.length);
  }

  // Group connectors by column for easy lookup
  const connectorsByCol = new Map<number, Connector[]>();
  for (const c of row.connectors) {
    const list = connectorsByCol.get(c.column) ?? [];
    list.push(c);
    connectorsByCol.set(c.column, list);
  }

  // Check if the node column has a horizontal connection going to the right
  // (i.e. the column right of the node has a horizontal, tee, or corner connector)
  const nodeConnector = row.connectors.find((c) => c.type === "node");
  const nodeCol = nodeConnector?.column ?? -1;
  const hasRightConnection = nodeCol >= 0 && (
    connectorsByCol.has(nodeCol + 1) &&
    (connectorsByCol.get(nodeCol + 1) ?? []).some((c) =>
      c.type === "horizontal" || c.type === "tee-right" ||
      c.type === "corner-top-right" || c.type === "corner-bottom-right"
    )
  );
  // Check if the node column has a horizontal connection going to the left
  const hasLeftConnection = nodeCol >= 1 && (
    connectorsByCol.has(nodeCol - 1) &&
    (connectorsByCol.get(nodeCol - 1) ?? []).some((c) =>
      c.type === "horizontal" || c.type === "tee-left" ||
      c.type === "corner-top-left" || c.type === "corner-bottom-left"
    )
  );

  for (let col = 0; col < maxCol; col++) {
    const colConnectors = connectorsByCol.get(col) ?? [];

    if (colConnectors.length === 0) {
      result.push({ char: "  ", color: getDisplayColor(col, opts) });
      continue;
    }

    // Prioritize: node > tee/corner > horizontal > straight > empty
    const node = colConnectors.find((c) => c.type === "node");
    const teeLeft = colConnectors.find((c) => c.type === "tee-left");
    const teeRight = colConnectors.find((c) => c.type === "tee-right");
    const cornerTopRight = colConnectors.find((c) => c.type === "corner-top-right");
    const cornerTopLeft = colConnectors.find((c) => c.type === "corner-top-left");
    const cornerBottomRight = colConnectors.find((c) => c.type === "corner-bottom-right");
    const cornerBottomLeft = colConnectors.find((c) => c.type === "corner-bottom-left");
    const horizontal = colConnectors.find((c) => c.type === "horizontal");
    const straight = colConnectors.find((c) => c.type === "straight");

    if (node) {
      // In focus mode, dim the node dot if the commit is not on the current branch
      const nodeColor = (opts.focusColumns && opts.dimColor && opts.isNodeFocused === false)
        ? opts.dimColor
        : getDisplayColor(node.color, opts);
      if (col === nodeCol && hasRightConnection) {
        result.push({ char: `${nodeChar}─`, color: nodeColor, bold: true });
      } else if (col === nodeCol && hasLeftConnection) {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      } else {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      }
    } else if (teeLeft) {
      result.push({ char: "├─", color: getDisplayColor(teeLeft.color, opts) });
    } else if (teeRight) {
      result.push({ char: "┤ ", color: getDisplayColor(teeRight.color, opts) });
    } else if (cornerTopRight) {
      result.push({ char: "╮ ", color: getDisplayColor(cornerTopRight.color, opts) });
    } else if (cornerTopLeft) {
      result.push({ char: "╭─", color: getDisplayColor(cornerTopLeft.color, opts) });
    } else if (cornerBottomRight) {
      result.push({ char: "╯ ", color: getDisplayColor(cornerBottomRight.color, opts) });
    } else if (cornerBottomLeft) {
      result.push({ char: "╰─", color: getDisplayColor(cornerBottomLeft.color, opts) });
    } else if (horizontal && straight) {
      result.push({ char: "┼─", color: getDisplayColor(straight.color, opts) });
    } else if (horizontal) {
      result.push({ char: "──", color: getDisplayColor(horizontal.color, opts) });
    } else if (straight) {
      result.push({ char: "│ ", color: getDisplayColor(straight.color, opts) });
    } else {
      result.push({ char: "  ", color: getDisplayColor(col, opts) });
    }
  }

  // Pad to fixed width if requested
  if (padToColumns !== undefined) {
    while (result.length < padToColumns) {
      result.push({ char: "  ", color: getDisplayColor(0, opts) });
    }
  }

  return result;
}
