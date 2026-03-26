import type { Commit, GraphRow, GraphColumn, Connector, ConnectorType } from "./types";
import { StyledText, fg, bold } from "@opentui/core";

/** Hard cap on visible graph columns. When the graph exceeds this, the viewport/sliding system activates. */
export const MAX_GRAPH_COLUMNS = 12;

// Fallback colors if no theme colors provided
const DEFAULT_COLORS = [
  "#f38ba8", "#a6e3a1", "#89b4fa", "#f9e2af",
  "#cba6f7", "#94e2d5", "#fab387", "#74c7ec",
  "#f2cdcd", "#89dceb", "#b4befe", "#eba0ac",
];

export function getColorForColumn(column: number, colors: string[] = DEFAULT_COLORS): string {
  return colors[column % colors.length];
}

/** Convenience wrapper: resolve a color index using a RenderOptions bag. */
function getBaseColor(column: number, opts: RenderOptions): string {
  return getColorForColumn(column, opts.themeColors);
}

/**
 * Walk the first-parent chain starting from `startHash`, calling `visit`
 * for each hash encountered. Stops when there are no more parents or
 * when `visit` returns `false` (early exit).
 */
function walkFirstParentChain(
  startHash: string | undefined,
  commitMap: Map<string, Commit>,
  visit: (hash: string) => boolean | void,
): void {
  let h = startHash;
  while (h) {
    if (visit(h) === false) break;
    const c = commitMap.get(h);
    h = c?.parents[0];
  }
}

/**
 * Phase 1: Build lookup maps from the commit list.
 *
 * - commitMap: hash → Commit for O(1) lookups
 * - childrenMap: parent hash → child hashes (reverse of parents[])
 * - currentBranchHashes: set of hashes on the current branch's first-parent chain
 */
function buildLookupMaps(commits: Commit[]): {
  commitMap: Map<string, Commit>;
  childrenMap: Map<string, string[]>;
  currentBranchHashes: Set<string>;
} {
  const commitMap = new Map<string, Commit>();
  for (const c of commits) commitMap.set(c.hash, c);

  const childrenMap = new Map<string, string[]>();
  for (const c of commits) {
    for (const p of c.parents) {
      let arr = childrenMap.get(p);
      if (!arr) { arr = []; childrenMap.set(p, arr); }
      arr.push(c.hash);
    }
  }

  const currentBranchHashes = new Set<string>();
  {
    let tipHash: string | undefined;
    for (const c of commits) {
      if (c.refs.some((r) => r.isCurrent)) {
        tipHash = c.hash;
        break;
      }
    }
    if (tipHash) {
      walkFirstParentChain(tipHash, commitMap, (h) => { currentBranchHashes.add(h); });
    }
  }

  return { commitMap, childrenMap, currentBranchHashes };
}

/**
 * Phase 2: Compute branch ownership and remote-only classification.
 *
 * Determines which branch each commit belongs to (branchNameMap),
 * which branch names are remote-only (remoteOnlyBranches), and
 * which individual commit hashes are on remote-only branches (remoteOnlyHashes).
 *
 * Uses priority-sorted tip collection with 5 priority levels and
 * last-writer-wins via first-parent chain walks.
 */
function computeBranchOwnership(commits: Commit[], commitMap: Map<string, Commit>): {
  branchNameMap: Map<string, string>;
  remoteOnlyBranches: Set<string>;
  remoteOnlyHashes: Set<string>;
} {
  // Collect local and remote branch names from refs
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

  // A remote branch is remote-only if stripping the remote prefix gives a
  // name that is NOT in localBranchNames.
  const remoteOnlyBranches = new Set<string>();
  for (const remoteName of remoteBranchTipNames) {
    const slashIdx = remoteName.indexOf("/");
    const localEquivalent = slashIdx !== -1 ? remoteName.slice(slashIdx + 1) : remoteName;
    if (!localBranchNames.has(localEquivalent)) {
      remoteOnlyBranches.add(remoteName);
    }
  }

  // Determine which local branches have a remote tracking counterpart.
  const trackedLocalBranches = new Set<string>();
  for (const remoteName of remoteBranchTipNames) {
    const slashIdx = remoteName.indexOf("/");
    const localEquivalent = slashIdx !== -1 ? remoteName.slice(slashIdx + 1) : remoteName;
    if (localBranchNames.has(localEquivalent)) {
      trackedLocalBranches.add(localEquivalent);
    }
  }

  // Build topo-order index map for tiebreaking
  const commitTopoIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    commitTopoIndex.set(commits[i].hash, i);
  }

  // Collect tips with priority levels:
  //   0 = current branch (tracked)
  //   1 = current branch (untracked) or local tracked branch
  //   2 = local untracked branch
  //   3 = tracked remote (has local counterpart)
  //   4 = remote-only
  const tips: { hash: string; name: string; priority: number; topoIdx: number }[] = [];
  for (const c of commits) {
    for (const r of c.refs) {
      if (r.type === "tag") continue;
      let priority: number;
      if (r.type === "branch" && r.isCurrent) {
        priority = trackedLocalBranches.has(r.name) ? 0 : 1;
      } else if (r.type === "branch") {
        priority = trackedLocalBranches.has(r.name) ? 1 : 2;
      } else if (r.type === "remote" && !remoteOnlyBranches.has(r.name)) {
        priority = 3;
      } else {
        priority = 4;
      }
      tips.push({ hash: c.hash, name: r.name, priority, topoIdx: commitTopoIndex.get(c.hash) ?? 0 });
    }
  }

  // Sort: lowest priority first → last-writer-wins means highest priority overwrites
  tips.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.topoIdx - a.topoIdx;
  });

  // Walk first-parent chains — last writer wins
  const branchNameMap = new Map<string, string>();
  for (const tip of tips) {
    walkFirstParentChain(tip.hash, commitMap, (h) => { branchNameMap.set(h, tip.name); });
  }

  // Build remoteOnlyHashes: commits on remote-only branches that are NOT
  // reachable from any non-remote-only branch's first-parent chain.
  const nonRemoteOnlyHashes = new Set<string>();
  for (const c of commits) {
    const hasNonRemoteOnlyRef = c.refs.some((r) => {
      if (r.type === "tag") return true;
      if (r.type === "branch") return true;
      if (r.type === "remote") return !remoteOnlyBranches.has(r.name);
      return false;
    });
    if (!hasNonRemoteOnlyRef) continue;
    walkFirstParentChain(c.hash, commitMap, (h) => {
      if (nonRemoteOnlyHashes.has(h)) return false;
      nonRemoteOnlyHashes.add(h);
    });
  }

  const remoteOnlyHashes = new Set<string>();
  for (const [hash, branchName] of branchNameMap) {
    if (remoteOnlyBranches.has(branchName) && !nonRemoteOnlyHashes.has(hash)) {
      remoteOnlyHashes.add(hash);
    }
  }

  return { branchNameMap, remoteOnlyBranches, remoteOnlyHashes };
}

