export type SnykSeverity = "critical" | "high" | "medium" | "low";

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
  counts: SnykSeverityCounts;
  findings: SnykFinding[];
  partial?: boolean;
  failedProjects?: number;
}

export type SnykCacheLimit = 10 | 20 | 50;

export interface SnykScanOptions {
  repoPath: string;
  sha: string;
  tokenEnvVar?: string;
  signal?: AbortSignal;
  force?: boolean;
  maxCachedScans?: SnykCacheLimit;
}
