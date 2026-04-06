import type { Commit, Connector, GraphColumn, GraphRow } from "./types";

/**
 * Walk the first-parent chain starting from `startHash`, calling `visit`
 * for each hash encountered. Stops when there are no more parents or
 * when `visit` returns `false` (early exit).
 */
function walkFirstParentChain(
  startHash: string | undefined,
  commitMap: Map<string, Commit>,
  visit: (hash: string) => boolean | undefined,
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
      if (!arr) {
        arr = [];
        childrenMap.set(p, arr);
      }
      arr.push(c.hash);
    }
  }

  const currentBranchHashes = new Set<string>();
  {
    let tipHash: string | undefined;
    for (const c of commits) {
      if (c.refs.some(r => r.isCurrent)) {
        tipHash = c.hash;
        break;
      }
    }
    if (tipHash) {
      walkFirstParentChain(tipHash, commitMap, h => {
        currentBranchHashes.add(h);
      });
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
function computeBranchOwnership(
  commits: Commit[],
  commitMap: Map<string, Commit>,
): {
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
    walkFirstParentChain(tip.hash, commitMap, h => {
      branchNameMap.set(h, tip.name);
    });
  }

  // Build remoteOnlyHashes: commits on remote-only branches that are NOT
  // reachable from any non-remote-only branch's first-parent chain.
  const nonRemoteOnlyHashes = new Set<string>();
  for (const c of commits) {
    const hasNonRemoteOnlyRef = c.refs.some(r => {
      if (r.type === "tag") return true;
      if (r.type === "branch") return true;
      if (r.type === "remote") return !remoteOnlyBranches.has(r.name);
      return false;
    });
    if (!hasNonRemoteOnlyRef) continue;
    walkFirstParentChain(c.hash, commitMap, h => {
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
function optimizeFanOutMerge(fanOutRows: Connector[][], connectors: Connector[], nodeColumn: number): void {
  if (fanOutRows.length === 0) return;

  // Determine which side the last fan-out row's corner is on
  const lastFO = fanOutRows[fanOutRows.length - 1];
  const foCorner = lastFO.find(c => c.type === "corner-bottom-right" || c.type === "corner-bottom-left");

  // Collect merge/branch connectors from the commit row
  // (horizontals, corners, tees at columns other than nodeColumn)
  const commitMBConnectors = connectors.filter(
    c =>
      c.column !== nodeColumn &&
      (c.type === "horizontal" ||
        c.type === "tee-left" ||
        c.type === "tee-right" ||
        c.type === "corner-top-right" ||
        c.type === "corner-top-left" ||
        c.type === "corner-bottom-right" ||
        c.type === "corner-bottom-left"),
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
  const canMerge = (foSide === "left" && !hasLeft && hasRight) || (foSide === "right" && !hasRight && hasLeft);

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
  const teeIdx = combined.findIndex(c => c.column === nodeColumn && (c.type === "tee-left" || c.type === "tee-right"));
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
    const idx = connectors.indexOf(mc);
    if (idx !== -1) {
      connectors[idx] = { type: "empty", color: 0, column: mc.column };
    }
  }
}

/** Mutable lane state threaded through the main build loop. */
interface LaneState {
  lanes: (string | null)[];
  laneRemoteOnly: boolean[];
  laneColors: number[];
  nextColorIdx: number;
}

/**
 * Assign a lane column to the given commit hash.
 *
 * If the hash is already tracked, returns its column. Otherwise, reuses the
 * first interior null gap (to keep the graph compact) or appends a new lane.
 * Mutates `ls` when a new lane is allocated.
 */
function assignNodeColumn(hash: string, isRemoteOnly: boolean, ls: LaneState): number {
  const { lanes, laneRemoteOnly, laneColors } = ls;
  let nodeColumn = lanes.indexOf(hash);
  if (nodeColumn !== -1) return nodeColumn;

  // Find first interior gap (null surrounded by active lanes on the right)
  let reuseIdx = -1;
  for (let j = 0; j < lanes.length; j++) {
    if (lanes[j] === null) {
      let hasActiveAfter = false;
      for (let k = j + 1; k < lanes.length; k++) {
        if (lanes[k] !== null) {
          hasActiveAfter = true;
          break;
        }
      }
      if (hasActiveAfter) {
        reuseIdx = j;
        break;
      }
    }
  }

  if (reuseIdx !== -1) {
    nodeColumn = reuseIdx;
    lanes[reuseIdx] = hash;
    laneRemoteOnly[reuseIdx] = isRemoteOnly;
    laneColors[reuseIdx] = ls.nextColorIdx++;
  } else {
    nodeColumn = lanes.length;
    lanes.push(hash);
    laneRemoteOnly.push(isRemoteOnly);
    laneColors.push(ls.nextColorIdx++);
  }
  return nodeColumn;
}

/**
 * Build the base connector list for a commit row.
 *
 * Emits a "node" connector at `nodeColumn`, "straight" for active passing-through
 * lanes, and "empty" for null lanes.
 */
function buildBaseConnectors(nodeColumn: number, isCommitRemoteOnly: boolean, ls: LaneState): Connector[] {
  const { lanes, laneRemoteOnly, laneColors } = ls;
  const connectors: Connector[] = [];
  for (let col = 0; col < lanes.length; col++) {
    if (col === nodeColumn) {
      connectors.push({ type: "node", color: laneColors[col], column: col, isRemoteOnly: isCommitRemoteOnly });
    } else if (lanes[col] !== null) {
      connectors.push({ type: "straight", color: laneColors[col], column: col, isRemoteOnly: laneRemoteOnly[col] });
    } else {
      connectors.push({ type: "empty", color: 0, column: col });
    }
  }
  return connectors;
}

/**
 * Build fan-out rows for extra lanes that all point to the same commit hash.
 *
 * Mutates `ls` (closes extra lanes) and patches `connectors` to remove stray
 * straights for lanes that were just closed.
 *
 * @returns The fan-out connector rows (one per extra lane, farthest-first).
 */
function buildFanOutRows(
  extraLanes: number[],
  nodeColumn: number,
  isCommitRemoteOnly: boolean,
  connectors: Connector[],
  ls: LaneState,
): Connector[][] {
  const { lanes, laneRemoteOnly, laneColors } = ls;
  if (extraLanes.length === 0) return [];

  const fanOutRows: Connector[][] = [];
  // Sort farthest-first: outermost lane closes first (topmost fan-out row)
  const sorted = [...extraLanes].sort((a, b) => Math.abs(b - nodeColumn) - Math.abs(a - nodeColumn));
  const stillActive = new Set(extraLanes);

  for (const extraCol of sorted) {
    const fanOutConnectors: Connector[] = [];
    const extraRemoteOnly = laneRemoteOnly[extraCol];
    const goingRight = extraCol > nodeColumn;
    const lo = Math.min(nodeColumn, extraCol);
    const hi = Math.max(nodeColumn, extraCol);

    for (let col = 0; col < lanes.length; col++) {
      if (col === extraCol) {
        // Closing corner: ╯ (going right) or ╰ (going left)
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
        // Between node and extra lane — emit horizontal (plus straight for crossings)
        const isActiveLane = lanes[col] !== null;
        if (isActiveLane) {
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
          fanOutConnectors.push({
            type: "horizontal",
            color: laneColors[extraCol],
            column: col,
            isRemoteOnly: extraRemoteOnly,
          });
        }
      } else if ((lanes[col] !== null && col !== extraCol) || stillActive.has(col)) {
        fanOutConnectors.push({
          type: "straight",
          color: laneColors[col],
          column: col,
          isRemoteOnly: laneRemoteOnly[col],
        });
      } else {
        fanOutConnectors.push({ type: "empty", color: 0, column: col });
      }
    }

    fanOutRows.push(fanOutConnectors);
    stillActive.delete(extraCol);
    lanes[extraCol] = null;
    laneRemoteOnly[extraCol] = false;
  }

  // Patch stray "straight" connectors for now-closed extra lanes
  for (const extraCol of extraLanes) {
    const idx = connectors.findIndex(c => c.column === extraCol && c.type === "straight");
    if (idx !== -1) {
      connectors[idx] = { type: "empty", color: 0, column: extraCol };
    }
  }

  return fanOutRows;
}

/**
 * Resolve parent lanes for a commit, mutating `ls` and returning parentLaneColors.
 *
 * Handles three cases: root commit (no parents), single parent, and merge commit
 * (multiple parents). Emits spanning connectors as needed via `addSpan`.
 */
function resolveParentLanes(
  commit: Commit,
  nodeColumn: number,
  nodeColor: number,
  isCommitRemoteOnly: boolean,
  remoteOnlyHashes: Set<string>,
  processedColumns: Map<string, number>,
  connectors: Connector[],
  ls: LaneState,
): number[] {
  const { lanes, laneRemoteOnly, laneColors } = ls;
  const parents = commit.parents;
  const parentLaneColors: number[] = [];

  const addSpan = (from: number, to: number, color: number, kind: "merge" | "branch" | "close", remoteOnly?: boolean) =>
    addSpanningConnectors(connectors, laneColors, from, to, color, kind, remoteOnly);

  if (parents.length === 0) {
    // Root commit — close this lane
    lanes[nodeColumn] = null;
    laneRemoteOnly[nodeColumn] = false;
  } else if (parents.length === 1) {
    const parentHash = parents[0];
    const parentRemoteOnly = remoteOnlyHashes.has(parentHash);
    const laneROValue = isCommitRemoteOnly || parentRemoteOnly;
    const existingLane = lanes.indexOf(parentHash);

    if (existingLane !== -1 && existingLane !== nodeColumn) {
      if (processedColumns.has(parentHash)) {
        // Parent already rendered — merge into it
        if (nodeColumn < existingLane) {
          addSpan(nodeColumn, existingLane, existingLane, "close", isCommitRemoteOnly);
          lanes[existingLane] = null;
          laneRemoteOnly[existingLane] = false;
          lanes[nodeColumn] = parentHash;
          laneRemoteOnly[nodeColumn] = laneROValue;
          parentLaneColors.push(laneColors[nodeColumn]);
        } else {
          addSpan(nodeColumn, existingLane, nodeColumn, "merge", isCommitRemoteOnly);
          lanes[nodeColumn] = null;
          laneRemoteOnly[nodeColumn] = false;
          parentLaneColors.push(laneColors[existingLane]);
        }
      } else {
        lanes[nodeColumn] = parentHash;
        laneRemoteOnly[nodeColumn] = laneROValue;
        parentLaneColors.push(laneColors[nodeColumn]);
      }
    } else if (existingLane === nodeColumn) {
      lanes[nodeColumn] = parentHash;
      laneRemoteOnly[nodeColumn] = laneROValue;
      parentLaneColors.push(laneColors[nodeColumn]);
    } else if (processedColumns.has(parentHash)) {
      const parentCol = processedColumns.get(parentHash) ?? nodeColumn;
      if (parentCol !== nodeColumn) {
        const targetActive = parentCol < lanes.length && lanes[parentCol] !== null;
        addSpan(nodeColumn, parentCol, nodeColumn, targetActive ? "merge" : "close", isCommitRemoteOnly);
      }
      lanes[nodeColumn] = null;
      laneRemoteOnly[nodeColumn] = false;
      parentLaneColors.push(laneColors[parentCol] ?? nodeColor);
    } else {
      lanes[nodeColumn] = parentHash;
      laneRemoteOnly[nodeColumn] = laneROValue;
      parentLaneColors.push(laneColors[nodeColumn]);
    }
  } else {
    // Merge commit — first parent continues the lane, others open new lanes
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
      const parentCol = processedColumns.get(firstParent) ?? nodeColumn;
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

    // Secondary parents — find or open a lane for each
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
        const parentCol = processedColumns.get(parentHash) ?? nodeColumn;
        parentLaneColors.push(laneColors[parentCol] ?? parentCol);
        if (parentCol !== nodeColumn) {
          const kind = parentCol < lanes.length && lanes[parentCol] !== null ? "merge" : "branch";
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
          laneColors[emptyIdx] = ls.nextColorIdx++;
        } else {
          newLane = lanes.length;
          lanes.push(parentHash);
          laneRemoteOnly.push(pLaneROValue);
          laneColors.push(ls.nextColorIdx++);
        }
        parentLaneColors.push(laneColors[newLane]);
        addSpan(nodeColumn, newLane, laneColors[newLane], "branch", pLaneROValue);
      }
    }
  }

  return parentLaneColors;
}

/**
 * Build sorted parent and child relation lists for a graph row.
 *
 * Each list is sorted so same-branch entries come first (stable sort).
 * Returns { parentHashes, parentBranches, parentColors, children, childBranches, childColors }.
 */
function buildRelationEntries(
  commit: Commit,
  commitBranch: string,
  parentLaneColors: number[],
  nodeColor: number,
  branchNameMap: Map<string, string>,
  childrenMap: Map<string, string[]>,
  nodeColorByHash: Map<string, number>,
): {
  parentHashes: string[];
  parentBranches: string[];
  parentColors: number[];
  children: string[];
  childBranches: string[];
  childColors: number[];
} {
  const sameBranchFirst = (branch: string) => (branch === commitBranch && commitBranch !== "" ? 0 : 1);

  const parentEntries = commit.parents.map((p, i) => ({
    hash: p,
    branch: branchNameMap.get(p) ?? "",
    color: parentLaneColors[i],
  }));
  parentEntries.sort((a, b) => sameBranchFirst(a.branch) - sameBranchFirst(b.branch));

  const rawChildren = childrenMap.get(commit.hash) ?? [];
  const childEntries = rawChildren.map(h => ({
    hash: h,
    branch: branchNameMap.get(h) ?? "",
    color: nodeColorByHash.get(h) ?? nodeColor,
  }));
  childEntries.sort((a, b) => sameBranchFirst(a.branch) - sameBranchFirst(b.branch));

  return {
    parentHashes: parentEntries.map(e => e.hash),
    parentBranches: parentEntries.map(e => e.branch),
    parentColors: parentEntries.map(e => e.color),
    children: childEntries.map(e => e.hash),
    childBranches: childEntries.map(e => e.branch),
    childColors: childEntries.map(e => e.color),
  };
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
  const ls: LaneState = { lanes: [], laneRemoteOnly: [], laneColors: [], nextColorIdx: 0 };
  const nodeColorByHash = new Map<string, number>();
  const processedColumns = new Map<string, number>();

  for (const commit of commits) {
    const isCommitRemoteOnly = remoteOnlyHashes.has(commit.hash);

    // 3a. Assign the commit's lane column (reuse gap or append)
    const nodeColumn = assignNodeColumn(commit.hash, isCommitRemoteOnly, ls);

    // 3b. Find extra lanes tracking the same hash (fan-out)
    const extraLanes: number[] = [];
    for (let col = 0; col < ls.lanes.length; col++) {
      if (col !== nodeColumn && ls.lanes[col] === commit.hash) extraLanes.push(col);
    }

    const isCommitOnCurrentBranch = currentBranchHashes.has(commit.hash);
    // Capture node color BEFORE parent processing may overwrite laneColors
    const nodeColor = ls.laneColors[nodeColumn];

    // 3c. Build base connectors (node + straights + empties)
    const connectors = buildBaseConnectors(nodeColumn, isCommitRemoteOnly, ls);

    // 3d. Build fan-out rows, closing extra lanes (mutates ls + connectors)
    const fanOutRows = buildFanOutRows(extraLanes, nodeColumn, isCommitRemoteOnly, connectors, ls);

    // 3e. Resolve parent lanes, emit spanning connectors (mutates ls)
    const parentLaneColors = resolveParentLanes(
      commit,
      nodeColumn,
      nodeColor,
      isCommitRemoteOnly,
      remoteOnlyHashes,
      processedColumns,
      connectors,
      ls,
    );

    const mergeSourceColor = parentLaneColors.length >= 2 ? parentLaneColors[1] : undefined;

    // 3f. Optimize fan-out + merge connector layout
    optimizeFanOutMerge(fanOutRows, connectors, nodeColumn);

    // 3g. Pop trailing null lanes to keep graph compact
    while (ls.lanes.length > 0 && ls.lanes[ls.lanes.length - 1] === null) {
      ls.lanes.pop();
      ls.laneRemoteOnly.pop();
      ls.laneColors.pop();
    }

    // 3h. Snapshot active lane columns for this row
    const columns: GraphColumn[] = ls.lanes.map((lane, idx) => ({
      color: ls.laneColors[idx] ?? idx,
      active: lane !== null,
      isRemoteOnly: ls.laneRemoteOnly[idx],
    }));

    // Record this commit's color so children can look it up
    nodeColorByHash.set(commit.hash, nodeColor);

    const commitBranch = branchNameMap.get(commit.hash) ?? "";

    // 3i. Build sorted parent/child relation entries
    const { parentHashes, parentBranches, parentColors, children, childBranches, childColors } = buildRelationEntries(
      commit,
      commitBranch,
      parentLaneColors,
      nodeColor,
      branchNameMap,
      childrenMap,
      nodeColorByHash,
    );

    rows.push({
      commit,
      columns,
      nodeColumn,
      connectors,
      isOnCurrentBranch: isCommitOnCurrentBranch,
      nodeColor,
      branchName: commitBranch,
      mergeBranch: commit.parents.length >= 2 ? (branchNameMap.get(commit.parents[1]) ?? "") : undefined,
      mergeTarget: commit.parents.length >= 2 ? (branchNameMap.get(commit.parents[0]) ?? "") : undefined,
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

    // Mark this commit as processed so later commits can detect already-rendered parents
    processedColumns.set(commit.hash, nodeColumn);
  }

  // Phase 4: Post-passes
  fixParentColors(rows, nodeColorByHash);
  dimLeadingRemoteOnlyRows(rows);

  return rows;
}
