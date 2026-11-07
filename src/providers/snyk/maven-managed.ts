import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { SnykDependencyGraph } from "./types";

/** An XML element with its child elements and its own text; enough for a POM, which has no mixed content. */
export interface XmlElement {
  name: string;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) =>
    code.startsWith("#x") || code.startsWith("#X")
      ? String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      : code.startsWith("#")
        ? String.fromCodePoint(Number(code.slice(1)))
        : (ENTITIES[code] ?? entity),
  );

/** The document's root element; tolerant of anything a POM won't contain (attributes and namespaces are dropped). */
export function parseXml(text: string): XmlElement | null {
  const document: XmlElement = { name: "", children: [], text: "" };
  const stack = [document];
  const tokens =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)[^>]*?(\/?)>|([^<]+)/g;
  for (const [, cdata, closing, opening, selfClosing, content] of text.matchAll(tokens)) {
    const current = stack.at(-1) ?? document;
    if (cdata !== undefined) current.text += cdata;
    else if (content !== undefined) current.text += decode(content);
    else if (closing !== undefined) {
      const open = stack.findLastIndex(element => element.name === closing);
      if (open > 0) stack.length = open;
    } else if (opening !== undefined) {
      const element: XmlElement = { name: opening.replace(/^[\w.-]+:/, ""), children: [], text: "" };
      current.children.push(element);
      if (!selfClosing) stack.push(element);
    }
  }
  return document.children[0] ?? null;
}

const child = (element: XmlElement | undefined, name: string) => element?.children.find(item => item.name === name);
const childText = (element: XmlElement | undefined, name: string) => {
  const found = child(element, name);
  return found ? found.text.trim() : undefined;
};

interface ManagedEntry {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  type?: string;
}

interface Pom {
  path: string;
  groupId?: string;
  artifactId?: string;
  version?: string;
  parent?: { groupId?: string; artifactId?: string; version?: string; relativePath: string | null };
  properties: Record<string, string>;
  managed: ManagedEntry[];
}

export function parsePom(path: string, text: string): Pom | null {
  const project = parseXml(text);
  if (project?.name !== "project") return null;
  const parent = child(project, "parent");
  const relativePath = childText(parent, "relativePath");
  const properties: Record<string, string> = {};
  for (const property of child(project, "properties")?.children ?? []) properties[property.name] = property.text.trim();
  const managed = (child(child(project, "dependencyManagement"), "dependencies")?.children ?? [])
    .filter(item => item.name === "dependency")
    .flatMap((dependency): ManagedEntry[] => {
      const groupId = childText(dependency, "groupId");
      const artifactId = childText(dependency, "artifactId");
      if (!groupId || !artifactId) return [];
      const fields = (["version", "scope", "type"] as const).flatMap(field => {
        const value = childText(dependency, field);
        return value ? [[field, value] as const] : [];
      });
      return [{ groupId, artifactId, ...Object.fromEntries(fields) }];
    });
  return {
    path,
    groupId: childText(project, "groupId"),
    artifactId: childText(project, "artifactId"),
    version: childText(project, "version"),
    ...(parent
      ? {
          parent: {
            groupId: childText(parent, "groupId"),
            artifactId: childText(parent, "artifactId"),
            version: childText(parent, "version"),
            // An empty `<relativePath/>` turns the local lookup off; a missing one means `../pom.xml`.
            relativePath: relativePath === undefined ? "../pom.xml" : relativePath || null,
          },
        }
      : {}),
    properties,
    managed,
  };
}

const MAX_DEPTH = 10;

/** Reads the repository's tracked POMs on demand, once each. */
export class PomIndex {
  private readonly cache = new Map<string, Promise<Pom | null>>();

  constructor(
    private readonly worktreePath: string,
    /** Tracked `pom.xml` paths, relative to the worktree; nothing else is read. */
    private readonly paths: readonly string[],
  ) {}

  read(path: string): Promise<Pom | null> {
    let pom = this.cache.get(path);
    if (!pom) {
      pom = this.paths.includes(path)
        ? readFile(join(this.worktreePath, path), "utf8").then(
            text => parsePom(path, text),
            () => null,
          )
        : Promise.resolve(null);
      this.cache.set(path, pom);
    }
    return pom;
  }

  /** An in-repo POM by coordinates; the version only has to match when both sides name one. */
  async find(groupId: string, artifactId: string, version?: string): Promise<Pom | null> {
    for (const path of this.paths) {
      const pom = await this.read(path);
      if (!pom || pom.artifactId !== artifactId) continue;
      if ((pom.groupId ?? pom.parent?.groupId) !== groupId) continue;
      const own = pom.version ?? pom.parent?.version;
      if (version && own && version !== own) continue;
      return pom;
    }
    return null;
  }

