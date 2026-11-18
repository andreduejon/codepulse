import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Pom, type PomSource, parsePom, parseXml } from "../../core/snyk/maven-managed";

/**
 * The POMs Maven's `removable` rule (core/snyk/maven-removable.ts) reads: from the local Maven repository, where Maven
 * put them while Snyk resolved the tree. Nothing is downloaded, and a POM that is not there keeps the pin.
 */

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
