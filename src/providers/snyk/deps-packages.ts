import assert from "node:assert/strict";
import {
  type DependencyRows,
  type DependencyScopeFilter,
  type DependencyTreeRow,
  type DependencyVulnerabilities,
  type DependencyVulnerability,
  type IndexedNode,
  indexGraph,
  inScope,
  lookupVulnerability,
  MAX_DEPENDENCY_ROWS,
  matchesQuery,
  NO_VULNERABILITIES,
  packageLabel,
  projectRow,
} from "./deps-model";
import { compareVersions } from "./parser";
import type { SnykDependencyPackage, SnykDependencyProjectResult } from "./types";

interface PackageEntry {
  pkg: SnykDependencyPackage;
  via: Set<string>;
  direct: boolean;
  prod: boolean;
}

/** The package list ignores the filter, so typing reuses it; keyed by the (immutable) scanned project. */
const packageCache = new WeakMap<
  SnykDependencyProjectResult,
  Map<DependencyScopeFilter, { packages: Map<string, PackageEntry> }>
>();

function collectPackages(project: SnykDependencyProjectResult, scope: DependencyScopeFilter) {
  const cached = packageCache.get(project)?.get(scope);
  if (cached) return cached;
  const packages = new Map<string, PackageEntry>();
  for (const graph of project.graphs) {
    const model = indexGraph(graph, "", scope);
    for (const id of model.root.source.deps) {
      const direct = model.nodes.get(id);
      assert(direct, "Dependency graph node missing.");
      if (!inScope(direct.node, scope)) continue;
      const via = packageLabel(direct.pkg);
      const prod = direct.node.scope !== "dev";
      const visited = new Set<string>();
      const pending = [direct];
      while (pending.length > 0) {
        const current = pending.pop() as IndexedNode;
        if (current.node.pkgId !== model.root.node.pkgId) {
          const label = packageLabel(current.pkg);
          const entry = packages.get(label) ?? { pkg: current.pkg, via: new Set(), direct: false, prod: false };
          if (current === direct) entry.direct = true;
          else entry.via.add(via);
          entry.prod ||= prod;
          packages.set(label, entry);
        }
        if (visited.has(current.source.nodeId)) continue;
        visited.add(current.source.nodeId);
        for (const child of current.source.deps) {
          const next = model.nodes.get(child);
          assert(next, "Dependency graph node missing.");
          pending.push(next);
        }
      }
    }
  }
  const result = { packages };
  const byScope = packageCache.get(project) ?? new Map();
  byScope.set(scope, result);
  packageCache.set(project, byScope);
  return result;
}

const byNameAndVersion = (a: PackageEntry, b: PackageEntry) =>
  a.pkg.name.localeCompare(b.pkg.name) || compareVersions(a.pkg.version ?? "", b.pkg.version ?? "");

/** Flat package list per project for agent tools; respects the filter and scope like the views. */
export function dependencyPackageList(
  projects: readonly SnykDependencyProjectResult[],
  query: string,
  scope: DependencyScopeFilter,
  vulnerabilities: DependencyVulnerabilities = NO_VULNERABILITIES,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return projects.map(project => {
    const { packages } = collectPackages(project, scope);
    const targetFiles = project.graphs.map(graph => graph.targetFile);
    return {
      targetFile: project.targetFile,
      packageManager: project.packageManager,
      status: project.status,
      reason: project.reason,
      packages: [...packages.values()]
        .filter(entry => !normalizedQuery || matchesQuery(entry.pkg, normalizedQuery))
        .sort(byNameAndVersion)
        .map(entry => ({
          name: entry.pkg.name,
          version: entry.pkg.version,
          direct: entry.direct,
          dev: !entry.prod,
          via: [...entry.via].sort(),
          ...vulnerabilityFields(lookupVulnerability(vulnerabilities, targetFiles, packageLabel(entry.pkg))),
        })),
    };
  });
}

/** The package's own findings for the JSON list: worst severity and IDs; details live in Copy scan as JSON. */
function vulnerabilityFields(found: DependencyVulnerability | undefined) {
  return { severity: found?.severity ?? null, vulnerabilities: found?.ids ?? [] };
}

export function buildPackages(
  projects: readonly SnykDependencyProjectResult[],
  expanded: ReadonlySet<string> | null,
  query: string,
  scope: DependencyScopeFilter,
  vulnerabilities: DependencyVulnerabilities = NO_VULNERABILITIES,
): DependencyRows {
  const rows: DependencyTreeRow[] = [];
  let matchCount = 0;
  let dependencyRows = 0;
  let truncated = false;
  projects.forEach((project, projectIndex) => {
    const { packages } = collectPackages(project, scope);
    const targetFiles = project.graphs.map(graph => graph.targetFile);
    const shown = [...packages.entries()]
      .filter(([, entry]) => !query || matchesQuery(entry.pkg, query))
      .sort(([, a], [, b]) => byNameAndVersion(a, b));
    if (query) matchCount += shown.length;
    const projectKey = JSON.stringify(["project", projectIndex]);
    const projectExpandable = shown.length > 0;
    const projectExpanded = projectExpandable && (expanded === null || expanded.has(projectKey));
    rows.push(projectRow(project, projectIndex, projectExpandable, projectExpanded, shown.length, packages.size));
    if (!projectExpanded) return;
    shown.forEach(([label, entry], index) => {
      if (truncated) return;
      if (dependencyRows === MAX_DEPENDENCY_ROWS) {
        truncated = true;
        return;
      }
      const key = `${projectKey}/${index}`;
      const isLast = index === shown.length - 1;
      const via = [...entry.via].sort();
      const packageExpanded = via.length > 0 && (expanded === null || expanded.has(key));
      rows.push({
        key,
        kind: "dependency",
        depth: 1,
        prefix: isLast ? "└─ " : "├─ ",
        label,
        projectIndex,
        scope: entry.prod ? "prod" : "dev",
        expandable: via.length > 0,
        expanded: packageExpanded,
        reference: false,
        cycle: false,
        path: [label],
        direct: entry.direct,
        vulnerability: lookupVulnerability(vulnerabilities, targetFiles, label)?.severity,
      });
      dependencyRows++;
      if (!packageExpanded) return;
      via.forEach((viaLabel, viaIndex) => {
        if (truncated) return;
        if (dependencyRows === MAX_DEPENDENCY_ROWS) {
          truncated = true;
          return;
        }
        rows.push({
          key: `${key}/${viaIndex}`,
          kind: "dependency",
          depth: 2,
          prefix: `${isLast ? "   " : "│  "}${viaIndex === via.length - 1 ? "└─ " : "├─ "}`,
          label: viaLabel,
          projectIndex,
          scope: null,
          expandable: false,
          expanded: false,
          reference: false,
          cycle: false,
          path: [label, viaLabel],
          // The direct dependency's own findings, like every package occurrence.
          vulnerability: lookupVulnerability(vulnerabilities, targetFiles, viaLabel)?.severity,
        });
        dependencyRows++;
      });
    });
  });
  return { rows, matchCount, truncated, filterIncomplete: false };
}
