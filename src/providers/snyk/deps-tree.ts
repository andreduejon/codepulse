import assert from "node:assert/strict";
import type {
  SnykDependencyGraph,
  SnykDependencyNode,
  SnykDependencyPackage,
  SnykDependencyProjectResult,
  SnykDependencyScope,
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
}

function packageLabel(pkg: SnykDependencyPackage): string {
  return `${pkg.name}@${pkg.version ?? "unknown"}`;
}

// shortcut: cap repeated path rows at 5,000; add viewport virtualization for larger fully expanded trees.
const MAX_DEPENDENCY_ROWS = 5000;
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
}

interface DependencyEdge {
  node: IndexedNode;
  index: number;
}

interface FilterSearchBudget {
  remaining: number;
  incomplete: boolean;
}

function indexGraph(graph: SnykDependencyGraph, query: string): IndexedGraph {
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
  const matching = new Set<string>();
  const relevant = new Set<string>();
  let acyclic = false;
  if (query) {
    const parents = new Map<string, string[]>();
    const remainingDependencies = new Map<string, number>();
    const leaves: string[] = [];
    const pending: string[] = [];
    for (const { node, pkg } of nodes.values()) {
      const matches =
        query.lastIndexOf("@") > 0 ? packageLabel(pkg).toLowerCase() === query : pkg.name.toLowerCase().includes(query);
      if (node.pkgId !== root.node.pkgId && matches) {
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
  return { nodes, root, matching, relevant, filtered: query.length > 0, acyclic };
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
  node.source.deps.forEach((id, index) => {
    const child = graph.nodes.get(id);
    assert(child, "Dependency graph node missing.");
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
    for (const row of buildTree(projects, null, normalizedQuery).rows) {
      if (row.expandable) expanded.add(row.key);
    }
  }
  return expanded;
}

export function buildDependencyTree(
  projects: readonly SnykDependencyProjectResult[],
  expanded: ReadonlySet<string>,
  query?: string,
): { rows: DependencyTreeRow[]; matchCount: number; truncated: boolean; filterIncomplete: boolean } {
  return buildTree(projects, expanded, query?.trim().toLowerCase() ?? "");
}

function buildTree(
  projects: readonly SnykDependencyProjectResult[],
  expanded: ReadonlySet<string> | null,
  query: string,
): { rows: DependencyTreeRow[]; matchCount: number; truncated: boolean; filterIncomplete: boolean } {
  const rows: DependencyTreeRow[] = [];
  const budget: FilterSearchBudget = { remaining: MAX_FILTER_SEARCH_STEPS, incomplete: false };
  let matchCount = 0;
  let dependencyRows = 0;
  let truncated = false;
  const visibleProjects = projects
    .map((project, projectIndex) => {
      const graphs = project.graphs
        .map((graph, graphIndex) => {
          const model = indexGraph(graph, query);
          matchCount += model.matching.size;
          const children = childrenFor(model, model.root, new Set([model.root.source.nodeId]), budget);
          return { graph, graphIndex, model, children };
        })
        .filter(graph => !query || graph.children.length > 0);
      return { project, projectIndex, graphs };
    })
    .filter(({ project, graphs }) => !query || project.status !== "scanned" || graphs.length > 0);

  visibleProjects.forEach(({ project, projectIndex, graphs }, visibleProjectIndex) => {
    const projectKey = JSON.stringify(["project", projectIndex]);
    const multipleGraphs = project.graphs.length > 1;
    const projectExpandable = multipleGraphs ? graphs.length > 0 : (graphs[0]?.children.length ?? 0) > 0;
    const projectExpanded = projectExpandable && (expanded === null || expanded.has(projectKey));
    const projectIsLast = visibleProjectIndex === visibleProjects.length - 1;
    rows.push({
      key: projectKey,
      kind: "project",
      depth: 0,
      prefix: projectIsLast ? "└──" : "├──",
      label: `${project.targetFile}${project.packageManager === "bun" && project.graphs.length > 0 ? " (converted)" : ""}`,
      projectIndex,
      scope: null,
      expandable: projectExpandable,
      expanded: projectExpanded,
      reference: false,
      cycle: false,
      path: [project.targetFile],
    });
    if (!projectExpanded) return;

    graphs.forEach(({ graph, graphIndex, model, children }, visibleGraphIndex) => {
      const root = model.root;
      const rootLabel = packageLabel(root.pkg);
      const graphKey = JSON.stringify(["graph", projectIndex, graphIndex]);
      const graphExpanded = children.length > 0 && (!multipleGraphs || expanded === null || expanded.has(graphKey));
      const graphIsLast = visibleGraphIndex === graphs.length - 1;
      const projectLead = projectIsLast ? "   " : "│  ";
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
          scope: node.node.scope ?? "unknown",
          expandable,
          expanded: nodeExpanded,
          reference,
          cycle,
          path,
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
          });
        } else if (!cycle) ancestors.delete(sourceId);
      }
    });
  });
  return { rows, matchCount, truncated, filterIncomplete: budget.incomplete };
}