/**
 * Post-pass: fix parentColors using definitive nodeColor values.
 *
 * During the main loop, parentLaneColors captures lane colors from the
 * child's perspective. The parent's actual nodeColor may differ. This
 * overwrites with the definitive color when the parent was processed.
 */
function fixParentColors(rows: GraphRow[], nodeColorByHash: Map<string, number>): void {
  for (const row of rows) {
    for (let i = 0; i < row.parentHashes.length; i++) {
      const parentNodeColor = nodeColorByHash.get(row.parentHashes[i]);
      if (parentNodeColor !== undefined) {
        row.parentColors[i] = parentNodeColor;
      }
    }
  }
}

/**
 * Post-pass: dim all rows above the first non-remote-only row.
 *
 * If the topmost rows are only remote-only branches (e.g. renovate/*),
 * everything above the first tracked branch should appear dimmed.
 */
function dimLeadingRemoteOnlyRows(rows: GraphRow[]): void {
  let firstNonRemoteOnlyRow = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].isRemoteOnly) {
      firstNonRemoteOnlyRow = i;
      break;
    }
  }
  if (firstNonRemoteOnlyRow > 0) {
    for (let i = 0; i < firstNonRemoteOnlyRow; i++) {
      const row = rows[i];
      for (const conn of row.connectors) {
        conn.isRemoteOnly = true;
      }
      for (const col of row.columns) {
        col.isRemoteOnly = true;
      }
      if (row.fanOutRows) {
        for (const foRow of row.fanOutRows) {
          for (const conn of foRow) {
            conn.isRemoteOnly = true;
          }
        }
      }
    }
  }
}

/**
 * Add connectors spanning from one column to another.
 *
 * @param connectors - The mutable connector array to push into
 * @param laneColors - Current lane color index array
 * @param from - Source column (typically the node column)
 * @param to - Target column
 * @param color - Color index for branch connectors (new lane's color)
 * @param kind - "merge" (lane continues, T-junction), "branch" (new lane, corner),
 *               or "close" (lane ending, bottom corner)
 * @param remoteOnly - Whether these connectors belong to a remote-only branch
 */
function addSpanningConnectors(
  connectors: Connector[],
  laneColors: number[],
  from: number,
  to: number,
  color: number,
  kind: "merge" | "branch" | "close",
  remoteOnly?: boolean,
): void {
  if (from === to) return;

  const goingRight = to > from;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  // Horizontal connectors always use the OTHER branch's color (the lane
  // at `to`, not the node's lane). This is consistent regardless of merge
  // direction: horizontals represent the connection to the other branch.
  const hColor = laneColors[to];

  // Intermediate columns between node and target get horizontal lines.
  for (let col = lo + 1; col < hi; col++) {
    connectors.push({
      type: "horizontal",
      color: hColor,
      column: col,
      isRemoteOnly: remoteOnly,
    });
  }

  // Connector at the target column.
  if (kind === "merge") {
    // Target lane continues — T-junction on its direct line → use target lane color
    connectors.push({
      type: goingRight ? "tee-right" : "tee-left",
      color: laneColors[to],
      column: to,
      isRemoteOnly: remoteOnly,
    });
  } else if (kind === "close") {
    // Target lane is being closed — corner is the last point of that lane.
    connectors.push({
      type: goingRight ? "corner-bottom-right" : "corner-bottom-left",
      color: laneColors[to],
      column: to,
      isRemoteOnly: remoteOnly,
    });
  } else {
    // Branching into a new lane — corner starts a new lane → use the new lane's color
    connectors.push({
      type: goingRight ? "corner-top-right" : "corner-top-left",
      color,
      column: to,
      isRemoteOnly: remoteOnly,
    });
  }
}

