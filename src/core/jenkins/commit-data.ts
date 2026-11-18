/** Jenkins' builds per commit: the details' data and the graph's badges. */
import type { GraphBadge } from "../provider-model";
import { categorize } from "../status";
import type { JenkinsCommitData, JenkinsRun } from "./types";

export function buildJenkinsCommitDataMap(runs: JenkinsRun[], resolved: boolean): Map<string, JenkinsCommitData> {
  const map = new Map<string, JenkinsCommitData>();
  for (const run of runs) {
    const existing = map.get(run.headSha) ?? { sha: run.headSha, runs: [], resolved };
    existing.runs.push(run);
    existing.resolved = resolved;
    map.set(run.headSha, existing);
  }
  for (const data of map.values()) data.runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return map;
}

export function buildJenkinsGraphBadges(runs: JenkinsRun[]): Map<string, GraphBadge> {
  const map = new Map<string, GraphBadge>();
  for (const run of runs) {
    const badge = map.get(run.headSha) ?? {
      sha: run.headSha,
      badge: "unknown" as const,
      passCount: 0,
      failCount: 0,
      runningCount: 0,
      latestRunAt: run.updatedAt,
      latestStatus: "unknown" as const,
    };
    const category = categorize(run.status, run.conclusion);
    if (category === "running") badge.runningCount++;
    else if (category === "pass") badge.passCount++;
    else if (category === "fail") badge.failCount++;
    else badge.unknownCount = (badge.unknownCount ?? 0) + 1;
    if (run.updatedAt >= badge.latestRunAt) {
      badge.latestRunAt = run.updatedAt;
      badge.latestStatus = category === "pass" || category === "fail" || category === "running" ? category : "unknown";
    }
    badge.badge =
      badge.failCount > 0 ? "fail" : badge.runningCount > 0 ? "running" : badge.passCount > 0 ? "pass" : "unknown";
    map.set(run.headSha, badge);
  }
  return map;
}
