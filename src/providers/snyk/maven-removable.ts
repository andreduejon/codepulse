import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SnykDependencyGraph, SnykDependencyPackage } from "../../core/snyk/types";
import {
  effectiveProperties,
  interpolate,
  lineage,
  type ManagedVersions,
  mavenManagedVersions,
  type Pom,
  type PomSource,
  parsePom,
  parseXml,
  resolvedVersion,
} from "./maven-managed";

/**
 * Maven `removable`: a `<dependencyManagement>` pin of a package that every dependency bringing it already asks for at
 * the pinned version or later, so Maven would pick at least that version without the pin. Their POMs come from the
 * local Maven repository, where Maven put them while Snyk resolved the tree; nothing is downloaded, and a POM that
 * is not there keeps the pin.
 */

type Item = number | string;

/** Release qualifiers in Maven's order; a plain release is "", and unknown words sort after `sp`. */
const QUALIFIERS = ["alpha", "beta", "milestone", "rc", "snapshot", "", "sp"];
const ALIASES: Record<string, string> = {
  a: "alpha",
  b: "beta",
  m: "milestone",
  cr: "rc",
  ga: "",
  final: "",
  release: "",
};

function versionItems(version: string): Item[] {
  const items: Item[] = [];
  for (const token of version.toLowerCase().match(/\d+|[a-z]+/g) ?? [])
    items.push(/^\d/.test(token) ? Number(token) : (ALIASES[token] ?? token));
  // `1.0`, `1.0.0` and `1.0.Final` are the same version.
  while (items.length > 0 && (items.at(-1) === 0 || items.at(-1) === "")) items.pop();
  return items;
}

const qualifierRank = (word: string) => {
  const rank = QUALIFIERS.indexOf(word);
  return rank >= 0 ? rank : QUALIFIERS.length;
};

/** One position: a missing item counts as 0 against a number and as a release against a qualifier. */
function compareItems(a: Item | undefined, b: Item | undefined): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return b === undefined ? a : 1;
  if (typeof b === "number") return a === undefined ? -b : -1;
  const left = a ?? "";
  const right = b ?? "";
  return qualifierRank(left) - qualifierRank(right) || (left < right ? -1 : left > right ? 1 : 0);
}

/** Maven's version order, close enough for pins: numbers by value, `-alpha` … `-SNAPSHOT` before the release. */
export function compareMavenVersions(a: string, b: string): number {
  const left = versionItems(a);
  const right = versionItems(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const order = compareItems(left[index], right[index]);
    if (order !== 0) return Math.sign(order);
  }
  return 0;
}

/**
 * Whether `compareMavenVersions` orders this version as Maven does, for sure: plain numbers only (`1.86`, `2.13.4`).
 * Maven trims zeros before a qualifier and nests what follows a `-` (`1.0-rc` > `1.0.0-beta`, `1.0-1` < `1.0.1`),
 * which this comparison doesn't; a pin with any such version stays, as does one with a number part too long to compare
 * exactly (over 15 digits).
 */
export const mavenOrderIsClear = (version: string): boolean => /^\d{1,15}(\.\d{1,15})*$/.test(version.trim());

const REPO_LOCAL = /-Dmaven\.repo\.local=("[^"]*"|\S+)/;
const repoLocal = (text: string | undefined) => text?.match(REPO_LOCAL)?.[1]?.replace(/^"|"$/g, "") || null;

/**
 * The local Maven repository: `-Dmaven.repo.local` in the project's `.mvn/maven.config` or in `MAVEN_OPTS`, else
 * `<localRepository>` in `~/.m2/settings.xml`, else `~/.m2/repository`.
 */
export async function mavenLocalRepository(
  opts: Readonly<{ home: string; env: Readonly<Record<string, string | undefined>>; worktree: string }>,
): Promise<string> {
  const config = await readFile(join(opts.worktree, ".mvn", "maven.config"), "utf8").catch(() => undefined);
  const local = repoLocal(config) ?? repoLocal(opts.env.MAVEN_OPTS);
  if (local) return resolve(opts.worktree, local);
  const settings = await readFile(join(opts.home, ".m2", "settings.xml"), "utf8").catch(() => null);
  const configured =
    settings &&
    parseXml(settings)
      ?.children.find(item => item.name === "localRepository")
      ?.text.trim();
  if (configured) {
    const path = configured.replace(
      /\$\{(user\.home|env\.([^}]+))\}/g,
      (placeholder, name: string, variable?: string) =>
        name === "user.home" ? opts.home : (opts.env[variable ?? ""] ?? placeholder),
    );
    if (!path.includes("${")) return resolve(opts.home, path);
  }
  return join(opts.home, ".m2", "repository");
}

