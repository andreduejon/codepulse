import { posix, win32 } from "node:path";
import type { SnykDependencyGraph, SnykDependencyNode, SnykDependencyPackage, SnykDependencyScope } from "./types";

function unsupportedOutput(): never {
  throw new Error("Unsupported Snyk CLI output.");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeSnykTargetFile(value: unknown): string | null {
  if (!isString(value)) return null;
  const path = value.replaceAll("\\", "/");
  if (win32.parse(path).root || path.split("/").includes("..") || path.includes("\0")) return null;
  const normalized = posix.normalize(path);
  if (normalized === "." || normalized.endsWith("/") || win32.parse(normalized).root) return null;
  return normalized;
}

export function isSnykDependencyGraph(value: unknown): value is SnykDependencyGraph {
  if (
    !isObject(value) ||
    !isString(value.targetFile) ||
    normalizeSnykTargetFile(value.targetFile) !== value.targetFile ||
    !isString(value.packageManager) ||
    !isString(value.rootNodeId) ||
    !Array.isArray(value.packages) ||
    !Array.isArray(value.nodes)
  ) {
    return false;
  }
  if (
    !value.packages.every(
      (pkg: unknown): pkg is SnykDependencyPackage =>
        isObject(pkg) && isString(pkg.id) && isString(pkg.name) && (pkg.version === null || isString(pkg.version)),
    ) ||
    !value.nodes.every(
      (node: unknown): node is SnykDependencyNode =>
        isObject(node) &&
        isString(node.nodeId) &&
        isString(node.pkgId) &&
        Array.isArray(node.deps) &&
        node.deps.every(isString) &&
        (node.scope === "prod" || node.scope === "dev" || node.scope === "unknown") &&
        node.referenceNodeId === (node.nodeId.endsWith(":pruned") ? node.nodeId.slice(0, -":pruned".length) : null),
    )
  ) {
    return false;
  }

  const packageIds = new Set(value.packages.map(pkg => pkg.id));
  const nodesById = new Map(value.nodes.map(node => [node.nodeId, node]));
  if (
    packageIds.size !== value.packages.length ||
    nodesById.size !== value.nodes.length ||
    !nodesById.has(value.rootNodeId)
  ) {
    return false;
  }
  for (const node of value.nodes) {
    if (!packageIds.has(node.pkgId) || node.deps.some(id => !nodesById.has(id))) return false;
    if (node.referenceNodeId !== null) {
      const reference = nodesById.get(node.referenceNodeId);
      if (!reference || reference.pkgId !== node.pkgId || reference.referenceNodeId !== null || node.deps.length) {
        return false;
      }
    }
  }
  return true;
}

// Maven graphs carry no scope labels; the scope is the last part of `group:artifact:type[:classifier]:version:scope`,
// sometimes followed by a Maven note such as ` (scope not updated to provided)`.
const MAVEN_SCOPES = new Map<string, SnykDependencyScope>([
  ["compile", "prod"],
  ["provided", "prod"],
  ["runtime", "prod"],
  ["system", "prod"],
  ["test", "dev"],
]);

function mavenScope(nodeId: string): SnykDependencyScope {
  const id = (nodeId.endsWith(":pruned") ? nodeId.slice(0, -":pruned".length) : nodeId).replace(/ \(.*\)$/, "");
  return MAVEN_SCOPES.get(id.slice(id.lastIndexOf(":") + 1)) ?? "unknown";
}

function parseGraph(raw: string, target: string): SnykDependencyGraph {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    unsupportedOutput();
  }
  // shortcut: only schema 1.3.0 is verified; extend after testing output from other CLI versions.
  if (
    !isObject(value) ||
    value.schemaVersion !== "1.3.0" ||
    !isObject(value.pkgManager) ||
    !isString(value.pkgManager.name) ||
    !Array.isArray(value.pkgs) ||
    !isObject(value.graph) ||
    !isString(value.graph.rootNodeId) ||
    !Array.isArray(value.graph.nodes)
  ) {
    unsupportedOutput();
  }

  const packages: SnykDependencyPackage[] = value.pkgs.map((pkg: unknown) => {
    if (
      !isObject(pkg) ||
      !isString(pkg.id) ||
      !isObject(pkg.info) ||
      !isString(pkg.info.name) ||
      (pkg.info.version !== undefined && !isString(pkg.info.version))
    ) {
      unsupportedOutput();
    }
    return { id: pkg.id, name: pkg.info.name, version: pkg.info.version ?? null };
  });
  const maven = value.pkgManager.name === "maven";
  const nodes: SnykDependencyNode[] = value.graph.nodes.map((node: unknown) => {
    if (
      !isObject(node) ||
      !isString(node.nodeId) ||
      !isString(node.pkgId) ||
      !Array.isArray(node.deps) ||
      (node.info !== undefined && !isObject(node.info))
    ) {
      unsupportedOutput();
    }
    const labels = isObject(node.info) ? node.info.labels : undefined;
    if (labels !== undefined && !isObject(labels)) unsupportedOutput();
    const scope = isObject(labels) ? labels.scope : undefined;
    if (scope !== undefined && typeof scope !== "string") unsupportedOutput();
    return {
      nodeId: node.nodeId,
      pkgId: node.pkgId,
      deps: node.deps.map((dep: unknown) => {
        if (!isObject(dep) || !isString(dep.nodeId)) unsupportedOutput();
        return dep.nodeId;
      }),
      scope:
        scope === "prod" || scope === "dev"
          ? scope
          : maven && scope === undefined
            ? mavenScope(node.nodeId)
            : "unknown",
      referenceNodeId: node.nodeId.endsWith(":pruned") ? node.nodeId.slice(0, -":pruned".length) : null,
    };
  });
  const graph = {
    targetFile: normalizeSnykTargetFile(target),
    packageManager: value.pkgManager.name,
    rootNodeId: value.graph.rootNodeId,
    packages,
    nodes,
  };
  if (!isSnykDependencyGraph(graph)) unsupportedOutput();
  return graph;
}

/** Parse the verified --print-graph block format; never return a partly parsed output. */
export function parseSnykDepGraphs(raw: string): SnykDependencyGraph[] {
  const lines = raw.split(/\r?\n/);
  const graphs: SnykDependencyGraph[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line !== "DepGraph data:") {
      if (line.startsWith("DepGraph")) unsupportedOutput();
      continue;
    }
    if (lines[index + 2]?.trim() !== "DepGraph target:" || lines[index + 4]?.trim() !== "DepGraph end") {
      unsupportedOutput();
    }
    graphs.push(parseGraph(lines[index + 1], lines[index + 3]));
    index += 4;
  }
  if (graphs.length === 0) unsupportedOutput();
  return graphs;
}
