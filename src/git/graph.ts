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
  // Parallel array: whether each lane belongs to a remote-only branch.
  let laneRemoteOnly: boolean[] = [];

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

  // Determine which branch names are "remote-only".
  // A remote branch like "origin/foo" is remote-only if there is no local branch
  // named "foo" among the tip commits. We collect all local branch names and
  // all remote branch names, then compute the set difference.
  const localBranchNames = new Set<string>();
  const remoteBranchTipNames = new Set<string>();
  for (const c of commits) {
    for (const r of c.refs) {
      if (r.type === "branch") {
        localBranchNames.add(r.name);
      } else if (r.type === "remote") {
        remoteBranchTipNames.add(r.name);
      }
    }
  }
  // A remote branch is remote-only if stripping the remote prefix (e.g. "origin/")
  // gives a name that is NOT in localBranchNames.
  const remoteOnlyBranches = new Set<string>();
  for (const remoteName of remoteBranchTipNames) {
    // Strip "origin/", "upstream/", or "refs/remotes/..." prefix
    const slashIdx = remoteName.indexOf("/");
    const localEquivalent = slashIdx !== -1 ? remoteName.slice(slashIdx + 1) : remoteName;
    if (!localBranchNames.has(localEquivalent)) {
      remoteOnlyBranches.add(remoteName);
    }
  }

  // Build a set of commit hashes that belong to remote-only branches.
  // A commit is remote-only if branchNameMap assigns it to a remote-only branch
  // AND it is NOT reachable from any non-remote-only branch's first-parent chain.
  // This prevents shared ancestors (e.g. merge bases) from being dimmed.
  const nonRemoteOnlyHashes = new Set<string>();
  for (const c of commits) {
    // Check if this commit has ANY non-remote-only branch/tag ref.
    // We must check ALL refs, not just the first one, because a commit can have
    // multiple refs (e.g. origin/HEAD + main) and only some may be remote-only.
    const hasNonRemoteOnlyRef = c.refs.some((r) => {
      if (r.type === "tag") return true; // tags are never remote-only
      if (r.type === "branch") return true; // local branches are never remote-only
      if (r.type === "remote") return !remoteOnlyBranches.has(r.name);
      return false;
    });
    if (!hasNonRemoteOnlyRef) continue;
    // Walk first-parent chain from this commit
    let h: string | undefined = c.hash;
    while (h) {
      if (nonRemoteOnlyHashes.has(h)) break;
      nonRemoteOnlyHashes.add(h);
      const parent = commitMap.get(h);
      h = parent?.parents[0];
    }
  }
  const remoteOnlyHashes = new Set<string>();
  for (const [hash, branchName] of branchNameMap) {
    if (remoteOnlyBranches.has(branchName) && !nonRemoteOnlyHashes.has(hash)) {
      remoteOnlyHashes.add(hash);
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
      laneRemoteOnly.push(remoteOnlyHashes.has(commit.hash));
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
    const isCommitRemoteOnly = remoteOnlyHashes.has(commit.hash);

    for (let col = 0; col < lanes.length; col++) {
      if (col === nodeColumn) {
        connectors.push({
          type: "node",
          color: col,
          column: col,
          isFocused: isCommitOnCurrentBranch,
          isRemoteOnly: isCommitRemoteOnly,
        });
      } else if (lanes[col] !== null) {
        connectors.push({
          type: "straight",
          color: col,
          column: col,
          isFocused: laneFocused[col],
          isRemoteOnly: laneRemoteOnly[col],
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
      kind: "merge" | "branch" | "close",
      focused?: boolean,
      /** Optional: override the color index for the target column connector.
       *  When branching, the target (parent branch's tee/corner) should use
       *  the parent branch's color, while intermediates use `color`. */
      targetColor?: number,
      /** Whether these connectors belong to a remote-only branch */
      remoteOnly?: boolean,
    ) {
      if (from === to) return;

      const goingRight = to > from;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);

      // In focus mode, spanning connectors (horizontals, corners) are always
      // dimmed. The focused node ● and the rounded corner shape provide enough
      // visual signal that something branched or merged. Only independently
      // focused lanes (targetLaneFocused) retain their highlight.

      // Intermediate columns between node and target get horizontal lines
      for (let col = lo + 1; col < hi; col++) {
        connectors.push({
          type: "horizontal",
          color,
          column: col,
          isFocused: false,
          isRemoteOnly: remoteOnly,
        });
      }

      // Resolve the color for the target column connector
      const resolvedTargetColor = targetColor !== undefined ? targetColor : color;

      // Target column connector
      // In focus mode, corners are always dimmed — only ● and │ retain focus color.
      if (kind === "merge") {
        connectors.push({
          type: goingRight ? "corner-top-right" : "corner-top-left",
          color,
          column: to,
          isFocused: false,
          isRemoteOnly: remoteOnly,
        });
      } else if (kind === "close") {
        connectors.push({
          type: goingRight ? "corner-bottom-right" : "corner-bottom-left",
          color,
          column: to,
          isFocused: false,
          isRemoteOnly: remoteOnly,
        });
      } else {
        // Branching into a new lane → rounded corner (line turns down)
        connectors.push({
          type: goingRight ? "corner-top-right" : "corner-top-left",
          color: resolvedTargetColor,
          column: to,
          isFocused: false,
          isRemoteOnly: remoteOnly,
        });
      }
    }

    // Now handle parents and generate merge/branch connectors
    const parents = commit.parents;

    if (parents.length === 0) {
      // Root commit -- close this lane
      lanes[nodeColumn] = null;
      laneFocused[nodeColumn] = false;
      laneRemoteOnly[nodeColumn] = false;
    } else if (parents.length === 1) {
      const parentHash = parents[0];
      const parentFocused = isCommitOnCurrentBranch && currentBranchHashes.has(parentHash);
      const parentRemoteOnly = remoteOnlyHashes.has(parentHash);
      const existingLane = lanes.indexOf(parentHash);
      if (existingLane !== -1 && existingLane !== nodeColumn) {
        if (nodeColumn < existingLane) {
          addSpanningConnectors(nodeColumn, existingLane, existingLane, "close", parentFocused, undefined, isCommitRemoteOnly);
          lanes[existingLane] = null;
          laneFocused[existingLane] = false;
          laneRemoteOnly[existingLane] = false;
          lanes[nodeColumn] = parentHash;
          laneFocused[nodeColumn] = parentFocused;
          laneRemoteOnly[nodeColumn] = parentRemoteOnly;
        } else {
          addSpanningConnectors(nodeColumn, existingLane, nodeColumn, "merge", parentFocused, undefined, isCommitRemoteOnly);
          lanes[nodeColumn] = null;
          laneFocused[nodeColumn] = false;
          laneRemoteOnly[nodeColumn] = false;
        }
      } else if (existingLane === nodeColumn) {
        lanes[nodeColumn] = parentHash;
        laneFocused[nodeColumn] = parentFocused;
        laneRemoteOnly[nodeColumn] = parentRemoteOnly;
      } else if (processedColumns.has(parentHash)) {
        const parentCol = processedColumns.get(parentHash)!;
        if (parentCol !== nodeColumn) {
          const targetActive = parentCol < lanes.length && lanes[parentCol] !== null;
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, targetActive ? "merge" : "close", parentFocused, undefined, isCommitRemoteOnly);
        }
        lanes[nodeColumn] = null;
        laneFocused[nodeColumn] = false;
        laneRemoteOnly[nodeColumn] = false;
      } else {
        lanes[nodeColumn] = parentHash;
        laneFocused[nodeColumn] = parentFocused;
        laneRemoteOnly[nodeColumn] = parentRemoteOnly;
      }
    } else {
      // Merge commit -- first parent continues the lane, others open new lanes.
      const firstParent = parents[0];
      const firstParentFocused = isCommitOnCurrentBranch && currentBranchHashes.has(firstParent);
      const firstParentRemoteOnly = remoteOnlyHashes.has(firstParent);
      const firstParentLane = lanes.indexOf(firstParent);
      if (firstParentLane !== -1 && firstParentLane !== nodeColumn) {
        addSpanningConnectors(nodeColumn, firstParentLane, firstParentLane, "close", firstParentFocused, undefined, isCommitRemoteOnly);
        lanes[firstParentLane] = null;
        laneFocused[firstParentLane] = false;
        laneRemoteOnly[firstParentLane] = false;
        lanes[nodeColumn] = firstParent;
        laneFocused[nodeColumn] = firstParentFocused;
        laneRemoteOnly[nodeColumn] = firstParentRemoteOnly;
      } else if (processedColumns.has(firstParent) && firstParentLane === -1) {
        const parentCol = processedColumns.get(firstParent)!;
        if (parentCol !== nodeColumn) {
          const targetActive = parentCol < lanes.length && lanes[parentCol] !== null;
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, targetActive ? "merge" : "close", firstParentFocused, undefined, isCommitRemoteOnly);
        }
        lanes[nodeColumn] = null;
        laneFocused[nodeColumn] = false;
        laneRemoteOnly[nodeColumn] = false;
      } else {
        lanes[nodeColumn] = firstParent;
        laneFocused[nodeColumn] = firstParentFocused;
        laneRemoteOnly[nodeColumn] = firstParentRemoteOnly;
      }

      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        const pFocused = isCommitOnCurrentBranch && currentBranchHashes.has(parentHash);
        const pRemoteOnly = remoteOnlyHashes.has(parentHash);
        const existingLane = lanes.indexOf(parentHash);
        if (existingLane !== -1) {
          if (existingLane !== nodeColumn) {
            addSpanningConnectors(nodeColumn, existingLane, existingLane, "merge", pFocused, undefined, isCommitRemoteOnly);
          }
        } else if (processedColumns.has(parentHash)) {
          const parentCol = processedColumns.get(parentHash)!;
          if (parentCol !== nodeColumn) {
            const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
            addSpanningConnectors(nodeColumn, parentCol, parentCol, kind, pFocused, undefined, isCommitRemoteOnly);
          }
        } else {
          // Open a new lane for this parent
          const emptyIdx = lanes.indexOf(null);
          let newLane: number;
          if (emptyIdx !== -1) {
            newLane = emptyIdx;
            lanes[emptyIdx] = parentHash;
            laneFocused[emptyIdx] = pFocused;
            laneRemoteOnly[emptyIdx] = pRemoteOnly;
          } else {
            newLane = lanes.length;
            lanes.push(parentHash);
            laneFocused.push(pFocused);
            laneRemoteOnly.push(pRemoteOnly);
          }
          // Add spanning connectors from nodeColumn to the new lane
          addSpanningConnectors(nodeColumn, newLane, newLane, "branch", pFocused, undefined, pRemoteOnly);
        }
      }
    }

    // Clean up trailing null lanes
    const nextCommit = i + 1 < commits.length ? commits[i + 1] : null;
    const nextIsTracked = nextCommit !== null && lanes.indexOf(nextCommit.hash) !== -1;
    if (nextIsTracked || nextCommit === null) {
      while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
        lanes.pop();
        laneFocused.pop();
        laneRemoteOnly.pop();
      }
    }

    // Build the columns for this row (snapshot of active lanes AFTER parent processing)
    const columns: GraphColumn[] = lanes.map((lane, idx) => ({
      color: idx,
      active: lane !== null,
      isFocused: laneFocused[idx],
      isRemoteOnly: laneRemoteOnly[idx],
    }));

    rows.push({
      commit,
      columns,
      nodeColumn,
      connectors,
      isOnCurrentBranch: isCommitOnCurrentBranch,
      currentBranchTipColumn,
      branchName: branchNameMap.get(commit.hash) ?? "",
      isRemoteOnly: isCommitRemoteOnly,
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
  /** Color to use for remote-only branch elements (independent of focus mode) */
  remoteOnlyDimColor?: string;
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
      const isRemote = row.columns[col].isRemoteOnly;
      const focusColor = getFocusColor(focused, opts);
      let color: string;
      if (focusColor) {
        color = focusColor;
      } else if (isRemote && opts.remoteOnlyDimColor) {
        color = opts.remoteOnlyDimColor;
      } else {
        color = getBaseColor(col, opts);
      }
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
  // and isRemoteOnly flag. Focus mode takes precedence over remote-only dimming.
  function connColor(c: { color: number; isFocused?: boolean; isRemoteOnly?: boolean }): string {
    const fc = getFocusColor(c.isFocused, opts);
    if (fc) return fc;
    // Remote-only dimming (independent of focus mode)
    if (c.isRemoteOnly && opts.remoteOnlyDimColor) return opts.remoteOnlyDimColor;
    return getBaseColor(c.color, opts);
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
      } else if (node.isRemoteOnly && opts.remoteOnlyDimColor) {
        nodeColor = opts.remoteOnlyDimColor;
      } else {
        nodeColor = getBaseColor(node.color, opts);
      }
      if (col === nodeCol && hasRightConnection) {
        // Split: ● in node color, ─ in the connecting branch's color
        result.push({ char: nodeChar, color: nodeColor, bold: true });
        const rightConn = (connectorsByCol.get(nodeCol + 1) ?? []).find((c) =>
          c.type === "horizontal" || c.type === "corner-top-right" ||
          c.type === "corner-bottom-right" || c.type === "tee-right"
        );
        const dashColor = rightConn ? connColor(rightConn) : nodeColor;
        result.push({ char: "─", color: dashColor });
      } else if (col === nodeCol && hasLeftConnection) {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      } else {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      }
    } else if (teeLeft) {
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "├", color: connColor(teeLeft) });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        result.push({ char: "├─", color: connColor(teeLeft) });
      }
    } else if (teeRight) {
      result.push({ char: "┤ ", color: connColor(teeRight) });
    } else if (cornerTopRight) {
      result.push({ char: "╮ ", color: connColor(cornerTopRight) });
    } else if (cornerTopLeft) {
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "╭", color: connColor(cornerTopLeft) });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        result.push({ char: "╭─", color: connColor(cornerTopLeft) });
      }
    } else if (cornerBottomRight) {
      result.push({ char: "╯ ", color: connColor(cornerBottomRight) });
    } else if (cornerBottomLeft) {
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "╰", color: connColor(cornerBottomLeft) });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        result.push({ char: "╰─", color: connColor(cornerBottomLeft) });
      }
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

  // Pad to fixed width if requested.
  // We track total character width rather than array length because
  // focus-mode glyph splitting (e.g. "╭" + "─" as two entries for one column)
  // inflates the array length beyond the column count.
  if (padToColumns !== undefined) {
    const targetWidth = padToColumns * 2; // 2 chars per column
    let currentWidth = 0;
    for (const gc of result) currentWidth += gc.char.length;
    while (currentWidth < targetWidth) {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(0, opts) });
      currentWidth += 2;
    }
  }

  return result;
}
