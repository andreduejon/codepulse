import { describe, expect, test } from "bun:test";
import { isSnykDependencyGraph, parseSnykDepGraphs } from "./dep-graph";

function fixture(packageManager = "yarn") {
  return {
    schemaVersion: "1.3.0",
    pkgManager: { name: packageManager },
    pkgs: [
      { id: "fixture@", info: { name: "fixture" } },
      { id: "parent@1.0.0", info: { name: "parent", version: "1.0.0" } },
      { id: "dev-parent@1.0.0", info: { name: "dev-parent", version: "1.0.0" } },
      { id: "@fixture/shared@2.0.0", info: { name: "@fixture/shared", version: "2.0.0" } },
      { id: "leaf@3.0.0", info: { name: "leaf", version: "3.0.0" } },
    ],
    graph: {
      rootNodeId: "root-node",
      nodes: [
        { nodeId: "root-node", pkgId: "fixture@", deps: [{ nodeId: "parent" }, { nodeId: "dev-parent" }] },
        {
          nodeId: "parent",
          pkgId: "parent@1.0.0",
          deps: [{ nodeId: "shared" }],
          info: { labels: { scope: "prod" } },
        },
        {
          nodeId: "dev-parent",
          pkgId: "dev-parent@1.0.0",
          deps: [{ nodeId: "shared:pruned" }],
          info: { labels: { scope: "dev" } },
        },
        {
          nodeId: "shared",
          pkgId: "@fixture/shared@2.0.0",
          deps: [{ nodeId: "leaf" }],
          info: { labels: { scope: "prod" } },
        },
        {
          nodeId: "shared:pruned",
          pkgId: "@fixture/shared@2.0.0",
          deps: [],
          info: { labels: { scope: "dev" } },
        },
        { nodeId: "leaf", pkgId: "leaf@3.0.0", deps: [], info: { labels: { scope: "prod" } } },
      ],
    },
  };
}

function block(value: unknown = fixture(), target = "yarn.lock"): string {
  return `DepGraph data:\n${JSON.stringify(value)}\nDepGraph target:\n${target}\nDepGraph end`;
}

