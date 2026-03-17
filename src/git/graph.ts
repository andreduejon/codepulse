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
  // Parallel array: visual color index for each lane. Decoupled from column index
  // so that lanes reusing interior null slots get fresh colors rather than inheriting
  // the color of whatever previously occupied that column position.
  let laneColors: number[] = [];
  let nextColorIdx = 0;

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
  let currentBranchTipColor = 0;

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
        laneFocused[reuseIdx] = false;
        laneRemoteOnly[reuseIdx] = remoteOnlyHashes.has(commit.hash);
        laneColors[reuseIdx] = nextColorIdx++;
      } else {
        nodeColumn = lanes.length;
        lanes.push(commit.hash);
        laneFocused.push(false);
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

    // Record the tip column for the current branch (used for consistent focus color)
    if (commit.refs.some((r) => r.isCurrent)) {
      currentBranchTipColumn = nodeColumn;
      currentBranchTipColor = laneColors[nodeColumn];
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
          isFocused: isCommitOnCurrentBranch,
          isRemoteOnly: isCommitRemoteOnly,
        });
      } else if (lanes[col] !== null) {
        const laneHash = lanes[col]!;
        connectors.push({
          type: "straight",
          color: laneColors[col],
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
      /** Whether these connectors belong to a remote-only branch */
      remoteOnly?: boolean,
    ) {
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
          isFocused: false,
          isRemoteOnly: remoteOnly,
        });
      }

      // Connector at the target column.
      // For "merge": the target lane continues above and below, so use a
      // T-junction (├ or ┤) instead of a corner. If going right (target is
      // to the right of node), the horizontal arrives from the left →
      // tee-right (┤). If going left, the horizontal arrives from the
      // right → tee-left (├).
      // For "close": the lane terminates here → bottom corner (╯ or ╰).
      // For "branch": a new lane starts here → top corner (╮ or ╭).
      const targetLaneFocused = to < laneFocused.length && laneFocused[to];

      if (kind === "merge") {
        // Target lane continues — T-junction on its direct line → use target lane color
        connectors.push({
          type: goingRight ? "tee-right" : "tee-left",
          color: laneColors[to],
          column: to,
          isFocused: targetLaneFocused,
          isRemoteOnly: remoteOnly,
        });
      } else if (kind === "close") {
        // Target lane is being closed — corner is the last point of that lane.
        // Use the lane's own color so it stays on its direct visual path.
        connectors.push({
          type: goingRight ? "corner-bottom-right" : "corner-bottom-left",
          color: laneColors[to],
          column: to,
          isFocused: targetLaneFocused,
          isRemoteOnly: remoteOnly,
        });
      } else {
        // Branching into a new lane — corner starts a new lane → use the new lane's color
        connectors.push({
          type: goingRight ? "corner-top-right" : "corner-top-left",
          color,
          column: to,
          isFocused: false,
          isRemoteOnly: remoteOnly,
        });
      }
    }

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
        const extraFocused = laneFocused[extraCol];
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
              isFocused: extraFocused,
              isRemoteOnly: extraRemoteOnly,
            });
          } else if (col === nodeColumn) {
            // The parent's vertical line continues, but with a T-junction
            // to show the branch-off. ├ if the extra lane is to the right,
            // ┤ if it's to the left.
            fanOutConnectors.push({
              type: goingRight ? "tee-left" : "tee-right",
              color: laneColors[nodeColumn],
              column: col,
              isFocused: isCommitOnCurrentBranch,
              isRemoteOnly: isCommitRemoteOnly,
            });
          } else if (col > lo && col < hi) {
            // Between node and extra lane.
            // Check if there's an active lane at this column (crossing).
            const isActiveLane = (lanes[col] !== null && !stillActive.has(col)) || 
                                 (stillActive.has(col));
            if (isActiveLane) {
              // Active lane being crossed by the horizontal — emit both
              // connectors. The renderer will combine these into ┼─.
              fanOutConnectors.push({
                type: "straight",
                color: laneColors[col],
                column: col,
                isFocused: laneFocused[col],
                isRemoteOnly: laneRemoteOnly[col],
              });
              fanOutConnectors.push({
                type: "horizontal",
                color: laneColors[extraCol],
                column: col,
                isFocused: false,
                isRemoteOnly: extraRemoteOnly,
              });
            } else {
              // Empty column — just horizontal passing through
              fanOutConnectors.push({
                type: "horizontal",
                color: laneColors[extraCol],
                column: col,
                isFocused: false,
                isRemoteOnly: extraRemoteOnly,
              });
            }
          } else if ((lanes[col] !== null && col !== extraCol) || stillActive.has(col)) {
            // Active lane passing through (either regular lane or another extra)
            fanOutConnectors.push({
              type: "straight",
              color: laneColors[col],
              column: col,
              isFocused: laneFocused[col],
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
        laneFocused[extraCol] = false;
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

    if (parents.length === 0) {
      // Root commit -- close this lane
      lanes[nodeColumn] = null;
      laneFocused[nodeColumn] = false;
      laneRemoteOnly[nodeColumn] = false;
    } else if (parents.length === 1) {
      const parentHash = parents[0];
      const parentFocused = isCommitOnCurrentBranch && currentBranchHashes.has(parentHash);
      const parentRemoteOnly = remoteOnlyHashes.has(parentHash);
      // For the lane's remote-only status: if the current commit is remote-only,
      // the lane stays remote-only (it visually represents the remote-only branch's
      // path to its ancestor). Only when a non-remote-only commit takes over does
      // the lane become non-remote-only.
      const laneRemoteOnlyValue = isCommitRemoteOnly || parentRemoteOnly;
      const existingLane = lanes.indexOf(parentHash);
      if (existingLane !== -1 && existingLane !== nodeColumn) {
        // Another lane already tracks this parent.
        // If the parent has been processed (rendered), we can merge now.
        // If not, keep BOTH lanes tracking the same parent independently
        // so the parent commit can show the fan-out with branch-off corners.
        if (processedColumns.has(parentHash)) {
          // Parent already rendered — merge into it
          if (nodeColumn < existingLane) {
            addSpanningConnectors(nodeColumn, existingLane, existingLane, "close", parentFocused, isCommitRemoteOnly);
            lanes[existingLane] = null;
            laneFocused[existingLane] = false;
            laneRemoteOnly[existingLane] = false;
            lanes[nodeColumn] = parentHash;
            laneFocused[nodeColumn] = parentFocused;
            laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
          } else {
            addSpanningConnectors(nodeColumn, existingLane, nodeColumn, "merge", parentFocused, isCommitRemoteOnly);
            lanes[nodeColumn] = null;
            laneFocused[nodeColumn] = false;
            laneRemoteOnly[nodeColumn] = false;
          }
        } else {
          // Parent NOT yet rendered — don't merge. Keep both lanes
          // tracking the same parent. The parent commit's row will
          // close the extra lanes with branch-off corners (fan-out).
          lanes[nodeColumn] = parentHash;
          laneFocused[nodeColumn] = parentFocused;
          laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
        }
      } else if (existingLane === nodeColumn) {
        lanes[nodeColumn] = parentHash;
        laneFocused[nodeColumn] = parentFocused;
        laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
      } else if (processedColumns.has(parentHash)) {
        const parentCol = processedColumns.get(parentHash)!;
        if (parentCol !== nodeColumn) {
          const targetActive = parentCol < lanes.length && lanes[parentCol] !== null;
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, targetActive ? "merge" : "close", parentFocused, isCommitRemoteOnly);
        }
        lanes[nodeColumn] = null;
        laneFocused[nodeColumn] = false;
        laneRemoteOnly[nodeColumn] = false;
      } else {
        lanes[nodeColumn] = parentHash;
        laneFocused[nodeColumn] = parentFocused;
        laneRemoteOnly[nodeColumn] = laneRemoteOnlyValue;
      }
    } else {
      // Merge commit -- first parent continues the lane, others open new lanes.
      const firstParent = parents[0];
      const firstParentFocused = isCommitOnCurrentBranch && currentBranchHashes.has(firstParent);
      const firstParentRemoteOnly = remoteOnlyHashes.has(firstParent);
      const firstParentLaneROValue = isCommitRemoteOnly || firstParentRemoteOnly;
      const firstParentLane = lanes.indexOf(firstParent);
      if (firstParentLane !== -1 && firstParentLane !== nodeColumn) {
        // Another lane already tracks the first parent.
        // If the parent has been processed, close the other lane now.
        // If not, keep both lanes tracking the same parent — the parent
        // commit's row will show the fan-out with branch-off corners.
        if (processedColumns.has(firstParent)) {
          addSpanningConnectors(nodeColumn, firstParentLane, firstParentLane, "close", firstParentFocused, isCommitRemoteOnly);
          lanes[firstParentLane] = null;
          laneFocused[firstParentLane] = false;
          laneRemoteOnly[firstParentLane] = false;
        }
        lanes[nodeColumn] = firstParent;
        laneFocused[nodeColumn] = firstParentFocused;
        laneRemoteOnly[nodeColumn] = firstParentLaneROValue;
      } else if (processedColumns.has(firstParent) && firstParentLane === -1) {
        const parentCol = processedColumns.get(firstParent)!;
        if (parentCol !== nodeColumn) {
          const targetActive = parentCol < lanes.length && lanes[parentCol] !== null;
          addSpanningConnectors(nodeColumn, parentCol, nodeColumn, targetActive ? "merge" : "close", firstParentFocused, isCommitRemoteOnly);
        }
        lanes[nodeColumn] = null;
        laneFocused[nodeColumn] = false;
        laneRemoteOnly[nodeColumn] = false;
      } else {
        lanes[nodeColumn] = firstParent;
        laneFocused[nodeColumn] = firstParentFocused;
        laneRemoteOnly[nodeColumn] = firstParentLaneROValue;
      }

      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        const pFocused = isCommitOnCurrentBranch && currentBranchHashes.has(parentHash);
        const pRemoteOnly = remoteOnlyHashes.has(parentHash);
        const pLaneROValue = isCommitRemoteOnly || pRemoteOnly;
        const existingLane = lanes.indexOf(parentHash);
        if (existingLane !== -1) {
          if (existingLane !== nodeColumn) {
            addSpanningConnectors(nodeColumn, existingLane, existingLane, "merge", pFocused, pLaneROValue);
          }
        } else if (processedColumns.has(parentHash)) {
          const parentCol = processedColumns.get(parentHash)!;
          if (parentCol !== nodeColumn) {
            const kind = (parentCol < lanes.length && lanes[parentCol] !== null) ? "merge" : "branch";
            addSpanningConnectors(nodeColumn, parentCol, laneColors[parentCol] ?? parentCol, kind, pFocused, pLaneROValue);
          }
        } else {
          // Open a new lane for this parent
          const emptyIdx = lanes.indexOf(null);
          let newLane: number;
          if (emptyIdx !== -1) {
            newLane = emptyIdx;
            lanes[emptyIdx] = parentHash;
            laneFocused[emptyIdx] = pFocused;
            laneRemoteOnly[emptyIdx] = pLaneROValue;
            laneColors[emptyIdx] = nextColorIdx++;
          } else {
            newLane = lanes.length;
            lanes.push(parentHash);
            laneFocused.push(pFocused);
            laneRemoteOnly.push(pLaneROValue);
            laneColors.push(nextColorIdx++);
          }
          // Add spanning connectors from nodeColumn to the new lane
          addSpanningConnectors(nodeColumn, newLane, laneColors[newLane], "branch", pFocused, pLaneROValue);
        }
      }
    }

    // ── Fan-out + commit-row merge optimization ──
    // When a commit has fan-out rows AND merge/branch connectors on its
    // commit row, check if the last fan-out row's connector and the commit
    // row's connectors are on OPPOSITE sides of the node column. If so,
    // combine them into a single row so the commit renders as 1 █ block
    // instead of 2. Keep 2 rows when connectors conflict on the same side.
    if (fanOutRows.length > 0) {
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

      if (foCorner && commitMBConnectors.length > 0) {
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

        if (canMerge) {
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
          // If connectors on the LEFT side only, keep tee-right.
          const teeIdx = combined.findIndex(c =>
            c.column === nodeColumn && (c.type === "tee-left" || c.type === "tee-right")
          );
          if (teeIdx !== -1) {
            const commitHasRight = hasRight;
            if (commitHasRight && combined[teeIdx].type === "tee-right") {
              // Switch from tee-right (█ ) to tee-left (█─) for right-side connection
              combined[teeIdx] = { ...combined[teeIdx], type: "tee-left" };
            } else if (!commitHasRight && hasLeft && combined[teeIdx].type === "tee-left") {
              // Fan-out was right, merge is left — keep tee-left (█─) for the right fan-out
              // Actually this case can't happen: foSide=right means fan-out corner is RIGHT,
              // and canMerge requires hasLeft && !hasRight. The original tee for a right-side
              // fan-out is tee-left (arm toward right corner). Now we have left-side merge
              // connectors too. But tee-left produces █─ which connects rightward to the
              // fan-out corner. The left-side merge connectors at col < nodeColumn just have
              // horizontals approaching from the left — they connect via the horizontal at
              // nodeColumn-1, not via the dash after █. So tee-left is still correct.
            }
          }

          // Replace the last fan-out row with the combined version
          fanOutRows[fanOutRows.length - 1] = combined;

          // Strip absorbed merge/branch connectors from the commit row.
          // Replace them with empties so commitRowHasConnections() returns false
          // in the renderer, allowing the last fan-out row to be used as the
          // commit row's graph (single █ block).
          for (const mc of commitMBConnectors) {
            const idx = connectors.findIndex(c => c === mc);
            if (idx !== -1) {
              connectors[idx] = { type: "empty", color: 0, column: mc.column };
            }
          }
        }
      }
    }

    // Clean up trailing null lanes.
    // Always pop trailing nulls to keep the graph compact.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneFocused.pop();
      laneRemoteOnly.pop();
      laneColors.pop();
    }

    // Build the columns for this row (snapshot of active lanes AFTER parent processing)
    const columns: GraphColumn[] = lanes.map((lane, idx) => ({
      color: laneColors[idx] ?? idx,
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
      currentBranchTipColor,
      nodeColor,
      branchName: branchNameMap.get(commit.hash) ?? "",
      isRemoteOnly: isCommitRemoteOnly,
      remoteOnlyBranches,
      fanOutRows: fanOutRows.length > 0 ? fanOutRows : undefined,
    });

    // Record this commit as processed with its column, so later commits
    // whose parents point here can detect the parent was already rendered.
    processedColumns.set(commit.hash, nodeColumn);
  }

  // Post-pass: dim all rows above the first non-remote-only row.
  // If the topmost rows are only remote-only branches (e.g. renovate/*),
  // everything above the first tracked branch should appear dimmed.
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
      // Force all connectors to remote-only
      for (const conn of row.connectors) {
        conn.isRemoteOnly = true;
      }
      // Force all columns to remote-only
      for (const col of row.columns) {
        col.isRemoteOnly = true;
      }
      // Force all fan-out row connectors to remote-only
      if (row.fanOutRows) {
        for (const foRow of row.fanOutRows) {
          for (const conn of foRow) {
            conn.isRemoteOnly = true;
          }
        }
      }
    }
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
        color = getBaseColor(row.columns[col].color, opts);
      }
      const isBold = !opts.focusMode || !!focused;
      result.push({ char: "│ ", color, bold: isBold });
    } else {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(row.columns[col].color, opts) });
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
export function renderFanOutRow(fanOutConnectors: Connector[], opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const result: GraphChar[] = [];

  // NOTE: connColor is duplicated in renderGraphRow — keep both in sync
  function connColor(c: { color: number; isFocused?: boolean; isRemoteOnly?: boolean }): string {
    const fc = getFocusColor(c.isFocused, opts);
    if (fc) return fc;
    if (c.isRemoteOnly && opts.remoteOnlyDimColor) return opts.remoteOnlyDimColor;
    return getBaseColor(c.color, opts);
  }

  // Group by column — may have multiple connectors at the same column (crossing)
  const byCol = new Map<number, Connector[]>();
  let maxCol = 0;
  for (const c of fanOutConnectors) {
    const list = byCol.get(c.column) ?? [];
    list.push(c);
    byCol.set(c.column, list);
    if (c.column >= maxCol) maxCol = c.column + 1;
  }

  for (let col = 0; col < maxCol; col++) {
    const connectors = byCol.get(col);
    if (!connectors || connectors.length === 0) {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(col, opts) });
      continue;
    }

    // Find specific connector types at this column
    const straight = connectors.find(c => c.type === "straight");
    const horizontal = connectors.find(c => c.type === "horizontal");
    const cornerBR = connectors.find(c => c.type === "corner-bottom-right");
    const cornerBL = connectors.find(c => c.type === "corner-bottom-left");
    const cornerTR = connectors.find(c => c.type === "corner-top-right");
    const cornerTL = connectors.find(c => c.type === "corner-top-left");
    const teeLeft = connectors.find(c => c.type === "tee-left");
    const teeRight = connectors.find(c => c.type === "tee-right");

    if (teeLeft) {
      // █ — block segment at parent's node column (fan-out row).
      // Replaces ├ with █ so the block extends through fan-out rows.
      // Trailing ─ uses the horizontal/branch color.
      const teeColor = connColor(teeLeft);
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "█", color: teeColor });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        const nextConns = byCol.get(col + 1);
        const nextH = nextConns?.find(c => c.type === "horizontal" || c.type === "corner-bottom-right");
        const dashColor = nextH ? connColor(nextH) : teeColor;
        if (dashColor === teeColor) {
          result.push({ char: "█─", color: teeColor });
        } else {
          result.push({ char: "█", color: teeColor });
          result.push({ char: "─", color: dashColor });
        }
      }
    } else if (teeRight) {
      // █ — block segment at parent's node column (fan-out row, branch going left).
      result.push({ char: "█ ", color: connColor(teeRight) });
    } else if (straight && horizontal) {
      // Crossing: ┼ uses the vertical lane's color, ─ uses the horizontal's color
      result.push({ char: "┼", color: connColor(straight) });
      result.push({ char: "─", color: connColor(horizontal) });
    } else if (cornerBR) {
      // ╯ — lane comes from above, curves left toward parent and terminates
      if (horizontal) {
        // Corner + horizontal crossing: ┴ glyph
        result.push({ char: "┴", color: connColor(cornerBR) });
        result.push({ char: "─", color: connColor(horizontal) });
      } else {
        result.push({ char: "╯ ", color: connColor(cornerBR) });
      }
    } else if (cornerBL) {
      // ╰ — lane comes from above, curves right toward parent and terminates
      const cornerColor = connColor(cornerBL);
      if (horizontal) {
        // Corner + horizontal crossing (unlikely but handle for correctness)
        result.push({ char: "┴", color: cornerColor });
        result.push({ char: "─", color: connColor(horizontal) });
      } else if (opts.focusMode && opts.dimColor) {
        result.push({ char: "╰", color: cornerColor });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        // Look for horizontal at next column for trailing dash color
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
      // ╮ — new lane starts, line comes from left (absorbed from commit row by fan-out merge).
      if (horizontal) {
        // Corner + horizontal crossing: ┬ glyph (horizontal with vertical going DOWN)
        const cornerColor = connColor(cornerTR);
        const hColor = connColor(horizontal);
        result.push({ char: "┬", color: cornerColor });
        result.push({ char: "─", color: hColor });
      } else {
        result.push({ char: "╮ ", color: connColor(cornerTR) });
      }
    } else if (cornerTL) {
      // ╭ — new lane starts, line comes from right (absorbed from commit row by fan-out merge).
      const cornerColor = connColor(cornerTL);
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "╭", color: cornerColor });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        const nextConns = byCol.get(col + 1);
        const nextH = nextConns?.find(c => c.type === "horizontal");
        const dashColor = nextH ? connColor(nextH) : cornerColor;
        if (dashColor === cornerColor) {
          result.push({ char: "╭─", color: cornerColor });
        } else {
          result.push({ char: "╭", color: cornerColor });
          result.push({ char: "─", color: dashColor });
        }
      }
    } else if (straight) {
      const color = connColor(straight);
      const isBold = !opts.focusMode || !!straight.isFocused;
      result.push({ char: "│ ", color, bold: isBold });
    } else if (horizontal) {
      result.push({ char: "──", color: connColor(horizontal) });
    } else {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(col, opts) });
    }
  }

  // Pad to fixed width
  if (padToColumns !== undefined) {
    const targetWidth = padToColumns * 2;
    let currentWidth = 0;
    for (const gc of result) currentWidth += gc.char.length;
    while (currentWidth < targetWidth) {
      result.push({ char: "  ", color: opts.dimColor ?? getBaseColor(0, opts) });
      currentWidth += 2;
    }
  }

  return result;
}

