import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { SnykDependencyGraph } from "./types";

/** One override: the package it targets and the version spec it forces. */
export interface OverrideRule {
  name: string;
  spec: string;
}

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, "$2");

/** The package an override selector targets: the last `>` step, without its own version (`foo@1>@scope/bar@<2`). */
export function overrideTarget(selector: string): string {
  const last = selector.split(">").at(-1)?.trim() ?? "";
  const at = last.indexOf("@", last.startsWith("@") ? 1 : 0);
  return at > 0 ? last.slice(0, at) : last;
}

/**
 * The `overrides:` section of `pnpm-lock.yaml`: what pnpm applied, whether set in `pnpm-workspace.yaml` or
 * `package.json`. Read line by line, so a lockfile of any size needs no YAML parse.
 */
export function parsePnpmLockfileOverrides(lockfile: string): OverrideRule[] {
  const rules: OverrideRule[] = [];
  let inside = false;
  for (const line of lockfile.split(/\r?\n/)) {
    if (!line.startsWith(" ")) {
      inside = line.trimEnd() === "overrides:";
      continue;
    }
    if (!inside) continue;
    const entry = /^ {2}(\S.*?):\s+(.+)$/.exec(line.trimEnd());
    if (!entry) continue;
    const name = overrideTarget(unquote(entry[1]));
    const spec = unquote(entry[2]);
    if (name && spec && spec !== "-") rules.push({ name, spec });
  }
  return rules;
}

/** Specs pnpm/npm resolve as semver ranges; aliases (`npm:`), references (`$foo`) and protocols match by name. */
const isRange = (spec: string) => /^[\s^~<>=\d*xX]/.test(spec);

const satisfies = (version: string, spec: string) => {
  try {
    return Bun.semver.satisfies(version, spec);
  } catch {
    return false;
  }
};

/** Marks the graph's packages an override forced: same name, and a version within its range when it has one. */
export function applyOverrideRules(graph: SnykDependencyGraph, rules: readonly OverrideRule[]): void {
  if (rules.length === 0) return;
  const root = graph.nodes.find(node => node.nodeId === graph.rootNodeId)?.pkgId;
  for (const pkg of graph.packages) {
    if (pkg.id === root) continue;
    const forced = rules.some(
      rule =>
        rule.name === pkg.name && (!isRange(rule.spec) || (pkg.version !== null && satisfies(pkg.version, rule.spec))),
    );
    if (forced) pkg.pin = "override";
  }
}

/** The closest `pnpm-lock.yaml` at or above the graph's directory, inside the worktree. */
async function readPnpmLockfile(worktreePath: string, directory: string): Promise<string | null> {
  for (let current = directory; ; current = posix.dirname(current)) {
    const text = await readFile(join(worktreePath, current, "pnpm-lock.yaml"), "utf8").catch(() => null);
    if (text !== null) return text;
    if (current === ".") return null;
  }
}

/** Marks overridden packages from the lockfile beside the graph (pnpm). */
export async function applyLockfileOverrides(graph: SnykDependencyGraph, worktreePath: string): Promise<void> {
  if (graph.packageManager !== "pnpm") return;
  const lockfile = await readPnpmLockfile(worktreePath, posix.dirname(graph.targetFile));
  if (lockfile) applyOverrideRules(graph, parsePnpmLockfileOverrides(lockfile));
}
