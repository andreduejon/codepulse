import { posix, win32 } from "node:path";
import { isSnykDependencyGraph, normalizeSnykTargetFile } from "./dep-graph";
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

/** Numeric-aware version order; non-numeric segments (e.g. `Final`) compare as text. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(/[.\-+]/);
  const b = right.split(/[.\-+]/);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? "0";
    const y = b[index] ?? "0";
    const order = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (order !== 0) return order;
  }
  return 0;
}

function fixedVersion(vulnerability: Record<string, unknown>, dependency: string, installed: string): string | null {
  if (Array.isArray(vulnerability.fixedIn)) {
    // Snyk lists one fix per release line; prefer the lowest one above the installed version.
    const fixed = vulnerability.fixedIn.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    const above = fixed.filter(value => compareVersions(value, installed) > 0).sort(compareVersions);
    if (above.length > 0) return above[0];
    if (fixed.length > 0) return fixed.join(", ");
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
  // License-policy issues share the vulnerabilities array; they are not security findings.
  if (value.type === "license" || stringValue(value.id)?.startsWith("snyk:lic:")) return null;

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
    fixedVersion: fixedVersion(value, dependency, installedVersion),
    fixedIn: Array.isArray(value.fixedIn)
      ? value.fixedIn.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [],
    exploit: stringValue(value.exploit),
    cvssScore: typeof value.cvssScore === "number" && Number.isFinite(value.cvssScore) ? value.cvssScore : null,
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

export function findingIdentity(finding: SnykFinding): string {
  return finding.id === "unknown"
    ? `${finding.id}:${finding.dependency}:${finding.title}:${finding.severity}`
    : finding.id;
}

function preferFinding(current: SnykFinding, incoming: SnykFinding): SnykFinding {
  return current.dependencyType !== "direct" && incoming.dependencyType === "direct" ? incoming : current;
}

export type SnykFixKind = "upgrade" | "override" | "no fix";
const FIX_RANK: Record<SnykFixKind, number> = { upgrade: 0, override: 1, "no fix": 2 };

/** upgrade: bump a dependency you declare; override: only the transitive package has a fix. */
export function snykFixKind(finding: SnykFinding): SnykFixKind {
  if (finding.upgradeDependency && finding.upgradeVersion) return "upgrade";
  if (finding.fixedVersion) return finding.dependencyType === "direct" ? "upgrade" : "override";
  return "no fix";
}

/** Snyk maturity levels meaning a working exploit is known in the wild. */
export function isMatureExploit(finding: SnykFinding): boolean {
  return ["mature", "high", "functional"].includes(finding.exploit?.toLowerCase() ?? "");
}

/** CVE IDs label a vulnerability; Snyk ID is the fallback when no CVE exists. */
export function snykVulnerabilityLabel(finding: SnykFinding): string {
  return finding.cves?.length ? finding.cves.join(", ") : finding.id;
}

export interface SnykVulnerabilityEntry {
  key: string;
  label: string;
  fix: SnykFixKind;
  finding: SnykFinding;
  paths: number;
}

/**
 * One entry per vulnerability + manifest + package; multiple dependency paths to the
 * same package merge. Sorted by {@link compareSnykEntries}.
 */
export function groupSnykVulnerabilities(findings: readonly SnykFinding[]): SnykVulnerabilityEntry[] {
  const entries = new Map<string, SnykVulnerabilityEntry>();
  for (const finding of findings) {
    const label = snykVulnerabilityLabel(finding);
    const key = [
      findingIdentity(finding),
      finding.targetFile ?? finding.project ?? "",
      finding.dependency,
      finding.installedVersion,
    ].join("\u0000");
    const existing = entries.get(key);
    if (!existing) {
      entries.set(key, { key, label, fix: snykFixKind(finding), finding, paths: 1 });
      continue;
    }
    // shortcut: merged paths show the preferred (direct) path's fix, list per-path fixes if users need them.
    existing.paths++;
    existing.finding = preferFinding(existing.finding, finding);
    existing.fix = snykFixKind(existing.finding);
  }
  return [...entries.values()].sort(compareSnykEntries);
}

const SEVERITY_RANK: Record<SnykSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** One CVE order for every view: severity, score (highest first), fix kind, then label. */
export function compareSnykEntries(left: SnykVulnerabilityEntry, right: SnykVulnerabilityEntry): number {
  return (
    SEVERITY_RANK[left.finding.severity] - SEVERITY_RANK[right.finding.severity] ||
    (right.finding.cvssScore ?? -1) - (left.finding.cvssScore ?? -1) ||
    FIX_RANK[left.fix] - FIX_RANK[right.fix] ||
    left.label.localeCompare(right.label) ||
    left.key.localeCompare(right.key)
  );
}

