/** Snyk's Dashboard events: what it stored for an app, as the Dashboard shows it. */
import { type DashboardEvent, fact, timeOf } from "../dashboard/events";
import type { StatusCategory } from "../status";
import type { SnykScanResult } from "./types";

export function snykEvents(
  app: string,
  scans: readonly (Pick<SnykScanResult, "sha" | "scannedAt" | "counts"> &
    Partial<Pick<SnykScanResult, "partial" | "failedProjects">>)[],
): DashboardEvent[] {
  return scans.flatMap(scan => {
    const time = timeOf(scan.scannedAt);
    if (time === null) return [];
    const { critical, high, medium, low } = scan.counts;
    const bySeverity = [
      ["critical", critical],
      ["high", high],
      ["medium", medium],
      ["low", low],
    ] as const;
    const total = critical + high + medium + low;
    // A partial scan without findings is not a clean result: some projects were not scanned.
    const status: StatusCategory = critical + high > 0 ? "fail" : total > 0 || scan.partial ? "unknown" : "pass";
    const counted = `${total} ${total === 1 ? "vulnerability" : "vulnerabilities"}`;
    return [
      {
        id: `${app}:snyk:${scan.sha}`,
        app,
        source: "snyk" as const,
        time,
        status,
        severity: bySeverity.find(([, count]) => count > 0)?.[0] ?? null,
        // Every severity in order, zeros too, like Snyk's C0 H0 M0 L0: the counts line up from scan to scan.
        text: ["scan", counted, ...bySeverity.map(([severity, count]) => `${count} ${severity}`)].join(" · "),
        counts: scan.counts,
        partial: scan.partial === true,
        sha: scan.sha,
        facts: [
          ...fact("Vulnerabilities", `${total} (${critical} critical, ${high} high, ${medium} medium, ${low} low)`),
          ...fact(
            "Partial",
            scan.partial
              ? `${scan.failedProjects ?? 1} ${scan.failedProjects === 1 || scan.failedProjects === undefined ? "project" : "projects"} could not be scanned`
              : null,
          ),
        ],
      },
    ];
  });
}
