import { describe, expect, test } from "bun:test";
import { isSnykDependencyGraph } from "./dep-graph";
import { buildDependencyTree, defaultDependencyExpansion, dependencyPackageList } from "./deps-tree";
import type { SnykDependencyGraph, SnykDependencyProjectResult } from "./types";

function graph(): SnykDependencyGraph {
  return {
    targetFile: "yarn.lock",
    packageManager: "yarn",
    rootNodeId: "root",
    packages: [
      { id: "fixture@", name: "fixture", version: null },
      { id: "parent@1.0.0", name: "parent", version: "1.0.0" },
      { id: "dev-parent@1.0.0", name: "dev-parent", version: "1.0.0" },
      { id: "@fixture/shared@2.0.0", name: "@fixture/shared", version: "2.0.0" },
      { id: "leaf@3.0.0", name: "leaf", version: "3.0.0" },
    ],
    nodes: [
      { nodeId: "root", pkgId: "fixture@", deps: ["parent", "dev-parent"], scope: "unknown", referenceNodeId: null },
      { nodeId: "parent", pkgId: "parent@1.0.0", deps: ["shared"], scope: "prod", referenceNodeId: null },
      { nodeId: "dev-parent", pkgId: "dev-parent@1.0.0", deps: ["shared"], scope: "dev", referenceNodeId: null },
      { nodeId: "shared", pkgId: "@fixture/shared@2.0.0", deps: ["leaf"], scope: "unknown", referenceNodeId: null },
      { nodeId: "leaf", pkgId: "leaf@3.0.0", deps: [], scope: "prod", referenceNodeId: null },
    ],
  };
}

function project(graphs: SnykDependencyGraph[] = [graph()]): SnykDependencyProjectResult {
  return { targetFile: "yarn.lock", packageManager: "yarn", status: "scanned", graphs, reason: null };
}

function prunedGraph(): SnykDependencyGraph {
  const input = graph();
  input.nodes[2].deps = ["shared:pruned"];
  input.nodes.push({
    nodeId: "shared:pruned",
    pkgId: "@fixture/shared@2.0.0",
    deps: [],
    scope: "dev",
    referenceNodeId: "shared",
  });
  return input;
}

function denseGraph(): SnykDependencyGraph {
  const dependencyCount = 1000;
  return {
    targetFile: "yarn.lock",
    packageManager: "yarn",
    rootNodeId: "node-0",
    packages: Array.from({ length: dependencyCount + 1 }, (_, index) => ({
      id: `pkg-${index}`,
      name: `pkg-${index}`,
      version: "1.0.0",
    })),
    nodes: Array.from({ length: dependencyCount + 1 }, (_, index) => ({
      nodeId: `node-${index}`,
      pkgId: `pkg-${index}`,
      deps: Array.from(
        { length: dependencyCount - index },
        (_, offset) => `node-${index === 0 ? offset + 1 : dependencyCount - offset}`,
      ),
      scope: "prod",
      referenceNodeId: null,
    })),
  };
}