export interface SnykFixPackage {
  /** Package to change: the vulnerable package (override) or the dependency to upgrade. */
  name: string;
  /** Installed version of `name`, when known. */
  from: string | null;
  /** Highest version needed across its entries; null when none has a fix. */
  version: string | null;
  entries: SnykVulnerabilityEntry[];
}

export interface SnykFixGroup {
  /** Direct dependency (`name@version`) the entries come through. */
  key: string;
  entries: SnykVulnerabilityEntry[];
  /** Fix of the direct dependency itself (vulnerable directly, or an upgrade path); null when none. */
  self: SnykFixPackage | null;
  /** Other packages to override. */
  packages: SnykFixPackage[];
}

function fixGroupKey(entry: SnykVulnerabilityEntry): string {
  const finding = entry.finding;
  const via = finding.dependencyType === "transitive" ? finding.dependencyPath?.[0] : undefined;
  return via ?? `${finding.dependency}@${finding.installedVersion}`;
}

function pathVersion(path: string[] | undefined, name: string): string | null {
  return path?.find(entry => entry.startsWith(`${name}@`))?.slice(name.length + 1) || null;
}

function fixPackage(entry: SnykVulnerabilityEntry): Omit<SnykFixPackage, "entries"> {
  const finding = entry.finding;
  if (finding.upgradeDependency && finding.upgradeVersion)
    return {
      name: finding.upgradeDependency,
      from: pathVersion(finding.dependencyPath, finding.upgradeDependency),
      version: finding.upgradeVersion,
    };
  return { name: finding.dependency, from: finding.installedVersion, version: finding.fixedVersion };
}

/**
 * Groups entries by the direct dependency they come through (or the package itself when
 * direct), then by the package to change: the dependency itself (`self`) or an override.
 * Each entry lands in exactly one place, so sizes sum to the total. Groups with a direct
 * fix first, then override-only, then unfixable; larger first within each.
 */