/**
 * Fan-out + commit-row merge optimization.
 *
 * When a commit has fan-out rows AND merge/branch connectors on its
 * commit row, check if the last fan-out row's connector and the commit
 * row's connectors are on OPPOSITE sides of the node column. If so,
 * combine them into a single row so the commit renders as 1 block
 * instead of 2. Keep 2 rows when connectors conflict on the same side.
 */
function optimizeFanOutMerge(
  fanOutRows: Connector[][],
  connectors: Connector[],
  nodeColumn: number,
): void {
  if (fanOutRows.length === 0) return;

  // Determine which side the last fan-out row's corner is on
  const lastFO = fanOutRows[fanOutRows.length - 1];
  const foCorner = lastFO.find(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );

  // Collect merge/branch connectors from the commit row
  // (horizontals, corners, tees at columns other than nodeColumn)
  const commitMBConnectors = connectors.filter(c =>
    c.column !== nodeColumn && (
      c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
      c.type === "corner-top-right" || c.type === "corner-top-left" ||
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    )
  );

  if (!foCorner || commitMBConnectors.length === 0) return;

  const foSide = foCorner.column < nodeColumn ? "left" : "right";

  // Determine sides of commit-row merge/branch connectors
  let hasLeft = false;
  let hasRight = false;
  for (const c of commitMBConnectors) {
    if (c.column < nodeColumn) hasLeft = true;
    if (c.column > nodeColumn) hasRight = true;
  }

  // Can merge if ALL commit-row connectors are on the opposite side
  const canMerge = (foSide === "left" && !hasLeft && hasRight) ||
                   (foSide === "right" && !hasRight && hasLeft);

  if (!canMerge) return;

  // Combine: add commit-row merge/branch connectors to the last fan-out row
  const combined = [...lastFO];

  for (const mc of commitMBConnectors) {
    // Check if there's already a connector at this column
    const existing = combined.find(c => c.column === mc.column);
    if (existing) {
      // If existing is empty, replace it; otherwise add alongside (crossing)
      if (existing.type === "empty") {
        const idx = combined.indexOf(existing);
        combined[idx] = mc;
      } else {
        combined.push(mc);
      }
    } else {
      combined.push(mc);
    }
  }

  // Fix the tee direction at the node column for the combined row.
  // tee-left (├) → renders █─ (arm goes RIGHT)
  // tee-right (┤) → renders █  (arm goes LEFT)
  // If we now have connectors on the RIGHT side, we need tee-left
  // so the █─ connects to the right-side horizontals.
  const teeIdx = combined.findIndex(c =>
    c.column === nodeColumn && (c.type === "tee-left" || c.type === "tee-right")
  );
  if (teeIdx !== -1) {
    if (hasRight && combined[teeIdx].type === "tee-right") {
      combined[teeIdx] = { ...combined[teeIdx], type: "tee-left" };
    }
    // Note: foSide=right + hasLeft case: tee-left is already correct
    // (arm toward right fan-out corner; left-side merge connectors
    // approach via horizontals at col < nodeColumn).
  }

  // Replace the last fan-out row with the combined version
  fanOutRows[fanOutRows.length - 1] = combined;

  // Strip absorbed merge/branch connectors from the commit row.
  // Replace them with empties so commitRowHasConnections() returns false
  // in the renderer, allowing the last fan-out row to be used as the
  // commit row's graph (single block).
  for (const mc of commitMBConnectors) {
    const idx = connectors.findIndex(c => c === mc);
    if (idx !== -1) {
      connectors[idx] = { type: "empty", color: 0, column: mc.column };
    }
  }
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
  // Phase 1: Build lookup maps
  const { commitMap, childrenMap, currentBranchHashes } = buildLookupMaps(commits);

  // Phase 2: Compute branch ownership and remote-only classification
  const { branchNameMap, remoteOnlyBranches, remoteOnlyHashes } = computeBranchOwnership(commits, commitMap);

  // Phase 3: Main loop — assign lanes, build connectors, create rows
  const rows: GraphRow[] = [];
  let lanes: (string | null)[] = [];
  let laneRemoteOnly: boolean[] = [];
  let laneColors: number[] = [];
  let nextColorIdx = 0;
  const nodeColorByHash = new Map<string, number>();
  const processedColumns = new Map<string, number>();

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    // Find which lane this commit occupies
    let nodeColumn = lanes.indexOf(commit.hash);
    if (nodeColumn === -1) {
      // New commit not tracked in any lane.
      // Try to reuse an interior null lane (a gap between active lanes) to
      // keep the graph compact. Only reuse gaps, not trailing nulls — the
      // trailing null cleanup already handles those.
      let reuseIdx = -1;
      for (let j = 0; j < lanes.length; j++) {
        if (lanes[j] === null) {
          // Check if there's an active lane after this one (i.e., it's a gap)
          let hasActiveAfter = false;
          for (let k = j + 1; k < lanes.length; k++) {
            if (lanes[k] !== null) { hasActiveAfter = true; break; }
          }
          if (hasActiveAfter) {
            reuseIdx = j;
            break;
          }
        }
      }
      if (reuseIdx !== -1) {
        nodeColumn = reuseIdx;
        lanes[reuseIdx] = commit.hash;
        laneRemoteOnly[reuseIdx] = remoteOnlyHashes.has(commit.hash);
        laneColors[reuseIdx] = nextColorIdx++;
      } else {
        nodeColumn = lanes.length;
        lanes.push(commit.hash);
        laneRemoteOnly.push(remoteOnlyHashes.has(commit.hash));
        laneColors.push(nextColorIdx++);
      }
    }

    // Fan-out: find all OTHER lanes that also track this commit's hash.
    // This happens when multiple children pointed to the same parent
    // and we didn't merge them early (we keep lanes independent until the
    // parent commit is reached). Now close those extra lanes with
    // branch-off connectors (╰ or ╯) so the graph shows the fan-out.
    const extraLanes: number[] = [];
    for (let col = 0; col < lanes.length; col++) {
      if (col !== nodeColumn && lanes[col] === commit.hash) {
        extraLanes.push(col);
      }
    }

    const isCommitOnCurrentBranch = currentBranchHashes.has(commit.hash);

    // Capture the node's lane color BEFORE any parent processing or lane cleanup,
    // because those operations may pop/overwrite laneColors entries.
    const nodeColor = laneColors[nodeColumn];

    // Build connectors for this row
    const connectors: Connector[] = [];

    // First, draw all passing-through lanes and the node.
    // Use laneFocused[] to determine if a lane belongs to the focused branch path.
    const isCommitRemoteOnly = remoteOnlyHashes.has(commit.hash);

    for (let col = 0; col < lanes.length; col++) {
      if (col === nodeColumn) {
        connectors.push({
          type: "node",
          color: laneColors[col],
          column: col,
          isRemoteOnly: isCommitRemoteOnly,
        });
      } else if (lanes[col] !== null) {
        connectors.push({
          type: "straight",
          color: laneColors[col],
          column: col,
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

    // Spanning connectors (merge/branch/close) between node and target lanes
    const addSpan = (
      from: number, to: number, color: number,
      kind: "merge" | "branch" | "close", remoteOnly?: boolean,
    ) => addSpanningConnectors(connectors, laneColors, from, to, color, kind, remoteOnly);

    // Build fan-out rows: when this commit has multiple lanes pointing to it,
    // each extra lane gets its own connector row showing a branch-off corner.
    // Fan-out rows render ABOVE the parent commit (graph flows bottom-to-top:
    // oldest at bottom, newest at top). Children's lanes come from above and
    // converge at the parent. Sort farthest-first so outermost lanes close
    // first (topmost fan-out row) and closest lanes close last (right above ●).
    const fanOutRows: Connector[][] = [];
    if (extraLanes.length > 0) {
      const sorted = [...extraLanes].sort(
        (a, b) => Math.abs(b - nodeColumn) - Math.abs(a - nodeColumn)
      );

      // Track which extra lanes are still active (not yet closed).
      // We'll close them one per fan-out row, farthest first.
      const stillActive = new Set(extraLanes);

      for (const extraCol of sorted) {
        const fanOutConnectors: Connector[] = [];
        const extraRemoteOnly = laneRemoteOnly[extraCol];
        const goingRight = extraCol > nodeColumn;
        const lo = Math.min(nodeColumn, extraCol);
        const hi = Math.max(nodeColumn, extraCol);

        // Build the connector row: straight lines for all active lanes,
        // horizontal connectors between node and extra lane, corner at the end.
        // When a horizontal crosses an active lane, we emit BOTH a straight and
        // a horizontal connector at the same column — renderFanOutRow will
        // combine them into a crossing glyph (┼─).
        // 
        // Fan-out rows render ABOVE the parent commit. The child lane comes
        // from above (going DOWN) and terminates here, curving inward to the
        // parent column. So the corner is "bottom" (╯/╰) — line ends here,
        // connecting upward to the child and horizontally to the parent.
        for (let col = 0; col < lanes.length; col++) {
          if (col === extraCol) {
            // This is the lane we're closing — bottom corner here
            // ╯ if extra is to the right (line from above turns left to parent)
            // ╰ if extra is to the left (line from above turns right to parent)
            fanOutConnectors.push({
              type: goingRight ? "corner-bottom-right" : "corner-bottom-left",
              color: laneColors[extraCol],
              column: col,
              isRemoteOnly: extraRemoteOnly,
            });
          } else if (col === nodeColumn) {
            fanOutConnectors.push({
              type: goingRight ? "tee-left" : "tee-right",
              color: laneColors[nodeColumn],
              column: col,
              isRemoteOnly: isCommitRemoteOnly,
            });
          } else if (col > lo && col < hi) {
            // Between node and extra lane.
            // Check if there's an active lane at this column (crossing).
            const isActiveLane = lanes[col] !== null;
            if (isActiveLane) {
              // Active lane being crossed by the horizontal — emit both
              // connectors. The renderer will combine these into ┼─.
              fanOutConnectors.push({
                type: "straight",
                color: laneColors[col],
                column: col,
                isRemoteOnly: laneRemoteOnly[col],
              });
              fanOutConnectors.push({
                type: "horizontal",
                color: laneColors[extraCol],
                column: col,
                isRemoteOnly: extraRemoteOnly,
              });
            } else {
              // Empty column — just horizontal passing through
              fanOutConnectors.push({
                type: "horizontal",
                color: laneColors[extraCol],
                column: col,
                isRemoteOnly: extraRemoteOnly,
              });
            }
          } else if ((lanes[col] !== null && col !== extraCol) || stillActive.has(col)) {
            // Active lane passing through (either regular lane or another extra)
            fanOutConnectors.push({
              type: "straight",
              color: laneColors[col],
              column: col,
              isRemoteOnly: laneRemoteOnly[col],
            });
          } else {
            fanOutConnectors.push({
              type: "empty",
              color: 0,
              column: col,
            });
          }
        }

        fanOutRows.push(fanOutConnectors);

        // Mark this extra lane as closed
        stillActive.delete(extraCol);
        lanes[extraCol] = null;
        laneRemoteOnly[extraCol] = false;
      }

      // Remove stray "straight" connectors for lanes closed by fan-out.
      // The initial connectors were built before fan-out processing, so they
      // still contain │ for extra lanes that are now closed. Replace them with
      // empties so the commit row doesn't show dangling vertical lines.
      for (const extraCol of extraLanes) {
        const idx = connectors.findIndex(c => c.column === extraCol && c.type === "straight");
        if (idx !== -1) {
          connectors[idx] = { type: "empty", color: 0, column: extraCol };
        }
      }
    }

    // Now handle parents and generate merge/branch connectors
    const parents = commit.parents;
    const parentLaneColors: number[] = [];

    if (parents.length === 0) {
      // Root commit -- close this lane
      lanes[nodeColumn] = null;
      laneRemoteOnly[nodeColumn] = false;
    } else if (parents.length === 1) {
      const parentHash = parents[0];
      const parentRemoteOnly = remoteOnlyHashes.has(parentHash);
      const laneRemoteOnlyValue = isCommitRemoteOnly || parentRemoteOnly;
      const existingLane = lanes.indexOf(parentHash);
      if (existingLane !== -1 && existingLane !== nodeColumn) {
        if (processedColumns.has(parentHash)) {
          // Parent already rendered — merge into it
          if (nodeColumn < existingLane) {
            addSpan(nodeColumn, existingLane, existingLane, "close", isCommitRemoteOnly);
            lanes[existingLane] = null;
            laneRemoteOnly[existingLane] = false;
            lanes[nodeColumn] = parentHash;
            laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
            parentLaneColors.push(laneColors[nodeColumn]);
          } else {
            addSpan(nodeColumn, existingLane, nodeColumn, "merge", isCommitRemoteOnly);
            lanes[nodeColumn] = null;
            laneRemoteOnly[nodeColumn] = false;
            parentLaneColors.push(laneColors[existingLane]);
          }
        } else {
          lanes[nodeColumn] = parentHash;
          laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
          parentLaneColors.push(laneColors[nodeColumn]);
        }
      } else if (existingLane === nodeColumn) {
        lanes[nodeColumn] = parentHash;
        laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
        parentLaneColors.push(laneColors[nodeColumn]);
      } else if (processedColumns.has(parentHash)) {
        const parentCol = processedColumns.get(parentHash)!;
        if (parentCol !== nodeColumn) {
          const targetActive = parentCol < lanes.length && lanes[parentCol] !== null;
          addSpan(nodeColumn, parentCol, nodeColumn, targetActive ? "merge" : "close", isCommitRemoteOnly);
        }
        lanes[nodeColumn] = null;
        laneRemoteOnly[nodeColumn] = false;
        parentLaneColors.push(laneColors[parentCol] ?? nodeColor);
      } else {
        lanes[nodeColumn] = parentHash;
        laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
        parentLaneColors.push(laneColors[nodeColumn]);
      }
    } else {
      // Merge commit -- first parent continues the lane, others open new lanes.
      const firstParent = parents[0];
      const firstParentRemoteOnly = remoteOnlyHashes.has(firstParent);
      const firstParentLaneROValue = isCommitRemoteOnly || firstParentRemoteOnly;
      const firstParentLane = lanes.indexOf(firstParent);
      if (firstParentLane !== -1 && firstParentLane !== nodeColumn) {
        if (processedColumns.has(firstParent)) {
          addSpan(nodeColumn, firstParentLane, firstParentLane, "close", isCommitRemoteOnly);
          lanes[firstParentLane] = null;
          laneRemoteOnly[firstParentLane] = false;
        }
        lanes[nodeColumn] = firstParent;
        laneRemoteOnly[nodeColumn] = firstParentLaneROValue;
        parentLaneColors.push(laneColors[nodeColumn]);
      } else if (processedColumns.has(firstParent) && firstParentLane === -1) {
        const parentCol = processedColumns.get(firstParent)!;
        if (parentCol !== nodeColumn) {
          const targetActive = parentCol < lanes.length && lanes[parentCol] !== null;
          addSpan(nodeColumn, parentCol, nodeColumn, targetActive ? "merge" : "close", isCommitRemoteOnly);
        }
        lanes[nodeColumn] = null;
        laneRemoteOnly[nodeColumn] = false;
        parentLaneColors.push(laneColors[parentCol] ?? nodeColor);
      } else {
        lanes[nodeColumn] = firstParent;
        laneRemoteOnly[nodeColumn] = firstParentLaneROValue;
        parentLaneColors.push(laneColors[nodeColumn]);
      }

      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        const pRemoteOnly = remoteOnlyHashes.has(parentHash);
        const pLaneROValue = isCommitRemoteOnly || pRemoteOnly;
        const existingLane = lanes.indexOf(parentHash);
        if (existingLane !== -1) {
          parentLaneColors.push(laneColors[existingLane]);
          if (existingLane !== nodeColumn) {
            addSpan(nodeColumn, existingLane, existingLane, "merge", pLaneROValue);
          }
        } else if (processedColumns.has(parentHash)) {
          const parentCol = processedColumns.get(parentHash)!;
          parentLaneColors.push(laneColors[parentCol] ?? parentCol);
          if (parentCol !== nodeColumn) {
            const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
            addSpan(nodeColumn, parentCol, laneColors[parentCol] ?? parentCol, kind, pLaneROValue);
          }
        } else {
          // Open a new lane for this parent
          const emptyIdx = lanes.indexOf(null);
          let newLane: number;
          if (emptyIdx !== -1) {
            newLane = emptyIdx;
            lanes[emptyIdx] = parentHash;
            laneRemoteOnly[emptyIdx] = pLaneROValue;
            laneColors[emptyIdx] = nextColorIdx++;
          } else {
            newLane = lanes.length;
            lanes.push(parentHash);
            laneRemoteOnly.push(pLaneROValue);
            laneColors.push(nextColorIdx++);
          }
          parentLaneColors.push(laneColors[newLane]);
          // Add spanning connectors from nodeColumn to the new lane
          addSpan(nodeColumn, newLane, laneColors[newLane], "branch", pLaneROValue);
        }
      }
    }

    const mergeSourceColor = parentLaneColors.length >= 2 ? parentLaneColors[1] : undefined;

    // ── Fan-out + commit-row merge optimization ──
    optimizeFanOutMerge(fanOutRows, connectors, nodeColumn);

    // Clean up trailing null lanes.
    // Always pop trailing nulls to keep the graph compact.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneRemoteOnly.pop();
      laneColors.pop();
    }

    // Build the columns for this row (snapshot of active lanes AFTER parent processing)
    const columns: GraphColumn[] = lanes.map((lane, idx) => ({
      color: laneColors[idx] ?? idx,
      active: lane !== null,
      isRemoteOnly: laneRemoteOnly[idx],
    }));

    // Record this commit's lane color for child lookups.
    nodeColorByHash.set(commit.hash, nodeColor);

    const commitBranch = branchNameMap.get(commit.hash) ?? "";

    // Build parent list with branch names and colors.
    // Sort: same-branch parents first (stable, preserving row order within groups).
    const parentEntries = parents.map((p, i) => ({
      hash: p,
      branch: branchNameMap.get(p) ?? "",
      color: parentLaneColors[i],
    }));
    parentEntries.sort((a, b) => {
      const aMatch = a.branch === commitBranch && commitBranch !== "" ? 0 : 1;
      const bMatch = b.branch === commitBranch && commitBranch !== "" ? 0 : 1;
      return aMatch - bMatch;
    });
    const parentHashes = parentEntries.map((e) => e.hash);
    const parentBranches = parentEntries.map((e) => e.branch);
    const parentColors = parentEntries.map((e) => e.color);

    // Build child list with branch names and colors.
    // Sort: same-branch children first (stable, preserving row order within groups).
    const rawChildren = childrenMap.get(commit.hash) ?? [];
    const childEntries = rawChildren.map((h) => ({
      hash: h,
      branch: branchNameMap.get(h) ?? "",
      color: nodeColorByHash.get(h) ?? nodeColor,
    }));
    childEntries.sort((a, b) => {
      const aMatch = a.branch === commitBranch && commitBranch !== "" ? 0 : 1;
      const bMatch = b.branch === commitBranch && commitBranch !== "" ? 0 : 1;
      return aMatch - bMatch;
    });
    const children = childEntries.map((e) => e.hash);
    const childBranches = childEntries.map((e) => e.branch);
    const childColors = childEntries.map((e) => e.color);

    rows.push({
      commit,
      columns,
      nodeColumn,
      connectors,
      isOnCurrentBranch: isCommitOnCurrentBranch,
      nodeColor,
      branchName: branchNameMap.get(commit.hash) ?? "",
      mergeBranch: parents.length >= 2 ? branchNameMap.get(parents[1]) ?? "" : undefined,
      mergeTarget: parents.length >= 2 ? branchNameMap.get(parents[0]) ?? "" : undefined,
      mergeSourceColor,
      parentHashes,
      parentBranches,
      parentColors,
      children,
      childBranches,
      childColors,
      isRemoteOnly: isCommitRemoteOnly,
      remoteOnlyBranches,
      fanOutRows: fanOutRows.length > 0 ? fanOutRows : undefined,
    });

    // Record this commit as processed with its column, so later commits
    // whose parents point here can detect the parent was already rendered.
    processedColumns.set(commit.hash, nodeColumn);
  }

  // Phase 4: Post-passes
  fixParentColors(rows, nodeColorByHash);
  dimLeadingRemoteOnlyRows(rows);

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
  padColor?: string;
}

/**
 * Pad a GraphChar[] result to fill `padToColumns` columns (2 chars each).
 * Uses character-width tracking to handle multi-entry glyphs correctly.
 */
function padResult(result: GraphChar[], padToColumns: number | undefined, opts: RenderOptions): void {
  if (padToColumns === undefined) return;
  const targetWidth = padToColumns * 2;
  let currentWidth = 0;
  for (const gc of result) currentWidth += gc.char.length;
  const color = getBaseColor(0, opts);
  while (currentWidth < targetWidth) {
    result.push({ char: "  ", color });
    currentWidth += 2;
  }
}

/**
 * Configuration for the shared connector-to-glyph renderer.
 * The tee glyphs differ between commit rows (├/┤) and fan-out rows (█/█).
 */
interface ConnectorGlyphConfig {
  teeLeftChar: string;    // "├" for commit rows, "█" for fan-out rows
  teeRightGlyph: string;  // "┤ " for commit rows, "█ " for fan-out rows
  /** Extra types (besides "horizontal") to check at the next column for tee-left dash color. */
  teeLeftDashExtraTypes?: ConnectorType[];
}

/**
 * Shared connector-to-glyph rendering used by both renderGraphRow and renderFanOutRow.
 *
 * Given the connectors at a single column, pushes the appropriate glyph(s) onto `result`.
 * Handles: teeLeft, teeRight, corners (TR/TL/BR/BL), straight+horizontal crossings,
 * horizontal, straight, and empty. Does NOT handle "node" connectors — the caller
 * must check for those before calling this function.
 *
 * @returns true if glyphs were pushed, false if no known connector was found at this column
 */
function renderConnectorGlyphs(
  connectors: Connector[],
  col: number,
  byCol: Map<number, Connector[]>,
  result: GraphChar[],
  opts: RenderOptions,
  config: ConnectorGlyphConfig,
): boolean {
  function connColor(c: { color: number }): string {
    return getBaseColor(c.color, opts);
  }

  const straight = connectors.find(c => c.type === "straight");
  const horizontal = connectors.find(c => c.type === "horizontal");
  const cornerBR = connectors.find(c => c.type === "corner-bottom-right");
  const cornerBL = connectors.find(c => c.type === "corner-bottom-left");
  const cornerTR = connectors.find(c => c.type === "corner-top-right");
  const cornerTL = connectors.find(c => c.type === "corner-top-left");
  const teeLeft = connectors.find(c => c.type === "tee-left");
  const teeRight = connectors.find(c => c.type === "tee-right");

  if (teeLeft) {
    const teeColor = connColor(teeLeft);
    const nextConns = byCol.get(col + 1);
    const extraTypes = config.teeLeftDashExtraTypes ?? [];
    const nextH = nextConns?.find(c =>
      c.type === "horizontal" || extraTypes.includes(c.type)
    );
    const dashColor = nextH ? connColor(nextH) : teeColor;
    if (dashColor === teeColor) {
      result.push({ char: `${config.teeLeftChar}─`, color: teeColor });
    } else {
      result.push({ char: config.teeLeftChar, color: teeColor });
      result.push({ char: "─", color: dashColor });
    }
  } else if (teeRight) {
    result.push({ char: config.teeRightGlyph, color: connColor(teeRight) });
  } else if (straight && horizontal) {
    // Crossing: ┼ uses the vertical lane's color, ─ uses the horizontal's color
    result.push({ char: "┼", color: connColor(straight) });
    result.push({ char: "─", color: connColor(horizontal) });
  } else if (cornerBR) {
    if (horizontal) {
      result.push({ char: "┴", color: connColor(cornerBR) });
      result.push({ char: "─", color: connColor(horizontal) });
    } else {
      result.push({ char: "╯ ", color: connColor(cornerBR) });
    }
  } else if (cornerBL) {
    const cornerColor = connColor(cornerBL);
    if (horizontal) {
      result.push({ char: "┴", color: cornerColor });
      result.push({ char: "─", color: connColor(horizontal) });
    } else {
      const nextConns = byCol.get(col + 1);
      const nextH = nextConns?.find(c => c.type === "horizontal");
      const dashColor = nextH ? connColor(nextH) : cornerColor;
      if (dashColor === cornerColor) {
        result.push({ char: "╰─", color: cornerColor });
      } else {
        result.push({ char: "╰", color: cornerColor });
        result.push({ char: "─", color: dashColor });
      }
    }
  } else if (cornerTR) {
    if (horizontal) {
      const cornerColor = connColor(cornerTR);
      const hColor = connColor(horizontal);
      result.push({ char: "┬", color: cornerColor });
      result.push({ char: "─", color: hColor });
    } else {
      result.push({ char: "╮ ", color: connColor(cornerTR) });
    }
  } else if (cornerTL) {
    const cornerColor = connColor(cornerTL);
    const nextConns = byCol.get(col + 1);
    const nextH = nextConns?.find(c => c.type === "horizontal");
    const dashColor = nextH ? connColor(nextH) : cornerColor;
    if (dashColor === cornerColor) {
      result.push({ char: "╭─", color: cornerColor });
    } else {
      result.push({ char: "╭", color: cornerColor });
      result.push({ char: "─", color: dashColor });
    }
  } else if (straight) {
    result.push({ char: "│ ", color: connColor(straight), bold: true });
  } else if (horizontal) {
    result.push({ char: "──", color: connColor(horizontal) });
  } else {
    return false;
  }
  return true;
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
      const color = getBaseColor(row.columns[col].color, opts);
      result.push({ char: "│ ", color, bold: true });
    } else {
      result.push({ char: "  ", color: getBaseColor(row.columns[col].color, opts) });
    }
  }

  padResult(result, padToColumns, opts);

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
 * Render a fan-out connector row. These are extra rows below a commit that
 * show branch-off corners for lanes that were all pointing to the same parent.
 * Each fan-out row shows one lane closing with a corner, plus straight lines
 * for active lanes and horizontals spanning from the parent's column.
 *
 * The connectors array is pre-built by buildGraph — one entry per column.
 */