  /** The parent at `relativePath` when its coordinates match, otherwise the in-repo POM with those coordinates. */
  async parentOf(pom: Pom): Promise<Pom | null> {
    const parent = pom.parent;
    if (!parent?.groupId || !parent.artifactId) return null;
    if (parent.relativePath !== null) {
      let path = posix.normalize(posix.join(posix.dirname(pom.path), parent.relativePath));
      if (!path.endsWith(".xml")) path = posix.join(path, "pom.xml");
      const local = path.startsWith("../") ? null : await this.read(path);
      if (
        local &&
        local.artifactId === parent.artifactId &&
        (local.groupId ?? local.parent?.groupId) === parent.groupId
      )
        return local;
    }
    return this.find(parent.groupId, parent.artifactId, parent.version);
  }
}

/** A POM and its in-repo ancestors, the POM itself first. */
async function lineage(index: PomIndex, pom: Pom): Promise<Pom[]> {
  const chain = [pom];
  for (let current = pom; chain.length < MAX_DEPTH; ) {
    const parent = await index.parentOf(current);
    if (!parent || chain.includes(parent)) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

const PLACEHOLDER = /\$\{([^}]+)\}/g;

function interpolate(value: string, properties: Readonly<Record<string, string>>): string {
  let result = value;
  for (let round = 0; round < MAX_DEPTH && result.includes("${"); round++) {
    const next = result.replace(PLACEHOLDER, (placeholder, name: string) => properties[name] ?? placeholder);
    if (next === result) break;
    result = next;
  }
  return result;
}

/** Properties as Maven sees them in this POM: ancestors' first, then its own, then `project.*`. */
function effectiveProperties(chain: readonly Pom[]): Record<string, string> {
  const [pom] = chain;
  const properties: Record<string, string> = {};
  for (const ancestor of [...chain].reverse()) Object.assign(properties, ancestor.properties);
  const version = pom?.version ?? pom?.parent?.version;
  const groupId = pom?.groupId ?? pom?.parent?.groupId;
  const builtIns: Record<string, string | undefined> = {
    "project.version": version,
    "pom.version": version,
    version,
    "project.groupId": groupId,
    "pom.groupId": groupId,
    "project.artifactId": pom?.artifactId,
    "project.parent.version": pom?.parent?.version,
    "project.parent.groupId": pom?.parent?.groupId,
  };
  for (const [name, value] of Object.entries(builtIns)) if (value !== undefined) properties[name] = value;
  return properties;
}

/** `null` when the version is unknown: an unresolved property, a range, or none at all. */
export type ManagedVersions = Map<string, string | null>;

const resolvedVersion = (version: string | undefined) =>
  version && !version.includes("${") && !/^[[(]/.test(version) ? version : null;

/**
 * What a POM's effective `<dependencyManagement>` pins, keyed `groupId:artifactId`: its own entries, then its
 * in-repo parents', then in-repo BOMs it imports. Parents' entries are interpolated with this POM's properties, as
 * Maven inherits before it interpolates; a BOM uses its own.
 */
export async function mavenManagedVersions(index: PomIndex, path: string, depth = 0): Promise<ManagedVersions> {
  const managed: ManagedVersions = new Map();
  const pom = await index.read(path);
  if (!pom || depth >= MAX_DEPTH) return managed;
  const chain = await lineage(index, pom);
  const properties = effectiveProperties(chain);
  const imports: ManagedEntry[] = [];
  for (const ancestor of chain) {
    for (const entry of ancestor.managed) {
      const groupId = interpolate(entry.groupId, properties);
      const artifactId = interpolate(entry.artifactId, properties);
      const version = entry.version === undefined ? undefined : interpolate(entry.version, properties);
      if (entry.scope === "import" && entry.type === "pom") imports.push({ groupId, artifactId, version });
      else {
        const key = `${groupId}:${artifactId}`;
        if (!managed.has(key)) managed.set(key, resolvedVersion(version));
      }
    }
  }
  for (const bom of imports) {
    const found = await index.find(bom.groupId, bom.artifactId, resolvedVersion(bom.version) ?? undefined);
    if (!found) continue;
    for (const [key, version] of await mavenManagedVersions(index, found.path, depth + 1))
      if (!managed.has(key)) managed.set(key, version);
  }
  return managed;
}

/**
 * Marks packages `managed` that reach the graph through another dependency and are pinned by `<dependencyManagement>`;
 * a pin whose version is known must match the version Snyk resolved.
 */
export function applyMavenManaged(graph: SnykDependencyGraph, managed: ManagedVersions): void {
  if (managed.size === 0) return;
  const root = graph.nodes.find(node => node.nodeId === graph.rootNodeId);
  const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
  const transitive = new Set<string>();
  for (const node of graph.nodes) {
    if (node === root) continue;
    for (const id of node.deps) {
      const pkgId = nodes.get(id)?.pkgId;
      if (pkgId) transitive.add(pkgId);
    }
  }
  for (const pkg of graph.packages) {
    if (pkg.id === root?.pkgId || !transitive.has(pkg.id) || !managed.has(pkg.name)) continue;
    const version = managed.get(pkg.name);
    if (version === null || version === undefined || version === pkg.version) pkg.pin = "managed";
  }
}
