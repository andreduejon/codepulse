import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { RegistryLookup } from "./registry";
import type { SnykDependencyGraph, SnykDependencyPackage } from "./types";

/** One override: the package it targets, the version spec it forces, and the parent it is limited to. */
export interface OverrideRule {
  name: string;
  spec: string;
  /** `express>path-to-regexp` only applies below `express`. */
  parent?: string;
}

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, "$2");

/** A selector step's package name, without its version (`@scope/bar@<2` is `@scope/bar`). */
const stepName = (step: string) => {
  const trimmed = step.trim();
  const at = trimmed.indexOf("@", trimmed.startsWith("@") ? 1 : 0);
  return at > 0 ? trimmed.slice(0, at) : trimmed;
};

/** The package an override selector targets: the last `>` step, without its own version (`foo@1>@scope/bar@<2`). */
export function overrideTarget(selector: string): string {
  return stepName(selector.split(">").at(-1) ?? "");
}

/** The parent a selector is limited to (`foo@1>bar` is `foo`), if any. */
function overrideParent(selector: string): string | undefined {
  const steps = selector.split(">");
  return steps.length > 1 ? stepName(steps.at(-2) ?? "") : undefined;
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
    const selector = unquote(entry[1]);
    const name = overrideTarget(selector);
    const parent = overrideParent(selector);
    const spec = unquote(entry[2]);
    if (name && spec && spec !== "-") rules.push({ name, spec, ...(parent ? { parent } : {}) });
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

/** Whether a rule forced this package: same name, and a version within its range when it has one. */
const forces = (rule: OverrideRule, pkg: SnykDependencyPackage) =>
  rule.name === pkg.name && (!isRange(rule.spec) || (pkg.version !== null && satisfies(pkg.version, rule.spec)));

/** Marks the graph's packages an override forced. */
export function applyOverrideRules(graph: SnykDependencyGraph, rules: readonly OverrideRule[]): void {
  if (rules.length === 0) return;
  const root = graph.nodes.find(node => node.nodeId === graph.rootNodeId)?.pkgId;
  for (const pkg of graph.packages) {
    if (pkg.id !== root && rules.some(rule => forces(rule, pkg))) pkg.pin = "override";
  }
}

/** The highest published version a range picks, as pnpm and npm resolve it; prereleases only when asked for. */
export function highestSatisfying(versions: readonly string[], range: string): string | null {
  const prerelease = range.includes("-");
  let best: string | null = null;
  for (const version of versions) {
    if (!prerelease && version.includes("-")) continue;
    if (!satisfies(version, range)) continue;
    if (best === null || Bun.semver.order(version, best) > 0) best = version;
  }
  return best;
}

/** A package that asks for an overridden one; `manifest` is set when it is the graph's own root. */
interface OverrideParent {
  name: string;
  version: string | null;
  manifest: string | null;
}

function overrideParents(graphs: readonly SnykDependencyGraph[], rule: OverrideRule): OverrideParent[] {
  const parents = new Map<string, OverrideParent>();
  for (const graph of graphs) {
    const packages = new Map(graph.packages.map(pkg => [pkg.id, pkg]));
    const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
    for (const node of graph.nodes) {
      const parent = packages.get(node.pkgId);
      if (!parent || (rule.parent && parent.name !== rule.parent)) continue;
      const asks = node.deps.some(id => {
        const child = packages.get(nodes.get(id)?.pkgId ?? "");
        return !!child && child.pin === "override" && forces(rule, child);
      });
      if (!asks) continue;
      const root = node.nodeId === graph.rootNodeId;
      parents.set(root ? `root:${graph.targetFile}` : parent.id, {
        name: parent.name,
        version: parent.version,
        manifest: root ? graph.targetFile : null,
      });
    }
  }
  return [...parents.values()];
}

/**
 * An override is removable when every package that asks for its target would, without it, already resolve to a
 * version the override allows: the highest published version in the parent's own range satisfies the override.
 * Unknown ranges (registry unreachable, aliases, `workspace:`) keep it.
 */
async function isRemovable(
  graphs: readonly SnykDependencyGraph[],
  rule: OverrideRule,
  lookup: RegistryLookup,
  rootRanges: (manifest: string) => Promise<Readonly<Record<string, string>>>,
): Promise<boolean> {
  if (!isRange(rule.spec)) return false;
  const parents = overrideParents(graphs, rule);
  if (parents.length === 0) return false;
  const versions = await lookup.versions(rule.name);
  if (!versions) return false;
  const answers = await Promise.all(
    parents.map(async parent => {
      const range =
        parent.manifest !== null
          ? (await rootRanges(parent.manifest))[rule.name]
          : parent.version === null
            ? undefined
            : (await lookup.dependencies(parent.name, parent.version))?.[rule.name];
      if (!range || !isRange(range)) return false;
      const resolved = highestSatisfying(versions, range);
      return resolved !== null && satisfies(resolved, rule.spec);
    }),
  );
  return answers.every(Boolean);
}

/** Marks overridden packages `removable` when every rule that forced them could go. */
export async function markRemovableOverrides(
  graphs: readonly SnykDependencyGraph[],
  rules: readonly OverrideRule[],
  lookup: RegistryLookup,
  /** Ranges in a graph's own manifest (its `targetFile`), for overridden direct dependencies. */
  rootRanges: (manifest: string) => Promise<Readonly<Record<string, string>>>,
): Promise<void> {
  const pinned = graphs.flatMap(graph => graph.packages.filter(pkg => pkg.pin === "override"));
  const relevant = rules.filter(rule => pinned.some(pkg => forces(rule, pkg)));
  if (relevant.length === 0) return;
  const removable = new Map(
    await Promise.all(relevant.map(async rule => [rule, await isRemovable(graphs, rule, lookup, rootRanges)] as const)),
  );
  for (const pkg of pinned) {
    const matching = relevant.filter(rule => forces(rule, pkg));
    if (matching.length > 0 && matching.every(rule => removable.get(rule))) pkg.removable = true;
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

/** Overrides from the pnpm lockfile at or above a directory of the worktree. */
export async function pnpmOverrideRules(worktreePath: string, directory: string): Promise<OverrideRule[]> {
  const lockfile = await readPnpmLockfile(worktreePath, directory);
  return lockfile ? parsePnpmLockfileOverrides(lockfile) : [];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * npm `overrides` (Bun reads the flat form too). A nested object limits its rules to that parent, and its `.` key
 * overrides the parent itself. `$foo` takes the range the project's own manifest asks for `foo`.
 */
export function parseNpmOverrides(overrides: unknown, ranges: Readonly<Record<string, string>> = {}): OverrideRule[] {
  const rules: OverrideRule[] = [];
  const add = (name: string, spec: string, parent: string | undefined) => {
    const resolved = spec.startsWith("$") ? ranges[spec.slice(1)] : spec;
    if (name && resolved) rules.push({ name, spec: resolved, ...(parent ? { parent } : {}) });
  };
  const visit = (entries: Record<string, unknown>, parent: string | undefined) => {
    for (const [selector, value] of Object.entries(entries)) {
      if (selector === ".") continue;
      const name = stepName(selector);
      if (typeof value === "string") add(name, value, parent);
      else if (isRecord(value)) {
        if (typeof value["."] === "string") add(name, value["."], parent);
        visit(value, name);
      }
    }
  };
  if (isRecord(overrides)) visit(overrides, undefined);
  return rules;
}

/** Yarn `resolutions` (Bun reads them too): `foo`, `bar/foo`, `foo@npm:^1`, and `**` steps for any depth. */
export function parseYarnResolutions(resolutions: unknown): OverrideRule[] {
  if (!isRecord(resolutions)) return [];
  const rules: OverrideRule[] = [];
  for (const [selector, spec] of Object.entries(resolutions)) {
    if (typeof spec !== "string" || !spec) continue;
    const parts = selector.split("/");
    const steps: string[] = [];
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index] ?? "";
      steps.push(part.startsWith("@") && index + 1 < parts.length ? `${part}/${parts[++index]}` : part);
    }
    const name = stepName(steps.at(-1) ?? "");
    const before = steps.at(-2);
    // `bar/**/foo` reaches `foo` at any depth below `bar`, so it names no direct parent.
    const parent = before && before !== "**" ? stepName(before) : undefined;
    if (name) rules.push({ name, spec, ...(parent ? { parent } : {}) });
  }
  return rules;
}

async function readManifest(worktreePath: string, directory: string): Promise<Record<string, unknown> | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(worktreePath, directory, "package.json"), "utf8"));
    return isRecord(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

function rangesOf(manifest: Record<string, unknown>): Record<string, string> {
  const ranges: Record<string, string> = {};
  for (const field of ["optionalDependencies", "devDependencies", "dependencies"]) {
    const value = manifest[field];
    if (!isRecord(value)) continue;
    for (const [name, range] of Object.entries(value)) if (typeof range === "string") ranges[name] = range;
  }
  return ranges;
}

/** Ranges the project's own `package.json` asks for (all dependency fields). */
export async function manifestRanges(worktreePath: string, directory: string): Promise<Record<string, string>> {
  const manifest = await readManifest(worktreePath, directory);
  return manifest ? rangesOf(manifest) : {};
}

/**
 * The overrides a project's package manager applies: pnpm's lockfile records them; npm reads `overrides`, Yarn
 * `resolutions` and Bun both, from the `package.json` beside the lockfile (workspace packages' own are ignored).
 */
export async function projectOverrideRules(
  worktreePath: string,
  project: { targetFile: string; packageManager: string },
): Promise<OverrideRule[]> {
  const directory = posix.dirname(project.targetFile);
  const { packageManager } = project;
  if (packageManager === "pnpm") return pnpmOverrideRules(worktreePath, directory);
  if (packageManager !== "npm" && packageManager !== "yarn" && packageManager !== "bun") return [];
  const manifest = await readManifest(worktreePath, directory);
  if (!manifest) return [];
  return [
    ...(packageManager === "yarn" ? [] : parseNpmOverrides(manifest.overrides, rangesOf(manifest))),
    ...(packageManager === "npm" ? [] : parseYarnResolutions(manifest.resolutions)),
  ];
}