export function renderFanOutRow(fanOutConnectors: Connector[], opts: RenderOptions = {}, nodeColumn?: number): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const result: GraphChar[] = [];

  // Group by column — may have multiple connectors at the same column (crossing)
  const byCol = new Map<number, Connector[]>();
  let maxCol = 0;
  for (const c of fanOutConnectors) {
    const list = byCol.get(c.column) ?? [];
    list.push(c);
    byCol.set(c.column, list);
    if (c.column >= maxCol) maxCol = c.column + 1;
  }

  // Node column uses █ for the commit's block glyph.
  // Other columns (e.g. absorbed merge connectors) use ├/┤ so they
  // don't look like a second commit on the same row.
  const nodeConfig: ConnectorGlyphConfig = {
    teeLeftChar: "█",
    teeRightGlyph: "█ ",
    teeLeftDashExtraTypes: ["corner-bottom-right"],
  };
  const mergeConfig: ConnectorGlyphConfig = {
    teeLeftChar: "├",
    teeRightGlyph: "┤ ",
    teeLeftDashExtraTypes: ["corner-bottom-right"],
  };

  for (let col = 0; col < maxCol; col++) {
    const connectors = byCol.get(col);
    if (!connectors || connectors.length === 0) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
      continue;
    }

    // Use █ only at the node column; ├/┤ at absorbed merge tee columns
    const config = (nodeColumn !== undefined && col === nodeColumn) || nodeColumn === undefined
      ? nodeConfig : mergeConfig;

    if (!renderConnectorGlyphs(connectors, col, byCol, result, opts, config)) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
    }
  }

  padResult(result, padToColumns, opts);

  return result;
}

