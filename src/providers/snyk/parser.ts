import type { SnykFinding, SnykScanResult, SnykSeverity, SnykSeverityCounts } from "./types";

export interface SnykParseOptions {
  sha: string;
  scannedAt?: string;
}

const SEVERITIES = new Set<SnykSeverity>(["critical", "high", "medium", "low"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function packageAndVersion(value: unknown): { name: string; version: string } | null {
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { name: value.slice(0, separator), version: value.slice(separator + 1) };
}

function dependencyFromPath(value: unknown): { name: string; version: string } | null {
  if (!Array.isArray(value)) return null;
  for (let index = value.length - 1; index >= 0; index--) {
    const parsed = packageAndVersion(value[index]);
    if (parsed) return parsed;
  }
  return null;
}

function dependencyPath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return entries.length > 1 ? entries.slice(1) : entries;
}

function upgradeTarget(value: unknown): { name: string; version: string } | null {
  if (!Array.isArray(value)) return null;
  return packageAndVersion(value[1]);
}

function cveIdentifiers(vulnerability: Record<string, unknown>): string[] {
  const values: unknown[] = [];
  const identifiers = isObject(vulnerability.identifiers) ? vulnerability.identifiers : null;
  if (Array.isArray(identifiers?.CVE)) values.push(...identifiers.CVE);
  if (Array.isArray(vulnerability.cves)) values.push(...vulnerability.cves);
  if (typeof vulnerability.id === "string") values.push(vulnerability.id);
  if (typeof vulnerability.title === "string") values.push(...vulnerability.title.split(/\s+/));
  return [
    ...new Set(
      values.flatMap(value =>
        typeof value === "string" ? (value.match(/CVE-\d{4}-\d{4,}/gi) ?? []).map(entry => entry.toUpperCase()) : [],
      ),
    ),
  ];
}

function fixedVersion(vulnerability: Record<string, unknown>, dependency: string): string | null {
  if (Array.isArray(vulnerability.fixedIn)) {
    const fixed = vulnerability.fixedIn.find(value => typeof value === "string" && value.length > 0);
    if (typeof fixed === "string") return fixed;
  }

  if (Array.isArray(vulnerability.upgradePath)) {
    for (let index = vulnerability.upgradePath.length - 1; index >= 0; index--) {
      const parsed = packageAndVersion(vulnerability.upgradePath[index]);
      if (parsed?.name === dependency) return parsed.version;
    }
  }
  return null;
}

function normalizeFinding(value: unknown, project: string | null, targetFile: string | null): SnykFinding | null {
  if (!isObject(value)) return null;
  const severity = typeof value.severity === "string" ? value.severity.toLowerCase() : "";
  if (!SEVERITIES.has(severity as SnykSeverity)) return null;

  const fromPath = dependencyFromPath(value.from);
  const dependency = stringValue(value.packageName) ?? stringValue(value.name) ?? fromPath?.name ?? "(unknown)";
  const installedVersion = stringValue(value.version) ?? fromPath?.version ?? "(unknown)";
  const path = dependencyPath(value.from);
  const upgrade = upgradeTarget(value.upgradePath);

  return {
    id: stringValue(value.id) ?? "unknown",
    title: stringValue(value.title) ?? stringValue(value.id) ?? dependency,
    severity: severity as SnykSeverity,
    dependency,
    installedVersion,
    fixedVersion: fixedVersion(value, dependency),
    dependencyType: path.length === 0 ? "unknown" : path.length === 1 ? "direct" : "transitive",
    dependencyPath: path,
    upgradeDependency: upgrade?.name ?? null,
    upgradeVersion: upgrade?.version ?? null,
    cves: cveIdentifiers(value),
    project,
    targetFile,
  };
}

function emptyCounts(): SnykSeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

export function parseSnykOutput(raw: string | unknown, options: SnykParseOptions): SnykScanResult {
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  const projects = Array.isArray(parsed) ? parsed : [parsed];
  const findings: SnykFinding[] = [];
  let validProjects = 0;
  let failedProjects = 0;
  let firstProjectError: string | null = null;

  for (const value of projects) {
    if (!isObject(value)) continue;
    if (!Array.isArray(value.vulnerabilities)) {
      if (typeof value.error === "string") {
        failedProjects++;
        if (!firstProjectError) firstProjectError = value.error;
      }
      continue;
    }
    validProjects++;
    const project = stringValue(value.projectName) ?? stringValue(value.displayTargetFile) ?? null;
    const targetFile = stringValue(value.targetFile) ?? null;
    const vulnerabilities = Array.isArray(value.vulnerabilities) ? value.vulnerabilities : [];
    for (const vulnerability of vulnerabilities) {
      const finding = normalizeFinding(vulnerability, project, targetFile);
      if (finding) findings.push(finding);
    }
  }

  if (validProjects === 0) throw new Error(firstProjectError ?? "Snyk output contains no project results");

  const counts = emptyCounts();
  for (const finding of findings) counts[finding.severity]++;

  return {
    sha: options.sha.toLowerCase(),
    scannedAt: options.scannedAt ?? new Date().toISOString(),
    counts,
    findings,
    ...(failedProjects > 0 ? { partial: true, failedProjects } : {}),
  };
}

export function isSnykScanResult(value: unknown): value is SnykScanResult {
  if (!isObject(value) || typeof value.sha !== "string" || !/^[0-9a-f]{40,64}$/i.test(value.sha)) return false;
  if (typeof value.scannedAt !== "string" || Number.isNaN(Date.parse(value.scannedAt))) return false;
  if (!isObject(value.counts) || !Array.isArray(value.findings)) return false;
  if (value.partial !== undefined && typeof value.partial !== "boolean") return false;
  const failedProjects = value.failedProjects;
  if (
    failedProjects !== undefined &&
    (typeof failedProjects !== "number" || !Number.isInteger(failedProjects) || failedProjects < 0)
  ) {
    return false;
  }
  if (
    value.partial === true &&
    (typeof failedProjects !== "number" || !Number.isInteger(failedProjects) || failedProjects < 1)
  ) {
    return false;
  }
  if (value.partial !== true && failedProjects !== undefined) return false;

  for (const severity of SEVERITIES) {
    const count = value.counts[severity];
    if (!Number.isInteger(count) || (count as number) < 0) return false;
  }

  const validFindings = value.findings.every(finding => {
    if (!isObject(finding)) return false;
    return (
      typeof finding.id === "string" &&
      typeof finding.title === "string" &&
      SEVERITIES.has(finding.severity as SnykSeverity) &&
      typeof finding.dependency === "string" &&
      typeof finding.installedVersion === "string" &&
      (typeof finding.fixedVersion === "string" || finding.fixedVersion === null) &&
      (finding.dependencyType === undefined ||
        finding.dependencyType === "direct" ||
        finding.dependencyType === "transitive" ||
        finding.dependencyType === "unknown") &&
      (finding.dependencyPath === undefined ||
        (Array.isArray(finding.dependencyPath) && finding.dependencyPath.every(entry => typeof entry === "string"))) &&
      (finding.upgradeDependency === undefined ||
        typeof finding.upgradeDependency === "string" ||
        finding.upgradeDependency === null) &&
      (finding.upgradeVersion === undefined ||
        typeof finding.upgradeVersion === "string" ||
        finding.upgradeVersion === null) &&
      (finding.cves === undefined ||
        (Array.isArray(finding.cves) && finding.cves.every(entry => typeof entry === "string"))) &&
      (typeof finding.project === "string" || finding.project === null) &&
      (typeof finding.targetFile === "string" || finding.targetFile === null)
    );
  });
  if (!validFindings) return false;

  const actualCounts = emptyCounts();
  for (const finding of value.findings as SnykFinding[]) actualCounts[finding.severity]++;
  const counts = value.counts as Record<string, unknown>;
  return [...SEVERITIES].every(severity => counts[severity] === actualCounts[severity]);
}
