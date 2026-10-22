import assert from "node:assert/strict";
import { groupSnykVulnerabilities } from "./parser";
import type {
  SnykDependencyGraph,
  SnykDependencyNode,
  SnykDependencyPackage,
  SnykDependencyProjectResult,
  SnykDependencyScope,
  SnykFinding,
  SnykSeverity,
} from "./types";

export interface DependencyTreeRow {
  key: string;
  kind: "project" | "graph" | "dependency";
  depth: number;
  prefix: string;
  label: string;
  projectIndex: number;
  scope: SnykDependencyScope | null;
  expandable: boolean;
  expanded: boolean;
  reference: boolean;
  cycle: boolean;
  path: string[];
  /** Project/module headers: unique packages (matches while filtering) and the unfiltered total. */
  count?: number;
  total?: number;
  /** Group by package: the package is itself a direct dependency. */
  direct?: boolean;
  /** The package's worst finding severity; details live in Vulnerabilities. */
  vulnerability?: SnykSeverity;
  /** While filtering, closed rows: unique matching packages below them (`N+` when the search stopped early). */
  matches?: string;
}

/** Rows of one view (tree or package), with what the Dependencies tab reports below them. */
export interface DependencyRows {
  rows: DependencyTreeRow[];
  matchCount: number;
  truncated: boolean;
  filterIncomplete: boolean;
}

/** A package's own findings: worst severity and their CVE (or Snyk) IDs, worst first. */
export interface DependencyVulnerability {
  severity: SnykSeverity;
  ids: string[];
}
/** Per {@link vulnerabilityKey}: the graph's manifest and `name@version`. */
export type DependencyVulnerabilities = ReadonlyMap<string, DependencyVulnerability>;
export const NO_VULNERABILITIES: DependencyVulnerabilities = new Map();

/** Findings without a manifest use an empty one and match any graph. */
export const vulnerabilityKey = (targetFile: string, label: string) => `${targetFile}\u0000${label}`;

/** Each finding's own package (manifest + `name@version`), as Vulnerabilities lists them. */
export function dependencyVulnerabilities(findings: readonly SnykFinding[]): DependencyVulnerabilities {
  const packages = new Map<string, DependencyVulnerability>();
  // Entries arrive worst first, so the first one per package sets its severity.
  for (const { finding } of groupSnykVulnerabilities(findings)) {
    const key = vulnerabilityKey(finding.targetFile ?? "", `${finding.dependency}@${finding.installedVersion}`);
    const entry = packages.get(key) ?? { severity: finding.severity, ids: [] };
    for (const id of finding.cves?.length ? finding.cves : [finding.id])
      if (!entry.ids.includes(id)) entry.ids.push(id);
    packages.set(key, entry);
  }
  return packages;
}

export function lookupVulnerability<T>(
  map: ReadonlyMap<string, T>,
  targetFiles: readonly string[],
  label: string,
): T | undefined {
  for (const targetFile of [...targetFiles, ""]) {
    const found = map.get(vulnerabilityKey(targetFile, label));
    if (found) return found;
  }
  return undefined;
}

/** Which direct dependencies (and their subtrees) to show: `prod` is everything not flagged dev. */
export type DependencyScopeFilter = "all" | "prod" | "dev";
/** `tree`: the dependency graph; `package`: unique packages A–Z, each opening to the direct dependencies that pull it in. */
export type DependencyGroupBy = "tree" | "package";

export const inScope = (node: SnykDependencyNode, scope: DependencyScopeFilter) =>
  scope === "all" || (node.scope === "dev") === (scope === "dev");

export function packageLabel(pkg: SnykDependencyPackage): string {
  return `${pkg.name}@${pkg.version ?? "unknown"}`;
}

/** `name@version` queries match exactly; anything else is a name substring. */
export function matchesQuery(pkg: SnykDependencyPackage, query: string): boolean {
  return query.lastIndexOf("@") > 0
    ? packageLabel(pkg).toLowerCase() === query
    : pkg.name.toLowerCase().includes(query);
}

// shortcut: cap rows at 1,000 since rendering cost grows per row (~0.1 ms each); add viewport virtualization for larger trees.
export const MAX_DEPENDENCY_ROWS = 1000;

