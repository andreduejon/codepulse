import assert from "node:assert/strict";
import { compareVersions } from "./parser";
import type {
  SnykDependencyGraph,
  SnykDependencyNode,
  SnykDependencyPackage,
  SnykDependencyProjectResult,
  SnykDependencyScope,
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
  /** Project headers with a single graph: the project's own package name (graph root). */
  rootName?: string;
  /** Group by package: the package is itself a direct dependency. */
  direct?: boolean;
  /** The package's worst finding severity; details live in Vulnerabilities. */
  vulnerability?: SnykSeverity;
  /** While filtering, closed rows: unique matching packages below them (`N+` when the search stopped early). */
  matches?: string;
}

/** Worst severity per {@link vulnerabilityKey}: the graph's manifest and `name@version`. */
export type DependencyVulnerabilities = ReadonlyMap<string, SnykSeverity>;
const NO_VULNERABILITIES: DependencyVulnerabilities = new Map();

/** Findings without a manifest use an empty one and match any graph. */
export const vulnerabilityKey = (targetFile: string, label: string) => `${targetFile}\u0000${label}`;

function lookupVulnerability<T>(
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

const inScope = (node: SnykDependencyNode, scope: DependencyScopeFilter) =>
  scope === "all" || (node.scope === "dev") === (scope === "dev");

function packageLabel(pkg: SnykDependencyPackage): string {
  return `${pkg.name}@${pkg.version ?? "unknown"}`;
}

/** `name@version` queries match exactly; anything else is a name substring. */
function matchesQuery(pkg: SnykDependencyPackage, query: string): boolean {
  return query.lastIndexOf("@") > 0
    ? packageLabel(pkg).toLowerCase() === query
    : pkg.name.toLowerCase().includes(query);
}

// shortcut: count matches below closed rows within 200,000 shared steps (`N+` beyond); precompute per-node sets if counts often stop early.
const MAX_MATCH_COUNT_STEPS = 200000;

/** Unique matching packages strictly below `node`, walking only branches that lead to a match. */
function matchesBelow(graph: IndexedGraph, node: IndexedNode, budget: { remaining: number }): string {
  const found = new Set<string>();
  const visited = new Set<string>([node.source.nodeId]);
  const pending: IndexedNode[] = [];
  // Shown closed rows always have a match below, so a stopped count is at least 1.
  const partial = () => `${Math.max(found.size, 1)}+`;
  const push = (from: IndexedNode) => {
    for (const id of from.source.deps) {
      if (budget.remaining-- <= 0) return false;
      const child = graph.nodes.get(id);
      if (child && graph.relevant.has(child.node.nodeId)) pending.push(child);
    }
    return true;
  };
  if (!push(node)) return partial();
  while (pending.length > 0) {
    const current = pending.pop() as IndexedNode;
    if (graph.matching.has(current.node.pkgId)) found.add(current.node.pkgId);
    if (visited.has(current.source.nodeId)) continue;
    visited.add(current.source.nodeId);
    if (!push(current)) return partial();
  }
  return `${found.size}`;
}

// shortcut: cap rows at 1,000 since rendering cost grows per row (~0.1 ms each); add viewport virtualization for larger trees.
const MAX_DEPENDENCY_ROWS = 1000;
/** Filter results up to this many rows open fully; larger ones open one level and show match counts. */
const FULL_EXPANSION_ROWS = 200;
// shortcut: cap cyclic descendant searches at 100,000 steps per build; add path-aware caching if incomplete paths are common.
const MAX_FILTER_SEARCH_STEPS = 100000;

interface IndexedNode {
  node: SnykDependencyNode;
  pkg: SnykDependencyPackage;
  source: SnykDependencyNode;
}

interface IndexedGraph {
  nodes: Map<string, IndexedNode>;
  root: IndexedNode;
  matching: Set<string>;
  relevant: Set<string>;
  filtered: boolean;
  acyclic: boolean;
  /** Nodes under in-scope direct dependencies; null when every scope is shown. */
  included: Set<string> | null;
}

interface DependencyEdge {
  node: IndexedNode;
  index: number;
}

interface FilterSearchBudget {
  remaining: number;
  incomplete: boolean;
}

function indexGraph(graph: SnykDependencyGraph, query: string, scope: DependencyScopeFilter): IndexedGraph {
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

function reachesMatch(
  graph: IndexedGraph,
  node: IndexedNode,
  ancestors: ReadonlySet<string>,
  budget: FilterSearchBudget,
): boolean {
  if (graph.matching.has(node.node.pkgId)) return true;
  if (!graph.relevant.has(node.node.nodeId) || ancestors.has(node.source.nodeId)) return false;
  const pending = [node];
  const visited = new Set<string>();
  while (pending.length > 0) {
    if (budget.remaining === 0) {
      budget.incomplete = true;
      return false;
    }
    budget.remaining--;
    const current = pending.pop();
    assert(current, "Dependency graph traversal state missing.");
    if (graph.matching.has(current.node.pkgId)) return true;
    const id = current.source.nodeId;
    if (!graph.relevant.has(current.node.nodeId) || ancestors.has(id) || visited.has(id)) continue;
    visited.add(id);
    for (const dependency of current.source.deps) {
      if (budget.remaining === 0) {
        budget.incomplete = true;
        return false;
      }
      budget.remaining--;
      const child = graph.nodes.get(dependency);
      assert(child, "Dependency graph node missing.");
      pending.push(child);
    }
  }
  return false;
}

function childrenFor(
  graph: IndexedGraph,
  node: IndexedNode,
  ancestors: ReadonlySet<string>,
  budget: FilterSearchBudget,
): DependencyEdge[] {
  const children: DependencyEdge[] = [];
  // Snyk's pnpm graphs can list a child twice (node and its `:pruned` reference); keep the node.
  const siblings = new Set(node.source.deps);
  node.source.deps.forEach((id, index) => {
    const child = graph.nodes.get(id);
    assert(child, "Dependency graph node missing.");
    if (child.node.referenceNodeId !== null && siblings.has(child.node.referenceNodeId)) return;
    if (
      !graph.filtered ||
      (graph.acyclic ? graph.relevant.has(child.node.nodeId) : reachesMatch(graph, child, ancestors, budget))
    ) {
      children.push({ node: child, index });
    }
  });
  return children;
}

export function defaultDependencyExpansion(
  projects: readonly SnykDependencyProjectResult[],
  query?: string,
  scope: DependencyScopeFilter = "all",
  groupBy: DependencyGroupBy = "tree",
): Set<string> {
  const expanded = new Set<string>();
  projects.forEach((project, projectIndex) => {
    expanded.add(JSON.stringify(["project", projectIndex]));
    project.graphs.forEach((_, graphIndex) => {
      expanded.add(JSON.stringify(["graph", projectIndex, graphIndex]));
    });
  });
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  if (normalizedQuery) {
    // Large results stay one level deep (closed rows show match counts) so rendering stays fast.
    const full = (groupBy === "package" ? buildPackages : buildTree)(projects, null, normalizedQuery, scope);
    if (!full.truncated && full.rows.length <= FULL_EXPANSION_ROWS) {
      for (const row of full.rows) if (row.expandable) expanded.add(row.key);
    }
  }
  return expanded;
}

export function buildDependencyTree(
  projects: readonly SnykDependencyProjectResult[],
  expanded: ReadonlySet<string>,
  query?: string,
  scope: DependencyScopeFilter = "all",
  groupBy: DependencyGroupBy = "tree",
  vulnerabilities: DependencyVulnerabilities = NO_VULNERABILITIES,
): { rows: DependencyTreeRow[]; matchCount: number; truncated: boolean; filterIncomplete: boolean } {
  return (groupBy === "package" ? buildPackages : buildTree)(
    projects,
    expanded,
    query?.trim().toLowerCase() ?? "",
    scope,
    vulnerabilities,
  );
}

interface PackageEntry {
  pkg: SnykDependencyPackage;
  via: Set<string>;
  direct: boolean;
  prod: boolean;
}

/** The package list ignores the filter, so typing reuses it; keyed by the (immutable) scanned project. */
const packageCache = new WeakMap<
  SnykDependencyProjectResult,
  Map<DependencyScopeFilter, { packages: Map<string, PackageEntry>; rootName?: string }>
>();

function collectPackages(project: SnykDependencyProjectResult, scope: DependencyScopeFilter) {
  const cached = packageCache.get(project)?.get(scope);
  if (cached) return cached;
  const packages = new Map<string, PackageEntry>();
  let rootName: string | undefined;
  for (const graph of project.graphs) {
    const model = indexGraph(graph, "", scope);
    if (project.graphs.length === 1) rootName = model.root.pkg.name || undefined;
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
  const result = { packages, rootName };
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
) {
  const normalizedQuery = query.trim().toLowerCase();
  return projects.map(project => {
    const { packages } = collectPackages(project, scope);
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
        })),
    };
  });
}

