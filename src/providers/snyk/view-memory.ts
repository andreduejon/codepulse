import type { DependencyGroupBy, DependencyScopeFilter } from "./deps-tree";

/** View state of one Snyk tab, valid only for the scan it was recorded on. */
interface SnykTabMemory {
  /** `sha:scannedAt`; another scan (other commit or rescan) starts from defaults. */
  identity: string;
  query: string;
  cursor: number;
}

export interface SnykDependenciesMemory extends SnykTabMemory {
  groupBy: DependencyGroupBy;
  scope: DependencyScopeFilter;
  expanded: ReadonlySet<string>;
}

export interface SnykVulnerabilitiesMemory extends SnykTabMemory {
  groupBy: "severity" | "dependency";
  expandedSections: ReadonlySet<string>;
  expandedFindings: ReadonlySet<string>;
  collapsedGroups: ReadonlySet<string>;
}

/**
 * Mutable ref owned by the detail view, which outlives tab switches: each tab restores
 * its last state when it remounts for the same scan (e.g. after a `v` jump and back).
 */
export interface SnykViewMemory {
  dependencies?: SnykDependenciesMemory;
  vulnerabilities?: SnykVulnerabilitiesMemory;
}