export function groupSnykFixes(entries: readonly SnykVulnerabilityEntry[]): SnykFixGroup[] {
  const groups = new Map<string, SnykFixGroup>();
  for (const entry of entries) {
    const key = fixGroupKey(entry);
    let group = groups.get(key);
    if (!group) {
      group = { key, entries: [], self: null, packages: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
    const target = fixPackage(entry);
    const isSelf = key.slice(0, key.lastIndexOf("@")) === target.name;
    const existing = isSelf ? group.self : group.packages.find(item => item.name === target.name);
    if (!existing) {
      if (isSelf) group.self = { ...target, entries: [entry] };
      else group.packages.push({ ...target, entries: [entry] });
    } else {
      existing.entries.push(entry);
      if (target.version && (!existing.version || compareVersions(target.version, existing.version) > 0))
        existing.version = target.version;
    }
  }
  for (const group of groups.values()) {
    group.entries.sort(compareSnykEntries);
    for (const item of [...group.packages, ...(group.self ? [group.self] : [])]) item.entries.sort(compareSnykEntries);
    group.packages.sort((left, right) => left.name.localeCompare(right.name));
  }
  const maxScore = (group: SnykFixGroup) => Math.max(-1, ...group.entries.map(entry => entry.finding.cvssScore ?? -1));
  // Fixable by changing the direct dependency first, then by override, then unfixable.
  const rank = (group: SnykFixGroup) => (group.self?.version ? 0 : group.packages.some(pkg => pkg.version) ? 1 : 2);
  return [...groups.values()].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      right.entries.length - left.entries.length ||
      maxScore(right) - maxScore(left) ||
      left.key.localeCompare(right.key),
  );
}

export function countUniqueFindings(findings: SnykFinding[]): SnykSeverityCounts {
  const counts = emptyCounts();
  // Same unit as the Vulnerabilities tab: one per vulnerability, manifest and package.
  for (const entry of groupSnykVulnerabilities(findings)) counts[entry.finding.severity]++;
  return counts;
}

/**
 * A partial result never replaces a complete one on its own; a rescan the user started does, so the failed projects
 * it names stay visible instead of an older snapshot that may have missed them.
 */
export function shouldReplaceSnykResult(
  existing: SnykScanResult | undefined,
  incoming: SnykScanResult,
  rescan = false,
): boolean {
  if (!existing) return true;
  if (incoming.partial && !existing.partial && !rescan) return false;
  return existing.scannedAt <= incoming.scannedAt;
}

export function parseSnykOutput(raw: string | unknown, options: SnykParseOptions): SnykScanResult {
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  const projects = Array.isArray(parsed) ? parsed : [parsed];
  const findings: SnykFinding[] = [];
  let validProjects = 0;
  let failedProjects = 0;

  for (const value of projects) {
    if (!isObject(value)) continue;
    const error = typeof value.error === "string" ? value.error.trim() : "";
    if (error) {
      failedProjects++;
      continue;
    }
    if (!Array.isArray(value.vulnerabilities)) continue;
    validProjects++;
    const projectName = stringValue(value.projectName);
    const project = projectName
      ? win32.parse(projectName).root
        ? null
        : projectName
      : normalizeSnykTargetFile(value.displayTargetFile);
    const targetFile = normalizeSnykTargetFile(value.displayTargetFile) ?? normalizeSnykTargetFile(value.targetFile);
    const vulnerabilities = Array.isArray(value.vulnerabilities) ? value.vulnerabilities : [];
    for (const vulnerability of vulnerabilities) {
      const finding = normalizeFinding(vulnerability, project, targetFile);
      if (finding) findings.push(finding);
    }
  }

  if (validProjects === 0) throw new Error("Snyk output contains no project results.");

  const counts = countUniqueFindings(findings);

  return {
    sha: options.sha.toLowerCase(),
    scannedAt: options.scannedAt ?? new Date().toISOString(),
    includesDev: true,
    dependencyProjects: [],
    counts,
    findings,
    ...(failedProjects > 0 ? { partial: true, failedProjects } : {}),
  };
}

export function isSnykScanResult(value: unknown): value is SnykScanResult {
  if (!isObject(value) || typeof value.sha !== "string" || !/^[0-9a-f]{40,64}$/i.test(value.sha)) return false;
  if (typeof value.scannedAt !== "string" || Number.isNaN(Date.parse(value.scannedAt))) return false;
  if (value.includesDev !== true || !Array.isArray(value.dependencyProjects)) return false;
  const validDependencyProjects = value.dependencyProjects.every(project => {
    if (
      !isObject(project) ||
      typeof project.targetFile !== "string" ||
      normalizeSnykTargetFile(project.targetFile) !== project.targetFile ||
      !["bun", "maven", "npm", "pnpm", "yarn"].includes(project.packageManager as string) ||
      !Array.isArray(project.graphs) ||
      !project.graphs.every(isSnykDependencyGraph)
    ) {
      return false;
    }
    const directory = posix.dirname(project.targetFile);
    const graphManager = project.packageManager === "bun" ? "yarn" : project.packageManager;
    if (
      project.graphs.some(
        graph =>
          graph.packageManager !== graphManager || (directory !== "." && !graph.targetFile.startsWith(`${directory}/`)),
      )
    )
      return false;
    if (project.status === "scanned") return project.graphs.length > 0 && project.reason === null;
    if (typeof project.reason !== "string" || project.reason.trim().length === 0) return false;
    return project.status === "failed" || (project.status === "skipped" && project.graphs.length === 0);
  });
  if (!validDependencyProjects) return false;
  if (new Set(value.dependencyProjects.map(project => project.targetFile)).size !== value.dependencyProjects.length)
    return false;
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
  const failedTargets = value.failedTargets;
  if (
    failedTargets !== undefined &&
    (value.partial !== true ||
      !Array.isArray(failedTargets) ||
      failedTargets.length === 0 ||
      failedTargets.length > (failedProjects as number) ||
      !failedTargets.every(target => typeof target === "string" && normalizeSnykTargetFile(target) === target))
  ) {
    return false;
  }

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
      Array.isArray(finding.fixedIn) &&
      finding.fixedIn.every(entry => typeof entry === "string") &&
      (typeof finding.exploit === "string" || finding.exploit === null) &&
      ((typeof finding.cvssScore === "number" && Number.isFinite(finding.cvssScore)) || finding.cvssScore === null) &&
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
      ((typeof finding.project === "string" && !win32.parse(finding.project).root) || finding.project === null) &&
      (finding.targetFile === null ||
        (typeof finding.targetFile === "string" && normalizeSnykTargetFile(finding.targetFile) === finding.targetFile))
    );
  });
  if (!validFindings) return false;

  const actualCounts = countUniqueFindings(value.findings as SnykFinding[]);
  const counts = value.counts as Record<string, unknown>;
  return [...SEVERITIES].every(severity => counts[severity] === actualCounts[severity]);
}