/** Project header at column 0, like severity headers; children connect from there. */
export function projectRow(
  project: SnykDependencyProjectResult,
  projectIndex: number,
  expandable: boolean,
  expanded: boolean,
  count: number,
  total: number,
): DependencyTreeRow {
  return {
    key: JSON.stringify(["project", projectIndex]),
    kind: "project",
    depth: 0,
    prefix: "",
    label: `${project.targetFile}${project.packageManager === "bun" && project.graphs.length > 0 ? " (converted)" : ""}`,
    projectIndex,
    scope: null,
    expandable,
    expanded,
    reference: false,
    cycle: false,
    path: [project.targetFile],
    count,
    total,
  };
}

export interface IndexedNode {
  node: SnykDependencyNode;
  pkg: SnykDependencyPackage;
  source: SnykDependencyNode;
}

export interface IndexedGraph {
  nodes: Map<string, IndexedNode>;
  root: IndexedNode;
  matching: Set<string>;
  relevant: Set<string>;
  filtered: boolean;
  acyclic: boolean;
  /** Nodes under in-scope direct dependencies; null when every scope is shown. */
  included: Set<string> | null;
}

export function indexGraph(graph: SnykDependencyGraph, query: string, scope: DependencyScopeFilter): IndexedGraph {
  const nodesById = new Map(graph.nodes.map(node => [node.nodeId, node]));
  const packages = new Map(graph.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map<string, IndexedNode>();
  for (const node of graph.nodes) {
    const pkg = packages.get(node.pkgId);
    assert(pkg, "Dependency graph package missing.");
    const source = node.referenceNodeId === null ? node : nodesById.get(node.referenceNodeId);
    assert(source, "Dependency graph reference missing.");
    assert(source.referenceNodeId === null, "Dependency graph reference must be canonical.");
    for (const id of node.deps) assert(nodesById.has(id), "Dependency graph node missing.");
    nodes.set(node.nodeId, { node, pkg, source });
  }
  const root = nodes.get(graph.rootNodeId);
  assert(root, "Dependency graph root node missing.");
  let included: Set<string> | null = null;
  if (scope !== "all") {
    included = new Set();
    const pending = root.source.deps.filter(id => {
      const child = nodes.get(id);
      return child !== undefined && inScope(child.node, scope);
    });
    while (pending.length > 0) {
      const id = pending.pop();
      const current = id === undefined ? undefined : nodes.get(id);
      if (!current || included.has(current.node.nodeId)) continue;
      included.add(current.node.nodeId);
      pending.push(current.source.nodeId, ...current.source.deps);
    }
  }
  const matching = new Set<string>();
  const relevant = new Set<string>();
  let acyclic = false;
  if (query) {
    const parents = new Map<string, string[]>();
    const remainingDependencies = new Map<string, number>();
    const leaves: string[] = [];
    const pending: string[] = [];
    for (const { node, pkg } of nodes.values()) {
      const matches = matchesQuery(pkg, query);
      if (node.pkgId !== root.node.pkgId && matches && (included === null || included.has(node.nodeId))) {
        matching.add(node.pkgId);
        pending.push(node.nodeId);
      }
      const dependencies = node.referenceNodeId === null ? node.deps : [node.referenceNodeId];
      remainingDependencies.set(node.nodeId, dependencies.length);
      if (dependencies.length === 0) leaves.push(node.nodeId);
      for (const id of dependencies) {
        const incoming = parents.get(id) ?? [];
        incoming.push(node.nodeId);
        parents.set(id, incoming);
      }
    }
    while (leaves.length > 0) {
      const id = leaves.pop();
      assert(id !== undefined, "Dependency graph traversal state missing.");
      remainingDependencies.delete(id);
      for (const parent of parents.get(id) ?? []) {
        const remaining = remainingDependencies.get(parent);
        assert(remaining !== undefined, "Dependency graph traversal state missing.");
        remainingDependencies.set(parent, remaining - 1);
        if (remaining === 1) leaves.push(parent);
      }
    }
    acyclic = remainingDependencies.size === 0;
    while (pending.length > 0) {
      const id = pending.pop();
      assert(id !== undefined, "Dependency graph traversal state missing.");
      if (relevant.has(id)) continue;
      relevant.add(id);
      for (const parent of parents.get(id) ?? []) pending.push(parent);
    }
  }
  return { nodes, root, matching, relevant, filtered: query.length > 0, acyclic, included };
}
