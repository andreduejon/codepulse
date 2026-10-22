import assert from "node:assert/strict";
import {
  type DependencyGroupBy,
  type DependencyRows,
  type DependencyScopeFilter,
  type DependencyTreeRow,
  type DependencyVulnerabilities,
  type IndexedGraph,
  type IndexedNode,
  indexGraph,
  inScope,
  lookupVulnerability,
  MAX_DEPENDENCY_ROWS,
  NO_VULNERABILITIES,
  packageLabel,
  projectRow,
} from "./deps-model";
import { buildPackages } from "./deps-packages";
import type { SnykDependencyProjectResult, SnykDependencyScope } from "./types";

/** Filter results up to this many rows open fully; larger ones open one level and show match counts. */
const FULL_EXPANSION_ROWS = 200;
// shortcut: cap cyclic descendant searches at 100,000 steps per build; add path-aware caching if incomplete paths are common.
const MAX_FILTER_SEARCH_STEPS = 100000;

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

interface DependencyEdge {
  node: IndexedNode;
  index: number;
}

interface FilterSearchBudget {
  remaining: number;
  incomplete: boolean;
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
): DependencyRows {
  return (groupBy === "package" ? buildPackages : buildTree)(
    projects,
    expanded,
    query?.trim().toLowerCase() ?? "",
    scope,
    vulnerabilities,
  );
}

function buildTree(
  projects: readonly SnykDependencyProjectResult[],
  expanded: ReadonlySet<string> | null,
  query: string,
  scope: DependencyScopeFilter,
  vulnerabilities: DependencyVulnerabilities = NO_VULNERABILITIES,
): DependencyRows {
  const rows: DependencyTreeRow[] = [];
  const budget: FilterSearchBudget = { remaining: MAX_FILTER_SEARCH_STEPS, incomplete: false };
  const countBudget = { remaining: MAX_MATCH_COUNT_STEPS };
  let matchCount = 0;
  let dependencyRows = 0;
  let truncated = false;
  const visibleProjects = projects.map((project, projectIndex) => {
    const graphs = project.graphs.map((graph, graphIndex) => {
      const model = indexGraph(graph, query, scope);
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
    // A package matching in several graphs of one project counts once, like the project header.
    if (query) matchCount += shown.size;
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
    rows.push(projectRow(project, projectIndex, projectExpandable, projectExpanded, count, total));
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
          vulnerability: lookupVulnerability(vulnerabilities, [graph.targetFile], label)?.severity,
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