describe("parseSnykDepGraphs", () => {
  test("normalizes packages, edges and per-node scope without assuming node IDs are package IDs", () => {
    const [graph] = parseSnykDepGraphs(block());
    expect(graph).toMatchObject({ packageManager: "yarn", targetFile: "yarn.lock", rootNodeId: "root-node" });
    expect(graph.packages).toEqual(
      fixture().pkgs.map(pkg => ({ id: pkg.id, ...pkg.info, version: pkg.info.version ?? null })),
    );
    expect(graph.nodes[0]).toEqual({
      nodeId: "root-node",
      pkgId: "fixture@",
      deps: ["parent", "dev-parent"],
      scope: "unknown",
      referenceNodeId: null,
    });
    expect(graph.nodes[1].scope).toBe("prod");
    expect(graph.nodes[2].scope).toBe("dev");
  });

  test("preserves pruned references and their own scope, keeping transitive dependencies reachable", () => {
    const [graph] = parseSnykDepGraphs(block());
    const repeat = graph.nodes.find(node => node.nodeId === "shared:pruned");
    expect(repeat).toMatchObject({ deps: [], scope: "dev", referenceNodeId: "shared" });
    const canonical = graph.nodes.find(node => node.nodeId === repeat?.referenceNodeId);
    expect(canonical).toMatchObject({ pkgId: "@fixture/shared@2.0.0", scope: "prod", deps: ["leaf"] });
    expect(graph.nodes).toHaveLength(6);
  });

  test("accepts a project with no dependencies", () => {
    const input = fixture();
    input.pkgs = input.pkgs.slice(0, 1);
    input.graph.nodes = [{ ...input.graph.nodes[0], deps: [] }];
    const [graph] = parseSnykDepGraphs(block(input));
    expect(graph.packages).toEqual([{ id: "fixture@", name: "fixture", version: null }]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].deps).toEqual([]);
  });

  test("resolves the exact node ID, not an arbitrary node for the same package", () => {
    const input = fixture();
    input.graph.nodes.push({
      nodeId: "other-context",
      pkgId: "@fixture/shared@2.0.0",
      deps: [],
      info: { labels: { scope: "dev" } },
    });
    input.graph.nodes[2].deps.push({ nodeId: "other-context" });
    const [graph] = parseSnykDepGraphs(block(input));
    expect(graph.nodes.find(node => node.nodeId === "shared:pruned")?.referenceNodeId).toBe("shared");
    expect(graph.nodes.filter(node => node.pkgId === "@fixture/shared@2.0.0")).toHaveLength(3);
  });

  test("keeps graph cycles as references rather than recursively expanding them", () => {
    const input = fixture();
    input.graph.nodes[3].deps.push({ nodeId: "shared:pruned" });
    const [graph] = parseSnykDepGraphs(block(input));
    expect(graph.nodes[3].deps).toEqual(["leaf", "shared:pruned"]);
    expect(graph.nodes[4].referenceNodeId).toBe("shared");
    expect(graph.nodes).toHaveLength(6);
  });

  test("missing or unrecognized scope remains unknown, never inferred as production", () => {
    const input = fixture();
    delete input.graph.nodes[1].info;
    input.graph.nodes[2].info = { labels: { scope: "future-scope" } };
    const [graph] = parseSnykDepGraphs(block(input));
    expect(graph.nodes.slice(0, 3).map(node => node.scope)).toEqual(["unknown", "unknown", "unknown"]);
  });

  test("parses multiple projects, CRLF, surrounding CLI text and repeated target names", () => {
    const output = [
      "Testing projects...",
      block(),
      "No known vulnerabilities",
      block(fixture("pnpm"), "packages/app/package.json"),
      block(fixture("pnpm"), "packages/app/package.json"),
      "[]",
    ]
      .join("\n\n")
      .replaceAll("\n", "\r\n");
    expect(parseSnykDepGraphs(output).map(graph => [graph.packageManager, graph.targetFile])).toEqual([
      ["yarn", "yarn.lock"],
      ["pnpm", "packages/app/package.json"],
      ["pnpm", "packages/app/package.json"],
    ]);
  });

  test("drops unneeded metadata and normalizes repository-relative Windows paths", () => {
    const input = { ...fixture(), path: "/private/fixture", org: "fixture-org" };
    Object.assign(input.pkgs[1].info, { path: "/private/fixture/package", extra: true });
    Object.assign(input.graph.nodes[1].info ?? {}, { path: "/private/fixture/node" });
    const [graph] = parseSnykDepGraphs(block(input, ".\\packages\\app\\yarn.lock"));
    expect(graph.targetFile).toBe("packages/app/yarn.lock");
    expect(JSON.stringify(graph)).not.toContain("/private/");
    expect(JSON.stringify(graph)).not.toContain("fixture-org");
    expect(JSON.stringify(graph)).not.toContain("extra");
  });

  test("preserves spaces in project targets", () => {
    expect(parseSnykDepGraphs(block(fixture(), "packages/fixture app/yarn.lock"))[0].targetFile).toBe(
      "packages/fixture app/yarn.lock",
    );
    expect(parseSnykDepGraphs(block(fixture(), " fixture/yarn.lock"))[0].targetFile).toBe(" fixture/yarn.lock");
  });

  test.each([
    "",
    " ",
    ".",
    "packages/",
    "../yarn.lock",
    "packages/../../yarn.lock",
    "/private/fixture/yarn.lock",
    "C:\\fixture\\yarn.lock",
    "C:yarn.lock",
    "./C:/fixture/yarn.lock",
    "./C:yarn.lock",
    "\\\\host\\share\\yarn.lock",
  ])("rejects unsafe or empty project target %j", target => {
    expect(() => parseSnykDepGraphs(block(fixture(), target))).toThrow("Unsupported Snyk CLI output.");
  });

  test.each([
    "",
    "No supported projects",
    "[]",
    "DepGraph data:\n{}",
    "DepGraph target:\nyarn.lock\nDepGraph end",
    "DepGraph data:\nnot-json\nDepGraph target:\nyarn.lock\nDepGraph end",
    block().replace("DepGraph target:", "DepGraph file:"),
    block().replace("DepGraph end", ""),
    `${block()}\nDepGraph end`,
    `${block()}\nDepGraph data:\n{`,
    `${block()}\n${block({})}`,
  ])("rejects missing, malformed or truncated blocks without returning partial results (%#)", output => {
    expect(() => parseSnykDepGraphs(output)).toThrow("Unsupported Snyk CLI output.");
  });

  test.each([
    { value: null },
    { value: [] },
    { value: {} },
    { value: { ...fixture(), schemaVersion: "2.0.0" } },
    { value: { ...fixture(), pkgManager: { name: "" } } },
    { value: { ...fixture(), pkgs: [] } },
    { value: { ...fixture(), graph: { rootNodeId: "missing", nodes: fixture().graph.nodes } } },
    { value: { ...fixture(), graph: { rootNodeId: "root-node", nodes: [] } } },
    { value: { ...fixture(), pkgs: [...fixture().pkgs, fixture().pkgs[0]] } },
    {
      value: {
        ...fixture(),
        graph: { ...fixture().graph, nodes: [...fixture().graph.nodes, fixture().graph.nodes[0]] },
      },
    },
  ])("rejects invalid graph structure (%#)", ({ value }) => {
    expect(() => parseSnykDepGraphs(block(value))).toThrow("Unsupported Snyk CLI output.");
  });

  test.each([
    { id: "", info: { name: "parent", version: "1.0.0" } },
    { id: "parent@1.0.0", info: { name: "", version: "1.0.0" } },
    { id: "parent@1.0.0", info: { name: "parent", version: 1 } },
    { id: "parent@1.0.0", info: null },
  ])("rejects invalid package data (%#)", pkg => {
    const input = fixture();
    expect(() => parseSnykDepGraphs(block({ ...input, pkgs: [input.pkgs[0], pkg, ...input.pkgs.slice(2)] }))).toThrow(
      "Unsupported Snyk CLI output.",
    );
  });

  test.each([
    { nodeId: "parent", pkgId: "missing", deps: [] },
    { nodeId: "parent", pkgId: "parent@1.0.0", deps: [{ nodeId: "missing" }] },
    { nodeId: "parent", pkgId: "parent@1.0.0", deps: ["shared"] },
    { nodeId: "parent", pkgId: "parent@1.0.0", deps: [{ nodeId: "" }] },
    { nodeId: "parent", pkgId: "parent@1.0.0", deps: [], info: null },
    { nodeId: "parent", pkgId: "parent@1.0.0", deps: [], info: { labels: [] } },
    { nodeId: "parent", pkgId: "parent@1.0.0", deps: [], info: { labels: { scope: 1 } } },
  ])("rejects invalid nodes or dangling dependency edges (%#)", node => {
    const input = fixture();
    expect(() =>
      parseSnykDepGraphs(
        block({
          ...input,
          graph: { ...input.graph, nodes: [input.graph.nodes[0], node, ...input.graph.nodes.slice(2)] },
        }),
      ),
    ).toThrow("Unsupported Snyk CLI output.");
  });

  test("rejects a pruned node without its exact canonical node", () => {
    const input = fixture();
    input.graph.nodes[3].nodeId = "other-context";
    input.graph.nodes[1].deps = [{ nodeId: "other-context" }];
    expect(() => parseSnykDepGraphs(block(input))).toThrow("Unsupported Snyk CLI output.");
  });

  test("rejects pruned references to different packages or nodes with their own children", () => {
    const input = fixture();
    input.graph.nodes[4].pkgId = "leaf@3.0.0";
    expect(() => parseSnykDepGraphs(block(input))).toThrow("Unsupported Snyk CLI output.");
    input.graph.nodes[4].pkgId = "@fixture/shared@2.0.0";
    input.graph.nodes[4].deps = [{ nodeId: "leaf" }];
    expect(() => parseSnykDepGraphs(block(input))).toThrow("Unsupported Snyk CLI output.");
  });
});

