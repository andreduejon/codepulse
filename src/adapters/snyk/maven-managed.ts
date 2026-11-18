import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { type Pom, type PomSource, parsePom } from "../../core/snyk/maven-managed";

/** Reads the repository's tracked POMs on demand, once each. */
export class PomIndex implements PomSource {
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
