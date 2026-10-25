import type { ProviderCacheLimit } from "../shared/auto-refresh";

export type SnykSeverity = "critical" | "high" | "medium" | "low";

export type SnykDependencyScope = "prod" | "dev" | "unknown";

export type SnykDependencyPackageManager = "bun" | "maven" | "npm" | "pnpm" | "yarn";

export interface SnykDependencyPackage {
  id: string;
  name: string;
  version: string | null;
}

export interface SnykDependencyNode {
  nodeId: string;
  pkgId: string;
  deps: string[];
  scope: SnykDependencyScope;
  referenceNodeId: string | null;
}

export interface SnykDependencyGraph {
  targetFile: string;
  packageManager: string;
  rootNodeId: string;
  packages: SnykDependencyPackage[];
  nodes: SnykDependencyNode[];
}

export interface SnykDependencyProjectResult {
  targetFile: string;
  packageManager: SnykDependencyPackageManager;
  status: "scanned" | "skipped" | "failed";
  graphs: SnykDependencyGraph[];
  reason: string | null;
}

export interface SnykSeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface SnykFinding {
  id: string;
  title: string;
  severity: SnykSeverity;
  dependency: string;
  installedVersion: string;
  fixedVersion: string | null;
  /** All Snyk `fixedIn` versions. */
  fixedIn: string[];
  /** Snyk exploit maturity, e.g. `Mature`, `Proof of Concept`; null when absent. */
  exploit: string | null;
  cvssScore: number | null;
  dependencyType?: "direct" | "transitive" | "unknown";
  dependencyPath?: string[];
  upgradeDependency?: string | null;
  upgradeVersion?: string | null;
  cves?: string[];
  project: string | null;
  targetFile: string | null;
}

export interface SnykScanResult {
  sha: string;
  scannedAt: string;
  includesDev: true;
  dependencyProjects: SnykDependencyProjectResult[];
  counts: SnykSeverityCounts;
  findings: SnykFinding[];
  partial?: boolean;
  failedProjects?: number;
  /** Manifests Snyk could not resolve, when it named them; only on partial scans. */
  failedTargets?: string[];
}

export type SnykCacheLimit = ProviderCacheLimit;

export interface SnykScanOptions {
  repoPath: string;
  sha: string;
  tokenEnvVar?: string;
  signal?: AbortSignal;
  force?: boolean;
  maxCachedScans?: SnykCacheLimit;
}