function buildPackages(
  projects: readonly SnykDependencyProjectResult[],
  expanded: ReadonlySet<string> | null,
  query: string,
  scope: DependencyScopeFilter,
  vulnerabilities: DependencyVulnerabilities = NO_VULNERABILITIES,
): { rows: DependencyTreeRow[]; matchCount: number; truncated: boolean; filterIncomplete: boolean } {
  const rows: DependencyTreeRow[] = [];
  let matchCount = 0;
  let dependencyRows = 0;
  let truncated = false;
  projects.forEach((project, projectIndex) => {
    const { packages, rootName } = collectPackages(project, scope);
    const shown = [...packages.entries()]
      .filter(([, entry]) => !query || matchesQuery(entry.pkg, query))
      .sort(([, a], [, b]) => byNameAndVersion(a, b));
    if (query) matchCount += shown.length;
    const projectKey = JSON.stringify(["project", projectIndex]);
    const projectExpandable = shown.length > 0;
    const projectExpanded = projectExpandable && (expanded === null || expanded.has(projectKey));
    rows.push({
      key: projectKey,
      kind: "project",
      depth: 0,
      prefix: "",
      label: `${project.targetFile}${project.packageManager === "bun" && project.graphs.length > 0 ? " (converted)" : ""}`,
      projectIndex,
      scope: null,
      expandable: projectExpandable,
      expanded: projectExpanded,
      reference: false,
      cycle: false,
      path: [project.targetFile],
      count: shown.length,
      total: packages.size,
      rootName,
    });
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
        vulnerability: lookupVulnerability(
          vulnerabilities,
          project.graphs.map(graph => graph.targetFile),
          label,
        ),
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
        });
        dependencyRows++;
      });
    });
  });
  return { rows, matchCount, truncated, filterIncomplete: false };
}