/** A coordinate is one path segment of a repository's layout (dots in a groupId become folders). */
const SEGMENT = /^(?!\.{1,2}$)[\w.+~-]+$/;

/** POMs in a local Maven repository's layout, read once each. A POM's `path` is its file. */
export class LocalRepositoryPoms implements PomSource {
  private readonly cache = new Map<string, Promise<Pom | null>>();

  constructor(private readonly root: string) {}

  read(path: string): Promise<Pom | null> {
    let pom = this.cache.get(path);
    if (!pom) {
      pom = readFile(path, "utf8").then(
        text => parsePom(path, text),
        () => null,
      );
      this.cache.set(path, pom);
    }
    return pom;
  }

  async find(groupId: string, artifactId: string, version?: string): Promise<Pom | null> {
    if (!version || ![...groupId.split("."), artifactId, version].every(part => SEGMENT.test(part))) return null;
    return this.read(join(this.root, ...groupId.split("."), artifactId, version, `${artifactId}-${version}.pom`));
  }

  async parentOf(pom: Pom): Promise<Pom | null> {
    const parent = pom.parent;
    return parent?.groupId && parent.artifactId ? this.find(parent.groupId, parent.artifactId, parent.version) : null;
  }
}

/** The version a dependency's POM asks for `target` (`groupId:artifactId`) at, or null when it cannot be told. */
async function askedVersion(poms: PomSource, parent: SnykDependencyPackage, target: string): Promise<string | null> {
  const [groupId, artifactId] = parent.name.split(":");
  if (!groupId || !artifactId || !parent.version) return null;
  const pom = await poms.find(groupId, artifactId, parent.version);
  if (!pom) return null;
  const chain = await lineage(poms, pom);
  const properties = effectiveProperties(chain);
  const declared = chain.flatMap(ancestor =>
    ancestor.dependencies.filter(
      entry => `${interpolate(entry.groupId, properties)}:${interpolate(entry.artifactId, properties)}` === target,
    ),
  );
  // A variant of the artifact (a test jar, a classifier) is another artifact the graph can't tell apart: unknown.
  const variant = (entry: (typeof declared)[number]) =>
    !!entry.classifier || (entry.type !== undefined && interpolate(entry.type, properties) !== "jar");
  if (declared.some(variant)) return null;
  const entry = declared[0];
  if (!entry) return null;
  if (entry.version !== undefined) return resolvedVersion(interpolate(entry.version, properties));
  return (await mavenManagedVersions(poms, pom.path)).get(target) ?? null;
}

/**
 * Marks `managed` packages `removable` when every package that brings them asks for the pinned version or later.
 * Maven takes the nearest declaration without the pin, so any of them gives at least that version. A direct
 * dependency keeps its pin (the pin may give it its version), and so does a pin whose version is unknown.
 */
export async function markRemovableManaged(
  graph: SnykDependencyGraph,
  managed: ManagedVersions,
  poms: PomSource,
): Promise<void> {
  const packages = new Map(graph.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
  const root = nodes.get(graph.rootNodeId);
  const packageOf = (nodeId: string) => packages.get(nodes.get(nodeId)?.pkgId ?? "");
  await Promise.all(
    graph.packages.map(async pkg => {
      const pinned = managed.get(pkg.name);
      if (pkg.pin !== "managed" || !pinned) return;
      if (root?.deps.some(id => packageOf(id) === pkg)) return;
      const parents = new Map<string, SnykDependencyPackage>();
      for (const node of graph.nodes) {
        const parent = packages.get(node.pkgId);
        if (node !== root && parent && node.deps.some(id => packageOf(id) === pkg)) parents.set(parent.id, parent);
      }
      if (parents.size === 0) return;
      const asked = await Promise.all([...parents.values()].map(parent => askedVersion(poms, parent, pkg.name)));
      // Only when the order is sure: a pin kept by doubt is safe, one removed by mistake is not.
      const later = (version: string | null) =>
        version !== null &&
        mavenOrderIsClear(version) &&
        mavenOrderIsClear(pinned) &&
        compareMavenVersions(version, pinned) >= 0;
      if (asked.every(later)) pkg.removable = true;
    }),
  );
}
