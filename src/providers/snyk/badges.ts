import type { GraphBadge } from "../provider";
import type { SnykScanResult, SnykSeverityCounts } from "./types";

export function snykSeverityCountsToGraphBadge(
  sha: string,
  counts: SnykSeverityCounts,
  scannedAt: string,
  partial = false,
): GraphBadge {
  const findingCount = counts.critical + counts.high + counts.medium + counts.low;
  const badge = findingCount > 0 ? "fail" : partial ? "unknown" : "pass";

  return {
    sha,
    badge,
    passCount: badge === "pass" ? 1 : 0,
    failCount: findingCount,
    runningCount: 0,
    resourceCount: findingCount,
    severityCounts: counts,
    latestRunAt: scannedAt,
    latestStatus: badge,
  };
}

export function buildSnykGraphBadges(results: Iterable<SnykScanResult>): Map<string, GraphBadge> {
  const badges = new Map<string, GraphBadge>();
  for (const result of results) {
    badges.set(result.sha, snykSeverityCountsToGraphBadge(result.sha, result.counts, result.scannedAt, result.partial));
  }
  return badges;
}
