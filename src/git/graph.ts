import type { Commit, GraphRow, GraphColumn, Connector, ConnectorType } from "./types";

// Assign colors to branches based on their column
const BRANCH_COLORS = [
  "#f38ba8", // red/pink
  "#a6e3a1", // green
  "#89b4fa", // blue
  "#f9e2af", // yellow
  "#cba6f7", // mauve/purple
  "#94e2d5", // teal
  "#fab387", // peach
  "#74c7ec", // sapphire
  "#f2cdcd", // flamingo
  "#89dceb", // sky
  "#b4befe", // lavender
  "#eba0ac", // maroon
];

export function getColorForColumn(column: number): string {
  return BRANCH_COLORS[column % BRANCH_COLORS.length];
}

export function getColorIndex(column: number): number {
  return column % BRANCH_COLORS.length;
}

/**
 * Build graph layout from a list of commits.
 *
 * Each commit is assigned a column (the "lane" it lives in).
 * Active lanes are tracked as we go top-to-bottom through the commit list.
 * When a commit has multiple parents, new lanes are opened for the merges.
 * When a lane's commit appears, that lane is consumed.
 */
export function buildGraph(commits: Commit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  // Active lanes: each lane tracks a commit hash it's waiting for
  let lanes: (string | null)[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    // Find which lane this commit occupies
    let nodeColumn = lanes.indexOf(commit.hash);
    if (nodeColumn === -1) {
      // New commit not in any lane -- add it to the first empty lane or append
      const emptyIdx = lanes.indexOf(null);
      if (emptyIdx !== -1) {
        nodeColumn = emptyIdx;
        lanes[emptyIdx] = commit.hash;
      } else {
        nodeColumn = lanes.length;
        lanes.push(commit.hash);
      }
    }

    // Build the columns for this row (snapshot of active lanes)
    const columns: GraphColumn[] = lanes.map((lane, idx) => ({
      color: getColorIndex(idx),
      active: lane !== null,
    }));

    // Build connectors for this row
    const connectors: Connector[] = [];

    // First, draw all passing-through lanes
    for (let col = 0; col < lanes.length; col++) {
      if (col === nodeColumn) {
        connectors.push({
          type: "node",
          color: getColorIndex(col),
          column: col,
        });
      } else if (lanes[col] !== null) {
        connectors.push({
          type: "straight",
          color: getColorIndex(col),
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

    // Now handle parents
    const parents = commit.parents;

    if (parents.length === 0) {
      // Root commit -- close this lane
      lanes[nodeColumn] = null;
    } else if (parents.length === 1) {
      // Single parent -- continue the lane
      const parentHash = parents[0];
      // Check if parent is already in another lane
      const existingLane = lanes.indexOf(parentHash);
      if (existingLane !== -1 && existingLane !== nodeColumn) {
        // Parent is already tracked in another lane, close this lane
        // and add a merge connector
        lanes[nodeColumn] = null;
      } else {
        // Continue this lane with the parent
        lanes[nodeColumn] = parentHash;
      }
    } else {
      // Merge commit -- first parent continues the lane, others open new lanes
      lanes[nodeColumn] = parents[0];

      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        // Check if this parent is already being tracked
        const existingLane = lanes.indexOf(parentHash);
        if (existingLane === -1) {
          // Open a new lane for this parent
          const emptyIdx = lanes.indexOf(null);
          if (emptyIdx !== -1) {
            lanes[emptyIdx] = parentHash;
          } else {
            lanes.push(parentHash);
          }
        }
      }
    }

    // Clean up trailing null lanes
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    rows.push({
      commit,
      columns,
      nodeColumn,
      connectors,
    });
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
}

export function renderGraphRow(row: GraphRow): GraphChar[] {
  const result: GraphChar[] = [];
  const maxCol = Math.max(row.connectors.length, row.columns.length);

  for (let col = 0; col < maxCol; col++) {
    const connector = row.connectors.find((c) => c.column === col);
    const color = getColorForColumn(connector?.color ?? col);

    if (!connector || connector.type === "empty") {
      result.push({ char: "  ", color });
    } else {
      switch (connector.type) {
        case "node":
          result.push({ char: "● ", color });
          break;
        case "straight":
          result.push({ char: "│ ", color });
          break;
        case "merge-left":
          result.push({ char: "╱ ", color });
          break;
        case "merge-right":
          result.push({ char: "╲ ", color });
          break;
        case "branch-left":
          result.push({ char: "╱ ", color });
          break;
        case "branch-right":
          result.push({ char: "╲ ", color });
          break;
        case "horizontal":
          result.push({ char: "──", color });
          break;
        default:
          result.push({ char: "  ", color });
      }
    }
  }

  return result;
}