export function renderGraphRow(row: GraphRow, opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const nodeChar = "█";
  const result: GraphChar[] = [];

  // Determine the max column we need to render
  let maxCol = 0;
  for (const c of row.connectors) {
    if (c.column >= maxCol) maxCol = c.column + 1;
  }
  maxCol = Math.max(maxCol, row.columns.length);

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

  function connColor(c: { color: number }): string {
    return getBaseColor(c.color, opts);
  }

  const config: ConnectorGlyphConfig = {
    teeLeftChar: "├",
    teeRightGlyph: "┤ ",
  };

  for (let col = 0; col < maxCol; col++) {
    const colConnectors = connectorsByCol.get(col) ?? [];

    if (colConnectors.length === 0) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
      continue;
    }

    // Handle node connector (only in commit rows, not fan-out rows)
    const node = colConnectors.find((c) => c.type === "node");
    if (node) {
      const nodeColor = getBaseColor(node.color, opts);
      if (col === nodeCol && hasRightConnection) {
        // The ─ right after █ uses the OTHER branch's color (same as horizontals).
        // For merges: source branch color. For branch-offs: new branch color.
        result.push({ char: nodeChar, color: nodeColor, bold: true });
        // Find the horizontal, corner, or tee connector at col+1 to pick up the other branch's color
        const nextConnectors = connectorsByCol.get(col + 1) ?? [];
        const nextHoriz = nextConnectors.find((c) => c.type === "horizontal");
        const nextCorner = nextConnectors.find((c) =>
          c.type === "corner-top-right" || c.type === "corner-bottom-right" ||
          c.type === "corner-top-left" || c.type === "corner-bottom-left"
        );
        const nextTee = nextConnectors.find((c) =>
          c.type === "tee-left" || c.type === "tee-right"
        );
        const hConn = nextHoriz ?? nextCorner ?? nextTee;
        const dashColor = hConn ? connColor(hConn) : getBaseColor(node.color, opts);
        result.push({ char: "─", color: dashColor });
      } else if (col === nodeCol) {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      }
      continue;
    }

    // Delegate all non-node connectors to the shared glyph renderer
    if (!renderConnectorGlyphs(colConnectors, col, connectorsByCol, result, opts, config)) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
    }
  }

  padResult(result, padToColumns, opts);

  return result;
}

