import type { SnykDependencyProjectResult, SnykScanResult } from "./types";

/** Projects shown before the notice collapses the rest into `+N more`. */
const NOTICE_MAX_ENTRIES = 5;

export interface SnykNotice {
  kind: "warning" | "info";
  title: string;
  detail: string[];
  entries: { label: string; text?: string }[];
  footer?: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Dependencies notice for projects without a graph: failed first, then skipped. */
export function snykProjectNotice(projects: readonly SnykDependencyProjectResult[]): SnykNotice | null {
  const failed = projects.filter(project => project.status === "failed");
  const skipped = projects.filter(project => project.status === "skipped");
  if (failed.length + skipped.length === 0) return null;
  const counts = [
    failed.length > 0 ? `${plural(failed.length, "project")} failed` : null,
    skipped.length > 0 ? `${failed.length > 0 ? skipped.length : plural(skipped.length, "project")} skipped` : null,
  ].filter(part => part !== null);
  const entries = [...failed, ...skipped].map(project => ({
    label: project.targetFile,
    text: project.reason ?? project.status,
  }));
  const more = entries.length - NOTICE_MAX_ENTRIES;
  return {
    kind: failed.length > 0 ? "warning" : "info",
    title: counts.join(", "),
    detail: [],
    entries: entries.slice(0, NOTICE_MAX_ENTRIES),
    ...(more > 0 ? { footer: `+${more} more` } : {}),
  };
}

/** Vulnerabilities notice for a partial scan: the projects Snyk could not test; findings cover the rest. */
export function snykPartialScanNotice(
  scan: Pick<SnykScanResult, "partial" | "failedProjects" | "failedTargets">,
): SnykNotice | null {
  if (!scan.partial) return null;
  const count = scan.failedProjects ?? 0;
  const targets = scan.failedTargets ?? [];
  const shown = targets.slice(0, NOTICE_MAX_ENTRIES);
  const unnamed = Math.max(0, count - targets.length);
  const hidden = targets.length - shown.length;
  const footer = [hidden > 0 ? `+${hidden} more` : null, unnamed > 0 ? `${unnamed} not named by Snyk` : null]
    .filter(part => part !== null)
    .join(" · ");
  return {
    kind: "warning",
    title: `Partial scan · ${plural(count, "project")} failed`,
    detail: ["Findings cover the other projects."],
    entries: shown.map(label => ({ label })),
    ...(footer ? { footer } : {}),
  };
}