describe("isSnykDependencyGraph", () => {
  test("accepts normalized graphs with pruned references, unknown scope and a versionless root", () => {
    const [graph] = parseSnykDepGraphs(block());
    expect(isSnykDependencyGraph(graph)).toBe(true);
    expect(isSnykDependencyGraph(JSON.parse(JSON.stringify(graph)))).toBe(true);
  });

  test.each([{ value: null }, { value: [] }, { value: {} }])("rejects non-graph values (%#)", ({ value }) => {
    expect(isSnykDependencyGraph(value)).toBe(false);
  });

  test.each([
    { targetFile: "/private/fixture/yarn.lock" },
    { targetFile: "../yarn.lock" },
    { targetFile: "./yarn.lock" },
    { targetFile: "packages\\app\\yarn.lock" },
    { targetFile: "" },
    { packageManager: " " },
    { rootNodeId: "missing" },
    { packages: [] },
    { packages: [{ id: "fixture@", name: "fixture" }] },
    { packages: [{ id: "fixture@", name: "", version: null }] },
    { packages: [{ id: "fixture@", name: "fixture", version: 1 }] },
    { nodes: [] },
    { nodes: [{ nodeId: "root-node", pkgId: "fixture@", deps: [], scope: "unknown" }] },
    { nodes: [{ nodeId: "root-node", pkgId: "fixture@", deps: [], scope: "future", referenceNodeId: null }] },
    { nodes: [{ nodeId: "root-node", pkgId: "fixture@", deps: [1], scope: "unknown", referenceNodeId: null }] },
  ])("rejects malformed normalized graph fields (%#)", fields => {
    const [graph] = parseSnykDepGraphs(block());
    expect(isSnykDependencyGraph({ ...graph, ...fields })).toBe(false);
  });

  test.each([
    "duplicate-package",
    "duplicate-node",
    "missing-package",
    "dangling-edge",
    "missing-canonical",
    "wrong-package",
    "wrong-reference",
    "missing-reference",
    "unexpected-reference",
    "reference-chain",
    "pruned-children",
  ])("rejects invalid graph associations: %s", invalid => {
    const [graph] = parseSnykDepGraphs(block());
    switch (invalid) {
      case "duplicate-package":
        graph.packages.push(graph.packages[0]);
        break;
      case "duplicate-node":
        graph.nodes.push(graph.nodes[0]);
        break;
      case "missing-package":
        graph.nodes[1].pkgId = "missing";
        break;
      case "dangling-edge":
        graph.nodes[1].deps = ["missing"];
        break;
      case "missing-canonical":
        graph.nodes.splice(3, 1);
        graph.nodes[1].deps = [];
        break;
      case "wrong-package":
        graph.nodes[4].pkgId = "leaf@3.0.0";
        break;
      case "wrong-reference":
        graph.nodes[4].referenceNodeId = "parent";
        break;
      case "missing-reference":
        graph.nodes[4].referenceNodeId = null;
        break;
      case "unexpected-reference":
        graph.nodes[1].referenceNodeId = "shared";
        break;
      case "reference-chain":
        graph.nodes.push({ ...graph.nodes[4], nodeId: "shared:pruned:pruned", referenceNodeId: "shared:pruned" });
        break;
      case "pruned-children":
        graph.nodes[4].deps = ["leaf"];
        break;
    }
    expect(isSnykDependencyGraph(graph)).toBe(false);
  });
});