/**
 * Compute per-row horizontal viewport offsets for the sliding graph viewport.
 *
 * @deprecated Superseded by {@link computeSingleViewportOffset} for runtime use.
 * Retained for test coverage. Use `computeSingleViewportOffset` in new code.
 *
 * The viewport shows `depthLimit` columns at a time. It slides smoothly
 * to keep each row's commit node (█) visible. The offset represents the
 * first visible column index.
 *
 * Algorithm (smooth sliding / camera follow):
 * - Start with offset = 0
 * - For each row: if the node is outside the current viewport, shift
 *   the minimum amount needed to bring it into view (with 1 column margin).
 * - Otherwise keep the current offset.
 *
 * Returns an array of offsets (one per row). When depthLimit >= maxColumns,
 * all offsets are 0 (no sliding needed).
 */
export function computeViewportOffsets(
  rows: GraphRow[],
  depthLimit: number,
  maxColumns: number,
): number[] {
  if (depthLimit >= maxColumns) {
    return new Array(rows.length).fill(0);
  }

  const offsets: number[] = [];
  let offset = 0;

  for (const row of rows) {
    const nc = row.nodeColumn;

    if (nc >= offset + depthLimit) {
      // Node is to the right of viewport — shift right.
      // Place node 2 columns from the right edge for context.
      offset = nc - depthLimit + 2;
    } else if (nc < offset) {
      // Node is to the left of viewport — shift left.
      // Place node 1 column from the left edge for context.
      offset = Math.max(0, nc - 1);
    }
    // Otherwise keep current offset

    offsets.push(offset);
  }

  return offsets;
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
