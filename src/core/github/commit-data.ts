/** GitHub's runs per commit: the details' data and the graph's badges. */
import type { GraphBadge } from "../provider-model";
import { categorize } from "../status";
import type { GitHubCommitData, GitHubWorkflowRun } from "./types";

/**
 * Map a GitHub run's `status` + `conclusion` to the simplified badge value
 * used across the provider boundary.
 *
 * Note: `cancelled` maps to `"unknown"` (not counted as failure) to avoid
 * inflating fail counts when a user manually cancels a run.
 */
export function mapRunToBadge(status: string, conclusion: string | null): GraphBadge["badge"] {
  const cat = categorize(status, conclusion);
  switch (cat) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "running":
      return "running";
    default:
      return "unknown";
  }
}

/**
 * Aggregate all runs for a single SHA into a GraphBadge.
 *
 * Worst-status wins for the top-level `badge` field:
 *   fail > running > pass > unknown
 *
 * Counts are the raw number of runs in each category.
 * `latestRunAt` / `latestStatus` refer to the most-recently-updated run.
 */
export function aggregateRunsToGraphBadge(sha: string, runs: GitHubWorkflowRun[]): GraphBadge {
  let passCount = 0;
  let failCount = 0;
  let runningCount = 0;
  let unknownCount = 0;

  // Find the most recently updated run
  let latestRun: GitHubWorkflowRun | null = null;
  for (const run of runs) {
    const badge = mapRunToBadge(run.status, run.conclusion);
    switch (badge) {
      case "pass":
        passCount++;
        break;
      case "fail":
        failCount++;
        break;
      case "running":
        runningCount++;
        break;
      default:
        unknownCount++;
    }
    if (!latestRun || run.updatedAt > latestRun.updatedAt) {
      latestRun = run;
    }
  }

  // Worst-status wins
  let badge: GraphBadge["badge"] = "unknown";
  if (passCount > 0 && failCount === 0 && runningCount === 0 && unknownCount === 0) {
    badge = "pass";
  } else if (failCount > 0) {
    badge = "fail";
  } else if (runningCount > 0) {
    badge = "running";
  } else if (passCount > 0) {
    badge = "pass";
  }

  const latestStatus: GraphBadge["latestStatus"] = latestRun
    ? mapRunToBadge(latestRun.status, latestRun.conclusion)
    : "unknown";

  return {
    sha,
    badge,
    passCount,
    failCount,
    runningCount,
    unknownCount,
    latestRunAt: latestRun?.updatedAt ?? "",
    latestStatus,
  };
}

/**
 * Group an array of workflow runs by commit SHA and build GraphBadges.
 * Returns a Map<sha, GraphBadge> suitable for storing in state.graphBadges.
 */
export function buildGraphBadges(runs: GitHubWorkflowRun[]): Map<string, GraphBadge> {
  // Group by SHA
  const bySha = new Map<string, GitHubWorkflowRun[]>();
  for (const run of runs) {
    const existing = bySha.get(run.headSha);
    if (existing) {
      existing.push(run);
    } else {
      bySha.set(run.headSha, [run]);
    }
  }

  // Aggregate each SHA's runs into a badge
  const badges = new Map<string, GraphBadge>();
  for (const [sha, shaRuns] of bySha) {
    badges.set(sha, aggregateRunsToGraphBadge(sha, shaRuns));
  }
  return badges;
}

/**
 * Group an array of workflow runs by commit SHA.
 * Returns a Map<sha, GitHubCommitData> for the detail panel.
 */
export function buildCommitDataMap(runs: GitHubWorkflowRun[]): Map<string, GitHubCommitData> {
  const map = new Map<string, GitHubCommitData>();
  for (const run of runs) {
    const existing = map.get(run.headSha);
    if (existing) {
      existing.runs.push(run);
    } else {
      map.set(run.headSha, { sha: run.headSha, runs: [run] });
    }
  }
  // Sort each SHA's runs newest-first
  for (const data of map.values()) {
    data.runs.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  }
  return map;
}

/**
 * Maximum number of SHAs per GraphQL batch request.
 * Node budget: 100 SHAs × 100 check-suites (scalars only) = 10,000 nodes.
 */
export const GQL_BATCH_SIZE = 100;