function buildTree(
  projects: readonly SnykDependencyProjectResult[],
  expanded: ReadonlySet<string> | null,
  query: string,
  scope: DependencyScopeFilter,
  vulnerabilities: DependencyVulnerabilities = NO_VULNERABILITIES,
): { rows: DependencyTreeRow[]; matchCount: number; truncated: boolean; filterIncomplete: boolean } {
  const rows: DependencyTreeRow[] = [];
  const budget: FilterSearchBudget = { remaining: MAX_FILTER_SEARCH_STEPS, incomplete: false };
  const countBudget = { remaining: MAX_MATCH_COUNT_STEPS };
  let matchCount = 0;
  let dependencyRows = 0;
  let truncated = false;
  const visibleProjects = projects.map((project, projectIndex) => {
    const graphs = project.graphs.map((graph, graphIndex) => {
      const model = indexGraph(graph, query, scope);
      matchCount += model.matching.size;
      const children = childrenFor(model, model.root, new Set([model.root.source.nodeId]), budget).filter(edge =>
        inScope(edge.node.node, scope),
      );
      const included = model.included;
      const all = new Set(
        (included === null
          ? graph.packages.map(pkg => pkg.id)
          : graph.nodes.filter(node => included.has(node.nodeId)).map(node => node.pkgId)
        ).filter(id => id !== model.root.node.pkgId),
      );
      const shown = query ? model.matching : all;
      return { graph, graphIndex, model, children, all, shown };
    });
    const all = new Set(graphs.flatMap(graph => [...graph.all]));
    const shown = new Set(graphs.flatMap(graph => [...graph.shown]));
    // Like severity headers, projects and modules stay listed while filtering; counts show matches.
    return { project, projectIndex, graphs, count: shown.size, total: all.size };
  });

  visibleProjects.forEach(({ project, projectIndex, graphs, count, total }) => {
    const projectKey = JSON.stringify(["project", projectIndex]);
    const multipleGraphs = project.graphs.length > 1;
    const projectExpandable = multipleGraphs
      ? graphs.some(graph => graph.children.length > 0)
      : (graphs[0]?.children.length ?? 0) > 0;
    const projectExpanded = projectExpandable && (expanded === null || expanded.has(projectKey));
    rows.push({
      key: projectKey,
      kind: "project",
      depth: 0,
      // Headers sit at column 0 like severity headers; children connect from there.
      prefix: "",
      label: `${project.targetFile}${project.packageManager === "bun" && project.graphs.length > 0 ? " (converted)" : ""}`,
      projectIndex,
      scope: null,
      expandable: projectExpandable,
      expanded: projectExpanded,
      reference: false,
      cycle: false,
      path: [project.targetFile],
      count,
      total,
      // Module rows already name multi-graph projects.
      rootName: multipleGraphs ? undefined : graphs[0]?.model.root.pkg.name || undefined,
    });
    if (!projectExpanded) return;

    graphs.forEach(({ graph, graphIndex, model, children, all, shown }, visibleGraphIndex) => {
      const root = model.root;
      const rootLabel = packageLabel(root.pkg);
      const graphKey = JSON.stringify(["graph", projectIndex, graphIndex]);
      const graphExpanded = children.length > 0 && (!multipleGraphs || expanded === null || expanded.has(graphKey));
      const graphIsLast = visibleGraphIndex === graphs.length - 1;
      const projectLead = "";
      if (multipleGraphs) {
        rows.push({
          key: graphKey,
          kind: "graph",
          depth: 1,
          prefix: `${projectLead}${graphIsLast ? "└─ " : "├─ "}`,
          label: root.pkg.name || graph.targetFile,
          projectIndex,
          scope: null,
          expandable: children.length > 0,
          expanded: graphExpanded,
          reference: false,
          cycle: false,
          path: [rootLabel],
          count: shown.size,
          total: all.size,
        });
      }
      if (!graphExpanded) return;

      const ancestors = new Set([root.source.nodeId]);
      const stack = [
        {
          sourceId: root.source.nodeId,
          children,
          key: graphKey,
          path: [rootLabel],
          lead: projectLead + (multipleGraphs ? (graphIsLast ? "   " : "│  ") : ""),
          depth: multipleGraphs ? 2 : 1,
          nextIndex: 0,
          // Rows inherit their direct dependency's scope; Snyk's per-package flags are unreliable below it.
          directScope: null as SnykDependencyScope | null,
        },
      ];
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (frame.nextIndex === frame.children.length) {
          ancestors.delete(frame.sourceId);
          stack.pop();
          continue;
        }
        if (dependencyRows === MAX_DEPENDENCY_ROWS) {
          truncated = true;
          break;
        }

        const { node, index } = frame.children[frame.nextIndex++];
        const isLast = frame.nextIndex === frame.children.length;
        const label = packageLabel(node.pkg);
        const key = `${frame.key}/${index}`;
        const path = [...frame.path, label];
        const reference = node.node.referenceNodeId !== null;
        const sourceId = node.source.nodeId;
        const cycle = ancestors.has(sourceId);
        if (!cycle) ancestors.add(sourceId);
        const children = cycle ? [] : childrenFor(model, node, ancestors, budget);
        const expandable = children.length > 0;
        const nodeExpanded = expandable && (expanded === null || expanded.has(key));
        rows.push({
          key,
          kind: "dependency",
          depth: frame.depth,
          prefix: `${frame.lead}${isLast ? "└─ " : "├─ "}`,
          label,
          projectIndex,
          scope: frame.directScope ?? node.node.scope ?? "unknown",
          expandable,
          expanded: nodeExpanded,
          reference,
          cycle,
          path,
          ...(query && expandable && !nodeExpanded ? { matches: matchesBelow(model, node, countBudget) } : {}),
          vulnerability: lookupVulnerability(vulnerabilities, [graph.targetFile], label),
        });
        dependencyRows++;
        if (nodeExpanded) {
          stack.push({
            sourceId,
            children,
            key,
            path,
            lead: frame.lead + (isLast ? "   " : "│  "),
            depth: frame.depth + 1,
            nextIndex: 0,
            directScope: frame.directScope ?? node.node.scope ?? "unknown",
          });
        } else if (!cycle) ancestors.delete(sourceId);
      }
    });
  });
  return { rows, matchCount, truncated, filterIncomplete: budget.incomplete };
}