export function renderGraphRow(row: GraphRow, opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const nodeChar = "█";
  const result: GraphChar[] = [];

  // Helper: resolve color for a connector based on its isFocused flag
  // and isRemoteOnly flag. Focus mode takes precedence over remote-only dimming.
  // NOTE: connColor is duplicated in renderFanOutRow — keep both in sync
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
        // The ─ right after ● uses the OTHER branch's color (same as horizontals).
        // For merges: source branch color. For branch-offs: new branch color.
        // Look up the horizontal/corner connector at the next column to get the color.
        // In focus mode, the dash is always dimmed.
        result.push({ char: nodeChar, color: nodeColor, bold: true });
        let dashColor: string;
        if (opts.focusMode && opts.dimColor) {
          dashColor = opts.dimColor;
        } else if (node.isRemoteOnly && opts.remoteOnlyDimColor) {
          dashColor = opts.remoteOnlyDimColor;
        } else {
          // Find the horizontal or corner connector at col+1 to pick up the other branch's color
          const nextConnectors = connectorsByCol.get(col + 1) ?? [];
          const nextHoriz = nextConnectors.find((c) => c.type === "horizontal");
          const nextCorner = nextConnectors.find((c) =>
            c.type === "corner-top-right" || c.type === "corner-bottom-right" ||
            c.type === "corner-top-left" || c.type === "corner-bottom-left"
          );
          const hConn = nextHoriz ?? nextCorner;
          dashColor = hConn ? connColor(hConn) : getBaseColor(node.color, opts);
        }
        result.push({ char: "─", color: dashColor });
      } else if (col === nodeCol && hasLeftConnection) {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      } else {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      }
    } else if (teeLeft) {
      // ├ is on the lane's direct path → lane color.
      // The trailing ─ is a horizontal connector → spanning branch's color.
      const teeColor = connColor(teeLeft);
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "├", color: teeColor });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        const nextHoriz = (connectorsByCol.get(col + 1) ?? []).find((c) => c.type === "horizontal");
        const dashColor = nextHoriz ? connColor(nextHoriz) : teeColor;
        if (dashColor === teeColor) {
          result.push({ char: "├─", color: teeColor });
        } else {
          result.push({ char: "├", color: teeColor });
          result.push({ char: "─", color: dashColor });
        }
      }
    } else if (teeRight) {
      result.push({ char: "┤ ", color: connColor(teeRight) });
    } else if (cornerTopRight) {
      if (horizontal) {
        // Corner + horizontal crossing: lane going down + horizontal passing through.
        // ┬ = horizontal with vertical going DOWN. The corner starts a lane below,
        // and the horizontal passes through from the merge/branch connector.
        const cornerColor = connColor(cornerTopRight);
        const hColor = connColor(horizontal);
        result.push({ char: "┬", color: cornerColor });
        result.push({ char: "─", color: hColor });
      } else {
        result.push({ char: "╮ ", color: connColor(cornerTopRight) });
      }
    } else if (cornerTopLeft) {
      // ╭ is on the lane's direct path → lane color.
      // The trailing ─ is a horizontal connector → use the spanning branch's color.
      // Look for a horizontal at the next column; if none, fall back to corner color.
      const cornerColor = connColor(cornerTopLeft);
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "╭", color: cornerColor });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        const nextHoriz = (connectorsByCol.get(col + 1) ?? []).find((c) => c.type === "horizontal");
        const dashColor = nextHoriz ? connColor(nextHoriz) : cornerColor;
        if (dashColor === cornerColor) {
          result.push({ char: "╭─", color: cornerColor });
        } else {
          result.push({ char: "╭", color: cornerColor });
          result.push({ char: "─", color: dashColor });
        }
      }
    } else if (cornerBottomRight) {
      if (horizontal) {
        // Corner + horizontal crossing: lane from above terminating + horizontal passing through.
        // ┴ = horizontal with vertical going UP. The lane from above ends here,
        // and the horizontal passes through from the merge/branch connector.
        const cornerColor = connColor(cornerBottomRight);
        const hColor = connColor(horizontal);
        result.push({ char: "┴", color: cornerColor });
        result.push({ char: "─", color: hColor });
      } else {
        result.push({ char: "╯ ", color: connColor(cornerBottomRight) });
      }
    } else if (cornerBottomLeft) {
      // ╰ is on the lane's direct path → lane color.
      // The trailing ─ is a horizontal connector → spanning branch's color.
      const cornerColor = connColor(cornerBottomLeft);
      if (opts.focusMode && opts.dimColor) {
        result.push({ char: "╰", color: cornerColor });
        result.push({ char: "─", color: opts.dimColor });
      } else {
        const nextHoriz = (connectorsByCol.get(col + 1) ?? []).find((c) => c.type === "horizontal");
        const dashColor = nextHoriz ? connColor(nextHoriz) : cornerColor;
        if (dashColor === cornerColor) {
          result.push({ char: "╰─", color: cornerColor });
        } else {
          result.push({ char: "╰", color: cornerColor });
          result.push({ char: "─", color: dashColor });
        }
      }
    } else if (horizontal && straight) {
      // Crossing: ┼ uses the crossed lane's color (the vertical lane passing through),
      // ─ uses the horizontal connector's color (the spanning merge/branch connector).
      result.push({ char: "┼", color: connColor(straight) });
      result.push({ char: "─", color: connColor(horizontal) });
    } else if (horizontal) {
      result.push({ char: "──", color: connColor(horizontal) });
    } else if (straight) {
      const isBold = !opts.focusMode || !!straight.isFocused;
      result.push({ char: "│ ", color: connColor(straight), bold: isBold });
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

/**
 * Compute per-row horizontal viewport offsets for the sliding graph viewport.
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

  const padColor = opts.dimColor ?? opts.remoteOnlyDimColor ?? "#6c7086";

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
