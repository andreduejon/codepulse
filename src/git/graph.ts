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
 * Get the base color for a column (no focus logic).
 */
function getBaseColor(column: number, opts: RenderOptions): string {
  const colors = opts.themeColors ?? DEFAULT_COLORS;
  return colors[column % colors.length];
}

/**
 * Get the display color for a connector element, respecting focus mode.
 * In focus mode, focused elements use focusBranchColor; non-focused use dimColor.
 */
function getFocusColor(isFocused: boolean | undefined, opts: RenderOptions): string | null {
  if (!opts.focusMode || !opts.dimColor) return null;
  return isFocused ? (opts.focusBranchColor ?? null) : opts.dimColor;
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
  // Parallel array: whether each lane belongs to the focused (current) branch path.
  // A lane is focused when a current-branch commit creates or continues it.
  // A lane is NOT focused when created by a non-current-branch commit (even if
  // it points to a current-branch parent — that's just converging back, not the path).
  let laneFocused: boolean[] = [];

  // Build a map from commit hash to commit for quick lookups.
  const commitMap = new Map<string, Commit>();
  for (const c of commits) commitMap.set(c.hash, c);

  // Build a set of hashes reachable via first-parent from the current branch tip.
  // These commits "belong" to the current branch for focus-mode purposes.
  const currentBranchHashes = new Set<string>();
  {
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

  // Build branchName map: for each commit, determine which branch it belongs to.
  // Walk first-parent chains from every branch/tag tip. The first tip to claim
  // a commit wins (since commits is in topo-order, tips appear first).
  const branchNameMap = new Map<string, string>();
  for (const c of commits) {
    // Find branch/tag refs on this commit
    const branchRefs = c.refs.filter((r) => r.type === "branch" || r.type === "remote");
    const tagRefs = c.refs.filter((r) => r.type === "tag");
    // Use first branch ref, falling back to first tag, falling back to nothing
    const tipName = branchRefs[0]?.name ?? tagRefs[0]?.name;
    if (!tipName) continue;

    // Walk first-parent chain from this tip, claiming unclaimed commits
    let h: string | undefined = c.hash;
    while (h) {
      if (branchNameMap.has(h)) break; // already claimed by another (earlier) tip
      branchNameMap.set(h, tipName);
      const parent = commitMap.get(h);
      h = parent?.parents[0]; // first parent only
    }
  }

  // Find the column of the current branch tip (first row).
  // We'll compute this once the tip commit is placed, and use it
  // across all rows for a consistent focus color.
  let currentBranchTipColumn = 0;

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
      laneFocused.push(false); // will be set properly during parent processing
    }

    // Record the tip column for the current branch (used for consistent focus color)
    if (commit.refs.some((r) => r.isCurrent)) {
      currentBranchTipColumn = nodeColumn;
    }

    const isCommitOnCurrentBranch = currentBranchHashes.has(commit.hash);

    // Build connectors for this row
    const connectors: Connector[] = [];

    // First, draw all passing-through lanes and the node.
    // Use laneFocused[] to determine if a lane belongs to the focused branch path.
    for (let col = 0; col < lanes.length; col++) {
      if (col === nodeColumn) {
        connectors.push({
          type: "node",
          color: col,
          column: col,
          isFocused: isCommitOnCurrentBranch,
        });
      } else if (lanes[col] !== null) {
        connectors.push({
          type: "straight",
          color: col,
          column: col,
          isFocused: laneFocused[col],
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
      focused?: boolean,
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
          isFocused: focused,
        });
      }

      // Target column connector
      if (kind === "merge") {
        // Merging into an existing active lane → T-junction.
        // The T-junction visually includes the vertical part of the target lane,
        // so if the target lane is focused, the T-junction should be focused too
        // (to maintain visual continuity of the focused branch line).
        const targetLaneFocused = to < laneFocused.length && laneFocused[to];
        connectors.push({
          type: goingRight ? "tee-right" : "tee-left",
          color,
          column: to,
          isFocused: focused || targetLaneFocused,
        });
      } else {
        // Branching into a new lane → rounded corner (line turns down)
        connectors.push({
          type: goingRight ? "corner-top-right" : "corner-top-left",
          color,
          column: to,
          isFocused: focused,
        });
      }
    }

    // Now handle parents and generate merge/branch connectors
    const parents = commit.parents;

    if (parents.length === 0) {
      // Root commit -- close this lane
      lanes[nodeColumn] = null;
      laneFocused[nodeColumn] = false;
    } else if (parents.length === 1) {
      const parentHash = parents[0];
      const parentFocused = isCommitOnCurrentBranch && currentBranchHashes.has(parentHash);
      const existingLane = lanes.indexOf(parentHash);
      if (existingLane !== -1 && existingLane !== nodeColumn) {
        // Parent is already tracked in another lane. Two lanes are converging
        // to the same parent. We need to decide which lane to keep.
        //
        // To maintain column stability for long-running branches:
        // - If our lane (nodeColumn) has a LOWER index, keep ours and close the other.
        //   This favors main/develop which tend to be in the leftmost columns.
        // - If the other lane has a lower index, merge into it (close ours).
        if (nodeColumn < existingLane) {
          // Keep our lane, close the other one
          addSpanningConnectors(nodeColumn, existingLane, existingLane, "merge", parentFocused);
          lanes[existingLane] = null;
          laneFocused[existingLane] = false;
          lanes[nodeColumn] = parentHash;
          laneFocused[nodeColumn] = parentFocused;
        } else {
          // Merge into the other (lower-index) lane
          addSpanningConnectors(nodeColumn, existingLane, nodeColumn, "merge", parentFocused);
          lanes[nodeColumn] = null;
          laneFocused[nodeColumn] = false;
        }
      } else if (existingLane === nodeColumn) {
        // Parent is tracked in our own lane (shouldn't happen, but safe)
        lanes[nodeColumn] = parentHash;
        laneFocused[nodeColumn] = parentFocused;
      } else if (processedColumns.has(parentHash)) {
        const parentCol = processedColumns.get(parentHash)!;
        if (parentCol !== nodeColumn) {
          const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, kind, parentFocused);
        }
        lanes[nodeColumn] = null;
        laneFocused[nodeColumn] = false;
      } else {
        lanes[nodeColumn] = parentHash;
        laneFocused[nodeColumn] = parentFocused;
      }
    } else {
      // Merge commit -- first parent continues the lane, others open new lanes.
      // IMPORTANT: The first parent ALWAYS continues in the current lane (nodeColumn)
      // to maintain column stability for long-running branches like develop/main.
      // If another lane already tracks the first parent (because a sibling branch
      // also pointed to it), we steal the tracking: continue our lane with the first
      // parent and close the other lane with a merge visual.
      const firstParent = parents[0];
      const firstParentFocused = isCommitOnCurrentBranch && currentBranchHashes.has(firstParent);
      const firstParentLane = lanes.indexOf(firstParent);
      if (firstParentLane !== -1 && firstParentLane !== nodeColumn) {
        // First parent is tracked in another lane. Instead of merging into it
        // (which would shift our branch to a different column), we keep our lane
        // and close the other one. Visually this looks like the other lane merging
        // into us (which is correct — the sibling branch converges here).
        addSpanningConnectors(nodeColumn, firstParentLane, firstParentLane, "merge", firstParentFocused);
        lanes[firstParentLane] = null;
        laneFocused[firstParentLane] = false;
        lanes[nodeColumn] = firstParent;
        laneFocused[nodeColumn] = firstParentFocused;
      } else if (processedColumns.has(firstParent) && firstParentLane === -1) {
        const parentCol = processedColumns.get(firstParent)!;
        if (parentCol !== nodeColumn) {
          const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, kind, firstParentFocused);
        }
        lanes[nodeColumn] = null;
        laneFocused[nodeColumn] = false;
      } else {
        lanes[nodeColumn] = firstParent;
        laneFocused[nodeColumn] = firstParentFocused;
      }

      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        const pFocused = isCommitOnCurrentBranch && currentBranchHashes.has(parentHash);
        const existingLane = lanes.indexOf(parentHash);
        if (existingLane !== -1) {
          // Parent already tracked - add spanning merge connectors
          if (existingLane !== nodeColumn) {
            addSpanningConnectors(nodeColumn, existingLane, existingLane, "merge", pFocused);
          }
        } else if (processedColumns.has(parentHash)) {
          const parentCol = processedColumns.get(parentHash)!;
          if (parentCol !== nodeColumn) {
            const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
            addSpanningConnectors(nodeColumn, parentCol, parentCol, kind, pFocused);
          }
        } else {
          // Open a new lane for this parent
          const emptyIdx = lanes.indexOf(null);
          let newLane: number;
          if (emptyIdx !== -1) {
            newLane = emptyIdx;
            lanes[emptyIdx] = parentHash;
            laneFocused[emptyIdx] = pFocused;
          } else {
            newLane = lanes.length;
            lanes.push(parentHash);
            laneFocused.push(pFocused);
          }
          // Add spanning connectors from nodeColumn to the new lane
          addSpanningConnectors(nodeColumn, newLane, newLane, "branch", pFocused);
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
        laneFocused.pop();
      }
    }

    // Build the columns for this row (snapshot of active lanes AFTER parent processing)
    const columns: GraphColumn[] = lanes.map((lane, idx) => ({
      color: idx,
      active: lane !== null,
      isFocused: laneFocused[idx],
    }));

    rows.push({
      commit,
      columns,
      nodeColumn,
      connectors,
      isOnCurrentBranch: isCommitOnCurrentBranch,
      currentBranchTipColumn,
      branchName: branchNameMap.get(commit.hash) ?? "",
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
  /** When true, focus mode is active — use connector isFocused flags */
  focusMode?: boolean;
  /** Color to use for non-focused elements (e.g. foregroundMuted) */
  dimColor?: string;
  /** Single color for all focused-branch elements */
  focusBranchColor?: string;
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
      const focused = row.columns[col].isFocused;
      const focusColor = getFocusColor(focused, opts);
      const color = focusColor ?? getBaseColor(col, opts);
      const isBold = !opts.focusMode || !!focused;
      result.push({ char: "│ ", color, bold: isBold });
    } else {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(col, opts) });
    }
  }

  // Pad to fixed width if requested
  if (padToColumns !== undefined) {
    while (result.length < padToColumns) {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(0, opts) });
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

  // Helper: resolve color for a connector based on its isFocused flag
  function connColor(c: { color: number; isFocused?: boolean }): string {
    const fc = getFocusColor(c.isFocused, opts);
    return fc ?? getBaseColor(c.color, opts);
  }

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
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(col, opts) });
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
      // In focus mode, dim the node dot if the commit is not on the current branch;
      // otherwise use the single focusBranchColor for consistency.
      let nodeColor: string;
      if (opts.focusMode && opts.dimColor) {
        if (opts.isNodeFocused === false) {
          nodeColor = opts.dimColor;
        } else {
          nodeColor = opts.focusBranchColor ?? getBaseColor(node.color, opts);
        }
      } else {
        nodeColor = getBaseColor(node.color, opts);
      }
      if (col === nodeCol && hasRightConnection) {
        result.push({ char: `${nodeChar}─`, color: nodeColor, bold: true });
      } else if (col === nodeCol && hasLeftConnection) {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      } else {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      }
    } else if (teeLeft) {
      result.push({ char: "├─", color: connColor(teeLeft) });
    } else if (teeRight) {
      result.push({ char: "┤ ", color: connColor(teeRight) });
    } else if (cornerTopRight) {
      result.push({ char: "╮ ", color: connColor(cornerTopRight) });
    } else if (cornerTopLeft) {
      result.push({ char: "╭─", color: connColor(cornerTopLeft) });
    } else if (cornerBottomRight) {
      result.push({ char: "╯ ", color: connColor(cornerBottomRight) });
    } else if (cornerBottomLeft) {
      result.push({ char: "╰─", color: connColor(cornerBottomLeft) });
    } else if (horizontal && straight) {
      // Crossing: use the straight connector's focus state (it's the lane passing through)
      result.push({ char: "┼─", color: connColor(straight) });
    } else if (horizontal) {
      result.push({ char: "──", color: connColor(horizontal) });
    } else if (straight) {
      result.push({ char: "│ ", color: connColor(straight) });
    } else {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(col, opts) });
    }
  }

  // Pad to fixed width if requested
  if (padToColumns !== undefined) {
    while (result.length < padToColumns) {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(0, opts) });
    }
  }

  return result;
}