describe("dependency tree", () => {
  test("labels Bun input as converted only when graphs exist", () => {
    const skipped = {
      ...project([]),
      packageManager: "bun" as const,
      targetFile: "bun.lock",
      status: "skipped" as const,
      reason: "Bun not installed",
    };
    const converted = { ...project(), packageManager: "bun" as const, targetFile: "bun.lock" };
    const projects = [skipped, converted];
    expect(buildDependencyTree(projects, defaultDependencyExpansion(projects)).rows[0].label).toBe("bun.lock");
    expect(buildDependencyTree(projects, defaultDependencyExpansion(projects)).rows[1].label).toBe(
      "bun.lock (converted)",
    );
  });

  test("shows direct dependencies under the file without a redundant single-graph heading", () => {
    const projects = [project()];
    const original = JSON.stringify(projects);
    const expanded = defaultDependencyExpansion(projects);
    const result = buildDependencyTree(projects, expanded);
    expect(result.rows.map(row => [row.kind, row.depth, row.prefix, row.label, row.scope, row.expanded])).toEqual([
      ["project", 0, "", "yarn.lock", null, true],
      ["dependency", 1, "├─ ", "parent@1.0.0", "prod", false],
      ["dependency", 1, "└─ ", "dev-parent@1.0.0", "dev", false],
    ]);
    expect(result.rows.map(row => row.path)).toEqual([
      ["yarn.lock"],
      ["fixture@unknown", "parent@1.0.0"],
      ["fixture@unknown", "dev-parent@1.0.0"],
    ]);
    expect(result.rows.every(row => row.expandable && !row.reference && !row.cycle)).toBe(true);
    expect(result).toMatchObject({ matchCount: 0, truncated: false, filterIncomplete: false });
    expect(buildDependencyTree(projects, expanded)).toEqual(result);
    expect(JSON.stringify(projects)).toBe(original);
    expect(expanded.size).toBe(2);
    expect(result.rows[1].key).toBe(`${JSON.stringify(["graph", 0, 0])}/0`);
  });

  test("groups multiple graphs with name-only labels and correct ancestor trunks", () => {
    const fallback = graph();
    fallback.packages[0].name = "";
    fallback.targetFile = "modules/fallback/yarn.lock";
    const projects = [project([graph(), fallback]), project(), project()];
    const { rows } = buildDependencyTree(projects, defaultDependencyExpansion(projects));
    const headings = rows.filter(row => row.kind !== "dependency");
    expect(headings.map(row => [row.kind, row.projectIndex, row.prefix, row.label])).toEqual([
      ["project", 0, "", "yarn.lock"],
      ["graph", 0, "├─ ", "fixture"],
      ["graph", 0, "└─ ", "modules/fallback/yarn.lock"],
      ["project", 1, "", "yarn.lock"],
      ["project", 2, "", "yarn.lock"],
    ]);
    expect(rows[2].prefix).toBe("│  ├─ ");
    expect(rows[5].prefix).toBe("   ├─ ");
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  });

  test("collapsing project or module headings hides descendants and preserves keys", () => {
    const projects = [project([graph(), graph()])];
    const expanded = defaultDependencyExpansion(projects);
    const initial = buildDependencyTree(projects, expanded).rows;
    expanded.delete(initial[1].key);
    const collapsed = buildDependencyTree(projects, expanded).rows;
    expect(collapsed[1]).toMatchObject({ key: initial[1].key, expandable: true, expanded: false });
    expect(collapsed.filter(row => row.kind === "dependency")).toHaveLength(2);
    expanded.delete(initial[0].key);
    expect(buildDependencyTree(projects, expanded).rows).toEqual([{ ...initial[0], expanded: false }]);
    expect(buildDependencyTree(projects, new Set()).rows).toEqual([{ ...initial[0], expanded: false }]);
  });

  test("nested occurrences keep full paths, independent scopes and branch connectors", () => {
    const projects = [project()];
    const expanded = defaultDependencyExpansion(projects);
    const parent = buildDependencyTree(projects, expanded).rows[1];
    expanded.add(parent.key);
    const shared = buildDependencyTree(projects, expanded).rows[2];
    expect(shared).toMatchObject({
      kind: "dependency",
      depth: 2,
      prefix: "│  └─ ",
      label: "@fixture/shared@2.0.0",
      scope: "unknown",
      expandable: true,
      expanded: false,
      path: ["fixture@unknown", "parent@1.0.0", "@fixture/shared@2.0.0"],
    });
    expanded.add(shared.key);
    const rows = buildDependencyTree(projects, expanded).rows;
    expect(rows[3]).toMatchObject({
      depth: 3,
      prefix: "│     └─ ",
      label: "leaf@3.0.0",
      expandable: false,
      expanded: false,
      path: ["fixture@unknown", "parent@1.0.0", "@fixture/shared@2.0.0", "leaf@3.0.0"],
    });
    expanded.add(rows[3].key);
    expect(buildDependencyTree(projects, expanded).rows).toEqual(rows);
    expanded.delete(parent.key);
    expect(buildDependencyTree(projects, expanded).rows).toHaveLength(3);
    expanded.add(parent.key);
    expect(buildDependencyTree(projects, expanded).rows).toEqual(rows);
  });

  test("repeated normal nodes and duplicate edges have independently expandable keys", () => {
    const input = graph();
    input.nodes[0].deps.push("parent");
    const projects = [project([input])];
    const expanded = defaultDependencyExpansion(projects);
    const direct = buildDependencyTree(projects, expanded).rows.slice(1);
    expect(direct[0].path).toEqual(direct[2].path);
    expect(direct[0].key).not.toBe(direct[2].key);
    for (const row of direct) expanded.add(row.key);
    const shared = buildDependencyTree(projects, expanded).rows.filter(row => row.label === "@fixture/shared@2.0.0");
    expect(shared).toHaveLength(3);
    expect(shared.map(row => row.path[1])).toEqual(["parent@1.0.0", "dev-parent@1.0.0", "parent@1.0.0"]);
    expanded.add(shared[0].key);
    let rows = buildDependencyTree(projects, expanded).rows;
    expect(rows.filter(row => row.label === "leaf@3.0.0")).toHaveLength(1);
    expect(rows.find(row => row.key === shared[1].key)?.expanded).toBe(false);
    expanded.add(shared[1].key);
    rows = buildDependencyTree(projects, expanded).rows;
    expect(rows.filter(row => row.label === "leaf@3.0.0")).toHaveLength(2);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  });

  test("pruned references expand canonical dependencies without cloning stored graphs or scope", () => {
    const projects = [project([prunedGraph()])];
    const original = JSON.stringify(projects);
    const expanded = defaultDependencyExpansion(projects);
    for (const row of buildDependencyTree(projects, expanded).rows.slice(1)) expanded.add(row.key);
    let rows = buildDependencyTree(projects, expanded).rows;
    const shared = rows.filter(row => row.label === "@fixture/shared@2.0.0");
    expect(shared[1]).toMatchObject({
      reference: true,
      scope: "dev",
      expandable: true,
      expanded: false,
      cycle: false,
      path: ["fixture@unknown", "dev-parent@1.0.0", "@fixture/shared@2.0.0"],
    });
    for (const row of shared) expanded.add(row.key);
    rows = buildDependencyTree(projects, expanded).rows;
    expect(rows.filter(row => row.label === "leaf@3.0.0")).toHaveLength(2);
    expect(rows.filter(row => row.label === "leaf@3.0.0").every(row => row.scope === "prod")).toBe(true);
    expect(JSON.stringify(projects)).toBe(original);
  });

  test("raw cycles to a parent or root terminate at a cycle row", () => {
    const input = graph();
    input.nodes[3].deps.push("parent", "root");
    const projects = [project([input])];
    const expanded = defaultDependencyExpansion(projects);
    expanded.add(buildDependencyTree(projects, expanded).rows[1].key);
    expanded.add(buildDependencyTree(projects, expanded).rows[2].key);
    const rows = buildDependencyTree(projects, expanded).rows;
    const cycles = rows.filter(row => row.cycle);
    expect(cycles.map(row => row.label)).toEqual(["parent@1.0.0", "fixture@unknown"]);
    expect(cycles.every(row => !row.expandable && !row.expanded && !row.reference)).toBe(true);
    expect(cycles[0].path).toEqual(["fixture@unknown", "parent@1.0.0", "@fixture/shared@2.0.0", "parent@1.0.0"]);
    for (const row of cycles) expanded.add(row.key);
    expect(buildDependencyTree(projects, expanded).rows).toEqual(rows);
  });

  test("references use effective canonical ancestors for cycle safety", () => {
    const input = graph();
    input.nodes[0].deps = ["parent:pruned"];
    input.nodes[3].deps.push("parent", "parent:pruned");
    input.nodes.push({
      nodeId: "parent:pruned",
      pkgId: "parent@1.0.0",
      deps: [],
      scope: "unknown",
      referenceNodeId: "parent",
    });
    const projects = [project([input])];
    const expanded = defaultDependencyExpansion(projects);
    expanded.add(buildDependencyTree(projects, expanded).rows[1].key);
    expanded.add(buildDependencyTree(projects, expanded).rows[2].key);
    const rows = buildDependencyTree(projects, expanded).rows;
    expect(rows[1]).toMatchObject({ reference: true, cycle: false, expanded: true });
    // The sibling `parent:pruned` duplicates `parent` and is collapsed into it.
    expect(rows.filter(row => row.cycle).map(row => [row.reference, row.expandable, row.expanded])).toEqual([
      [false, false, false],
    ]);
  });

  test("missing dependency versions remain explicit and empty graphs keep only their file", () => {
    const input = graph();
    input.packages[1].version = null;
    const projects = [project([input])];
    expect(buildDependencyTree(projects, defaultDependencyExpansion(projects)).rows[1]).toMatchObject({
      label: "parent@unknown",
      path: ["fixture@unknown", "parent@unknown"],
    });
    input.nodes[0].deps = [];
    const rows = buildDependencyTree(projects, defaultDependencyExpansion(projects)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "project", label: "yarn.lock", expandable: false, expanded: false });
  });

  test("whole-graph filtering finds collapsed descendants and counts packages rather than occurrences", () => {
    const input = graph();
    input.nodes[0].deps.push("unrelated");
    input.packages.push({ id: "unrelated@1", name: "unrelated", version: "1" });
    input.nodes.push({ nodeId: "unrelated", pkgId: "unrelated@1", deps: [], scope: "prod", referenceNodeId: null });
    const projects = [project([input])];
    const collapsed = buildDependencyTree(projects, defaultDependencyExpansion(projects), " LEAF ");
    expect(collapsed.matchCount).toBe(1);
    expect(collapsed.rows.map(row => row.label)).toEqual(["yarn.lock", "parent@1.0.0", "dev-parent@1.0.0"]);
    const expanded = defaultDependencyExpansion(projects, " LEAF ");
    const result = buildDependencyTree(projects, expanded, "leaf");
    expect(result.matchCount).toBe(1);
    expect(result.rows.map(row => row.label)).toEqual([
      "yarn.lock",
      "parent@1.0.0",
      "@fixture/shared@2.0.0",
      "leaf@3.0.0",
      "dev-parent@1.0.0",
      "@fixture/shared@2.0.0",
      "leaf@3.0.0",
    ]);
    expect(result.rows[4].prefix).toBe("└─ ");
    expect(result.rows.filter(row => row.expandable).every(row => row.expanded)).toBe(true);
    expect(buildDependencyTree([project(), project()], new Set(), "leaf").matchCount).toBe(2);
  });

  test("filtered ancestors can collapse, reopen, and reset to package-collapsed defaults on clearing", () => {
    const projects = [project()];
    const expanded = defaultDependencyExpansion(projects, "leaf");
    const initial = buildDependencyTree(projects, expanded, "leaf");
    const parent = initial.rows[1];
    expanded.delete(parent.key);
    const collapsed = buildDependencyTree(projects, expanded, "leaf");
    expect(collapsed.matchCount).toBe(1);
    expect(collapsed.rows).toHaveLength(5);
    // Closed while filtering: the row counts matches below it.
    expect(collapsed.rows[1]).toEqual({ ...parent, expanded: false, matches: "1" });
    expanded.add(parent.key);
    expect(buildDependencyTree(projects, expanded, "leaf")).toEqual(initial);
    expanded.delete(initial.rows[0].key);
    expect(buildDependencyTree(projects, expanded, "leaf").rows).toEqual([{ ...initial.rows[0], expanded: false }]);
    const cleared = buildDependencyTree(projects, defaultDependencyExpansion(projects, ""), "");
    expect(cleared.rows).toHaveLength(3);
    expect(cleared.rows[1]).toMatchObject({ key: parent.key, path: parent.path, expandable: true, expanded: false });
    expect(defaultDependencyExpansion(projects, "   ")).toEqual(defaultDependencyExpansion(projects));
  });

  test("name substring searches support scopes and version queries require the complete name and version", () => {
    const input = graph();
    input.packages.push({ id: "shared-v3", name: "@fixture/shared", version: "3.0.0" });
    input.nodes.push({ nodeId: "shared-v3", pkgId: "shared-v3", deps: [], scope: "prod", referenceNodeId: null });
    input.nodes[0].deps.push("shared-v3");
    const projects = [project([input])];
    for (const query of ["SHARED", "@fixture", "@fixture/shared"]) {
      expect(buildDependencyTree(projects, new Set(), query).matchCount).toBe(2);
    }
    const query = "@FIXTURE/shared@2.0.0";
    const exact = buildDependencyTree(projects, defaultDependencyExpansion(projects, query), query);
    expect(exact.matchCount).toBe(1);
    expect(exact.rows.filter(row => row.label === "@fixture/shared@2.0.0")).toHaveLength(2);
    expect(exact.rows.some(row => row.label === "@fixture/shared@3.0.0" || row.label === "leaf@3.0.0")).toBe(false);
    for (const missing of ["shared@2.0.0", "@fixture/shared@2", "leaf@3", "lea@3.0.0", "2.0.0"]) {
      const result = buildDependencyTree(projects, new Set(), missing);
      expect(result).toMatchObject({ matchCount: 0, truncated: false, filterIncomplete: false });
      // Only the project header remains, with a zero count and nothing to open.
      expect(result.rows.map(row => [row.kind, row.count, row.total, row.expandable])).toEqual([
        ["project", 0, 5, false],
      ]);
    }
  });

  test("filtering follows a pruned-only path to canonical descendants", () => {
    const input = prunedGraph();
    input.nodes[0].deps = ["dev-parent"];
    const projects = [project([input])];
    const result = buildDependencyTree(projects, defaultDependencyExpansion(projects, "leaf@3.0.0"), "leaf@3.0.0");
    expect(result.matchCount).toBe(1);
    expect(result.rows.map(row => row.label)).toEqual([
      "yarn.lock",
      "dev-parent@1.0.0",
      "@fixture/shared@2.0.0",
      "leaf@3.0.0",
    ]);
    expect(result.rows[2]).toMatchObject({ reference: true, scope: "dev", expandable: true, expanded: true });
    expect(result.rows[3].path).toEqual(["fixture@unknown", "dev-parent@1.0.0", "@fixture/shared@2.0.0", "leaf@3.0.0"]);
  });

  test("filtering omits cycle-only context but retains matching cycle endpoints", () => {
    const input = graph();
    input.nodes[0].deps = ["parent"];
    input.nodes[1].deps = ["shared", "leaf"];
    input.nodes[3].deps = ["parent", "root"];
    const projects = [project([input])];
    const leaf = buildDependencyTree(projects, defaultDependencyExpansion(projects, "leaf"), "leaf");
    expect(leaf.rows.map(row => row.label)).toEqual(["yarn.lock", "parent@1.0.0", "leaf@3.0.0"]);
    const parent = buildDependencyTree(projects, defaultDependencyExpansion(projects, "parent@1.0.0"), "parent@1.0.0");
    expect(parent.matchCount).toBe(1);
    expect(parent.rows.filter(row => row.cycle).map(row => row.label)).toEqual(["parent@1.0.0"]);
    expect(parent.truncated).toBe(false);
    expect(buildDependencyTree(projects, new Set(), "fixture@unknown").matchCount).toBe(0);
  });

  test("reference-to-canonical edges participate in filtered cycle detection", () => {
    const input = graph();
    input.nodes[0].deps = ["parent"];
    input.nodes[1].deps = ["shared", "leaf"];
    input.nodes[3].deps = ["parent:pruned"];
    input.nodes.push({
      nodeId: "parent:pruned",
      pkgId: "parent@1.0.0",
      deps: [],
      scope: "dev",
      referenceNodeId: "parent",
    });
    const projects = [project([input])];
    const leaf = buildDependencyTree(projects, defaultDependencyExpansion(projects, "leaf"), "leaf");
    expect(leaf.rows.map(row => row.label)).toEqual(["yarn.lock", "parent@1.0.0", "leaf@3.0.0"]);
    expect(leaf.filterIncomplete).toBe(false);
    const query = "parent@1.0.0";
    const parent = buildDependencyTree(projects, defaultDependencyExpansion(projects, query), query);
    expect(parent.rows.filter(row => row.cycle)).toMatchObject([
      { label: "parent@1.0.0", reference: true, expandable: false, expanded: false },
    ]);
    expect(parent).toMatchObject({ matchCount: 1, truncated: false, filterIncomplete: false });
  });

  test("no-match filters retain failed/skipped roots and reasons, including failed partial graphs", () => {
    const projects: SnykDependencyProjectResult[] = [
      project(),
      { ...project([]), targetFile: "skipped/yarn.lock", status: "skipped", reason: "Not supported" },
      { ...project([]), targetFile: "failed/yarn.lock", status: "failed", reason: "Failed" },
      { ...project(), targetFile: "partial/yarn.lock", status: "failed", reason: "Incomplete scan" },
    ];
    const result = buildDependencyTree(projects, defaultDependencyExpansion(projects, "missing"), "missing");
    expect(result.rows.map(row => [row.kind, row.projectIndex, row.prefix, row.label, row.expandable])).toEqual([
      // Like severity headers, scanned projects without matches stay listed with a zero count.
      ["project", 0, "", "yarn.lock", false],
      ["project", 1, "", "skipped/yarn.lock", false],
      ["project", 2, "", "failed/yarn.lock", false],
      ["project", 3, "", "partial/yarn.lock", false],
    ]);
    expect(result.rows.map(row => [row.count, row.total])).toEqual([
      [0, 4],
      [0, 0],
      [0, 0],
      [0, 4],
    ]);
    expect(result.rows.map(row => projects[row.projectIndex].reason)).toEqual([
      null,
      "Not supported",
      "Failed",
      "Incomplete scan",
    ]);
    const partial = buildDependencyTree(projects, defaultDependencyExpansion(projects, "leaf"), "leaf");
    expect(partial.rows.some(row => row.projectIndex === 3 && row.label === "leaf@3.0.0")).toBe(true);
  });

  test("empty input has no rows or expansion", () => {
    expect(defaultDependencyExpansion([]).size).toBe(0);
    expect(defaultDependencyExpansion([], "leaf").size).toBe(0);
    expect(buildDependencyTree([], new Set())).toEqual({
      rows: [],
      matchCount: 0,
      truncated: false,
      filterIncomplete: false,
    });
  });

  test("deep chains and filtered defaults traverse iteratively past 1000 ancestors", () => {
    const dependencyCount = 1500;
    const input: SnykDependencyGraph = {
      targetFile: "yarn.lock",
      packageManager: "yarn",
      rootNodeId: "node-0",
      packages: Array.from({ length: dependencyCount + 1 }, (_, index) => ({
        id: `pkg-${index}`,
        name: `pkg-${index}`,
        version: "1.0.0",
      })),
      nodes: Array.from({ length: dependencyCount + 1 }, (_, index) => ({
        nodeId: `node-${index}`,
        pkgId: `pkg-${index}`,
        deps: index < dependencyCount ? [`node-${index + 1}`] : [],
        scope: "unknown",
        referenceNodeId: null,
      })),
    };
    const projects = [project([input])];
    const expanded = defaultDependencyExpansion(projects);
    expect(buildDependencyTree(projects, expanded).rows).toHaveLength(2);
    let key = JSON.stringify(["graph", 0, 0]);
    for (let index = 1; index < dependencyCount; index++) {
      key += "/0";
      expanded.add(key);
    }
    const full = buildDependencyTree(projects, expanded);
    const rows = full.rows;
    const last = rows[rows.length - 1];
    // The chain is deeper than the 1,000-row cap: traversal stays iterative and stops at the cap.
    const shown = 1000;
    expect(full.truncated).toBe(true);
    expect(rows).toHaveLength(shown + 1);
    expect(last).toMatchObject({
      label: `pkg-${shown}@1.0.0`,
      depth: shown,
      expandable: true,
      expanded: true,
      cycle: false,
    });
    expect(last.path).toHaveLength(shown + 1);
    expect(last.path[0]).toBe("pkg-0@1.0.0");
    const query = `pkg-${dependencyCount}@1.0.0`;
    const filtered = buildDependencyTree(projects, defaultDependencyExpansion(projects, query), query);
    // Too deep to open fully: the filter opens one level and the closed row counts the match below.
    expect(filtered).toMatchObject({ matchCount: 1, truncated: false, filterIncomplete: false });
    expect(filtered.rows.map(row => [row.label, row.count, row.expanded, row.matches])).toEqual([
      ["yarn.lock", 1, true, undefined],
      ["pkg-1@1.0.0", undefined, false, "1"],
    ]);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  });

  test("dense DAG filtering indexes edges instead of searching each child's descendants", () => {
    const input = denseGraph();
    const edgeCount = input.nodes.reduce((total, node) => total + node.deps.length, 0);
    let edgeVisits = 0;
    for (const { deps } of input.nodes) {
      Object.defineProperty(deps, Symbol.iterator, {
        value: function* () {
          for (let index = 0; index < deps.length; index++) {
            if (++edgeVisits > edgeCount * 8) {
              throw new Error("Repeated DAG descendant searches exceeded the edge budget.");
            }
            yield deps[index];
          }
        },
      });
    }
    const projects = [project([input])];
    const query = "pkg-1000@1.0.0";
    const expanded = defaultDependencyExpansion(projects, query);
    const result = buildDependencyTree(projects, expanded, query);
    // Large result: one level open; closed rows count matches below within a step limit.
    expect(result).toMatchObject({ matchCount: 1, truncated: false, filterIncomplete: false });
    expect(result.rows.filter(row => row.kind === "dependency")).toHaveLength(1000);
    expect(result.rows.find(row => row.label === query)).toMatchObject({ expandable: false });
    expect(result.rows.find(row => row.label === "pkg-1@1.0.0")?.matches).toMatch(/^1\+?$/);
    expect(edgeVisits).toBeLessThanOrEqual(edgeCount * 8);
    expanded.delete(result.rows[0].key);
    const collapsed = buildDependencyTree(projects, expanded, query);
    expect(collapsed.rows).toEqual([{ ...result.rows[0], expanded: false }]);
    expect(collapsed).toMatchObject({ matchCount: 1, truncated: false, filterIncomplete: false });
  });

  test("cyclic search budgets are shared across graphs without truncating rows or whole-graph counts", () => {
    const input = denseGraph();
    input.nodes[1000].deps = ["node-1"];
    const later = graph();
    later.nodes[0].deps = ["parent"];
    later.nodes[1].deps = ["parent", "leaf"];
    later.packages[4].name = "pkg-1000";
    later.packages[4].version = "1.0.0";
    expect(isSnykDependencyGraph(input)).toBe(true);
    expect(isSnykDependencyGraph(later)).toBe(true);
    const projects = [project([input]), project([later])];
    const query = "pkg-1000@1.0.0";
    const expanded = defaultDependencyExpansion(projects, query);
    const result = buildDependencyTree(projects, expanded, query);
    expect(result).toMatchObject({ matchCount: 2, truncated: false, filterIncomplete: true });
    expect(result.rows.map(row => row.label)).toEqual(["yarn.lock", query, "yarn.lock"]);
    expect(result.rows[1]).toMatchObject({ expandable: false, cycle: false, reference: false });
    expect(buildDependencyTree(projects, new Set(), query)).toMatchObject({
      matchCount: 2,
      truncated: false,
      filterIncomplete: true,
    });
  });

  test("caps repeated DAG paths at 1000 dependency rows without losing full counts or failure roots", () => {
    const input = graph();
    const levels = 20;
    input.rootNodeId = "node-0";
    input.packages = Array.from({ length: levels }, (_, index) => ({
      id: `pkg-${index}`,
      name: `pkg-${index}`,
      version: "1",
    }));
    input.nodes = Array.from({ length: levels }, (_, index) => ({
      nodeId: `node-${index}`,
      pkgId: `pkg-${index}`,
      deps: index + 1 < levels ? [`node-${index + 1}`, `node-${index + 1}`] : [],
      scope: "prod",
      referenceNodeId: null,
    }));
    const later = graph();
    later.nodes[0].deps = ["leaf"];
    later.packages[4].name = "pkg-after-cap";
    const projects: SnykDependencyProjectResult[] = [
      project([input]),
      { ...project([later]), targetFile: "later/yarn.lock" },
      { ...project([]), status: "failed", reason: "Failed" },
      { ...project([]), status: "skipped", reason: "Not supported" },
    ];
    // Everything opened by hand; filters alone now open one level for large results.
    const expanded = { has: () => true } as unknown as ReadonlySet<string>;
    for (const query of ["pkg", ""]) {
      const result = buildDependencyTree(projects, expanded, query);
      expect(result.rows.filter(row => row.kind === "dependency")).toHaveLength(1000);
      expect(result.rows.filter(row => row.kind === "project").map(row => row.projectIndex)).toEqual([0, 1, 2, 3]);
      expect(result.truncated).toBe(true);
      expect(result.filterIncomplete).toBe(false);
      expect(result.matchCount).toBe(query ? levels : 0);
      expect(new Set(result.rows.map(row => row.key)).size).toBe(result.rows.length);
    }
    const collapsed = buildDependencyTree(projects, new Set(), "pkg");
    expect(collapsed.rows).toHaveLength(4);
    expect(collapsed).toMatchObject({ matchCount: levels, truncated: false });
    const query = "pkg-after-cap";
    const narrowed = buildDependencyTree(projects, defaultDependencyExpansion(projects, query), query);
    expect(narrowed).toMatchObject({ matchCount: 1, truncated: false });
    // The first project stays listed without matches; the match sits under the second.
    expect(narrowed.rows.slice(0, 3).map(row => [row.label, row.count])).toEqual([
      ["yarn.lock", 0],
      ["later/yarn.lock", 1],
      ["pkg-after-cap@3.0.0", undefined],
    ]);
  });

  test("the exact row cap is not reported as truncated until another visible occurrence exists", () => {
    const input = graph();
    input.nodes[0].deps = Array.from({ length: 1000 }, () => "leaf");
    const projects = [project([input])];
    const expanded = defaultDependencyExpansion(projects);
    expect(buildDependencyTree(projects, expanded)).toMatchObject({ truncated: false });
    input.nodes[0].deps.push("leaf");
    const result = buildDependencyTree(projects, expanded);
    expect(result.rows).toHaveLength(1001);
    expect(result.truncated).toBe(true);
  });

  test("scope filters direct dependencies and keeps their subtrees, counts and matches", () => {
    // pruned: dev-parent reaches shared only through a reference node.
    const projects = [project([prunedGraph()]), project([])];
    const labels = (scope: "all" | "prod" | "dev", query = "") =>
      buildDependencyTree(projects, defaultDependencyExpansion(projects, query, scope), query, scope);
    const prod = labels("prod");
    expect(prod.rows.filter(row => row.depth === 1).map(row => row.label)).toEqual(["parent@1.0.0"]);
    expect(prod.rows.map(row => [row.label, row.count, row.total])[0]).toEqual(["yarn.lock", 3, 3]);
    const dev = labels("dev");
    expect(dev.rows.filter(row => row.depth === 1).map(row => row.label)).toEqual(["dev-parent@1.0.0"]);
    // Reference nodes count their canonical subtree.
    expect(dev.rows[0]).toMatchObject({ count: 3, total: 3 });
    expect(labels("all").rows[0]).toMatchObject({ count: 4, total: 4 });
    // Matches outside the scope do not count.
    expect(labels("dev", "parent")).toMatchObject({ matchCount: 1 });
    expect(labels("dev", "parent").rows.map(row => row.label)).toEqual(["yarn.lock", "dev-parent@1.0.0", "yarn.lock"]);
    expect(labels("prod", "dev-parent")).toMatchObject({ matchCount: 0 });
    expect(labels("prod", "dev-parent").rows[0]).toMatchObject({ count: 0, total: 3, expandable: false });
  });

  test("group by package lists unique packages A-Z, opening to the direct dependencies that pull them in", () => {
    const projects = [project([prunedGraph()])];
    const build = (query = "", scope: "all" | "prod" | "dev" = "all") =>
      buildDependencyTree(
        projects,
        defaultDependencyExpansion(projects, query, scope, "package"),
        query,
        scope,
        "package",
      );
    const all = build();
    expect(all.rows.map(row => [row.prefix, row.label, row.scope, row.direct, row.expandable, row.expanded])).toEqual([
      ["", "yarn.lock", null, undefined, true, true],
      ["├─ ", "@fixture/shared@2.0.0", "prod", false, true, false],
      ["├─ ", "dev-parent@1.0.0", "dev", true, false, false],
      ["├─ ", "leaf@3.0.0", "prod", false, true, false],
      ["└─ ", "parent@1.0.0", "prod", true, false, false],
    ]);
    expect(all.rows[0]).toMatchObject({ count: 4, total: 4 });
    const opened = buildDependencyTree(projects, new Set([all.rows[0].key, all.rows[3].key]), "", "all", "package");
    // Reached through a reference node from dev-parent, too.
    expect(opened.rows.slice(4, 6).map(row => [row.prefix, row.label, row.path])).toEqual([
      ["│  ├─ ", "dev-parent@1.0.0", ["leaf@3.0.0", "dev-parent@1.0.0"]],
      ["│  └─ ", "parent@1.0.0", ["leaf@3.0.0", "parent@1.0.0"]],
    ]);
    // Small filter results open fully; counts follow the filter and scope.
    const filtered = build("leaf");
    expect(filtered).toMatchObject({ matchCount: 1, truncated: false });
    expect(filtered.rows.map(row => row.label)).toEqual([
      "yarn.lock",
      "leaf@3.0.0",
      "dev-parent@1.0.0",
      "parent@1.0.0",
    ]);
    expect(build("", "dev").rows.map(row => [row.label, row.scope])).toEqual([
      ["yarn.lock", null],
      ["@fixture/shared@2.0.0", "dev"],
      ["dev-parent@1.0.0", "dev"],
      ["leaf@3.0.0", "dev"],
    ]);
  });

  test("a child listed as both node and pruned reference (pnpm peers) shows once, as the node", () => {
    const input = prunedGraph();
    input.nodes[1].deps = ["shared:pruned", "shared"];
    const projects = [project([input])];
    const parentKey = buildDependencyTree(projects, defaultDependencyExpansion(projects)).rows[1].key;
    const rows = buildDependencyTree(projects, new Set([...defaultDependencyExpansion(projects), parentKey])).rows;
    expect(rows.slice(1, 3).map(row => [row.label, row.reference])).toEqual([
      ["parent@1.0.0", false],
      ["@fixture/shared@2.0.0", false],
    ]);
    expect(rows[3].label).toBe("dev-parent@1.0.0");
  });

  test("the JSON package list follows filter and scope", () => {
    const input = graph();
    input.packages.push({ id: "leaf@4.0.0", name: "leaf", version: "4.0.0" });
    input.nodes.push({ nodeId: "leaf-4", pkgId: "leaf@4.0.0", deps: [], scope: "dev", referenceNodeId: null });
    input.nodes[2].deps.push("leaf-4");
    const projects = [project([input])];
    expect(dependencyPackageList(projects, "LEAF", "all")[0]).toEqual({
      targetFile: "yarn.lock",
      packageManager: "yarn",
      status: "scanned",
      reason: null,
      packages: [
        { name: "leaf", version: "3.0.0", direct: false, dev: false, via: ["dev-parent@1.0.0", "parent@1.0.0"] },
        { name: "leaf", version: "4.0.0", direct: false, dev: true, via: ["dev-parent@1.0.0"] },
      ],
    });
    expect(dependencyPackageList(projects, "", "prod")[0].packages.map(pkg => pkg.name)).toEqual([
      "@fixture/shared",
      "leaf",
      "parent",
    ]);
  });
});
