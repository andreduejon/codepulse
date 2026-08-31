import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { OpenShiftCacheLimit, OpenShiftResource, OpenShiftStatus } from "./types";

export const DEFAULT_OPENSHIFT_CACHE_LIMIT: OpenShiftCacheLimit = 20;
export const DEFAULT_OPENSHIFT_CACHE_ROOT = join(homedir(), ".cache", "codepulse", "openshift");

export interface OpenShiftCachedBuild {
  id: string;
  name: string;
  namespace: string;
  uid?: string;
  status: OpenShiftStatus;
  imageRefs: string[];
  commitSha: string;
  updatedAt?: string | null;
  object?: unknown;
}

export interface OpenShiftCacheEntry {
  sha: string;
  builds: OpenShiftCachedBuild[];
}

export interface OpenShiftCacheOptions {
  root?: string;
  maxEntries?: OpenShiftCacheLimit;
}

async function repositoryHash(repoPath: string): Promise<string> {
  let canonicalPath = resolve(repoPath);
  try {
    canonicalPath = await realpath(canonicalPath);
  } catch {}
  return createHash("sha256").update(canonicalPath).digest("hex");
}

function assertExactSha(sha: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) throw new Error("OpenShift cache requires an exact commit SHA.");
  return sha.toLowerCase();
}

const STATUSES = new Set<OpenShiftStatus>(["pass", "fail", "running", "unknown"]);

export function isOpenShiftCacheEntry(value: unknown): value is OpenShiftCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as OpenShiftCacheEntry;
  if (typeof entry.sha !== "string" || !Array.isArray(entry.builds)) return false;
  return entry.builds.every(
    build =>
      typeof build === "object" &&
      build !== null &&
      typeof build.id === "string" &&
      typeof build.name === "string" &&
      typeof build.namespace === "string" &&
      typeof build.commitSha === "string" &&
      STATUSES.has(build.status) &&
      Array.isArray(build.imageRefs) &&
      build.imageRefs.every(ref => typeof ref === "string"),
  );
}

export function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function toCachedBuild(resource: OpenShiftResource): OpenShiftCachedBuild | null {
  if (resource.kind !== "Build" || !resource.commitSha) return null;
  return {
    id: resource.id,
    name: resource.name,
    namespace: resource.namespace,
    uid: resource.uid,
    status: resource.status,
    imageRefs: resource.imageRefs,
    commitSha: resource.commitSha,
    updatedAt: resource.updatedAt ?? null,
    object: resource.object,
  };
}

export function cachedBuildToResource(build: OpenShiftCachedBuild): OpenShiftResource {
  return {
    id: build.id,
    kind: "Build",
    namespace: build.namespace,
    name: build.name,
    status: build.status,
    imageRefs: build.imageRefs,
    commitSha: build.commitSha,
    uid: build.uid,
    updatedAt: build.updatedAt ?? null,
    object: build.object,
  };
}

export class OpenShiftCache {
  readonly root: string;
  readonly maxEntries: OpenShiftCacheLimit;

  constructor(options: OpenShiftCacheOptions = {}) {
    this.root = options.root ?? DEFAULT_OPENSHIFT_CACHE_ROOT;
    this.maxEntries = options.maxEntries ?? DEFAULT_OPENSHIFT_CACHE_LIMIT;
  }

  async repoDir(repoPath: string): Promise<string> {
    return join(this.root, await repositoryHash(repoPath));
  }

  async list(repoPath: string): Promise<string[]> {
    try {
      const names = await readdir(await this.repoDir(repoPath));
      return names.filter(name => /^[0-9a-f]{40,64}\.json$/i.test(name)).map(name => name.replace(/\.json$/i, "").toLowerCase());
    } catch {
      return [];
    }
  }

  async pathFor(repoPath: string, sha: string): Promise<string> {
    return join(await this.repoDir(repoPath), `${assertExactSha(sha)}.json`);
  }

  logPath(repoDir: string, sha: string, namespace: string, buildName: string): string {
    return join(repoDir, "logs", `${assertExactSha(sha)}_${namespace}_${buildName}.txt`);
  }

  async read(repoPath: string, sha: string): Promise<OpenShiftCacheEntry | null> {
    const path = await this.pathFor(repoPath, sha);
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isOpenShiftCacheEntry(value) || value.sha.toLowerCase() !== assertExactSha(sha)) {
        await rm(path, { force: true });
        return null;
      }
      const now = new Date();
      await utimes(path, now, now).catch(() => {});
      return value;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "ENOENT") await rm(path, { force: true }).catch(() => {});
      return null;
    }
  }

  async write(repoPath: string, entry: OpenShiftCacheEntry): Promise<void> {
    if (!isOpenShiftCacheEntry(entry)) throw new Error("Cannot cache an invalid OpenShift build snapshot.");
    const path = await this.pathFor(repoPath, entry.sha);
    const directory = dirname(path);
    const temporaryPath = join(directory, `.${entry.sha}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ ...entry, sha: entry.sha.toLowerCase() })}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
    await this.evict(directory);
  }

  async readLog(repoPath: string, sha: string, namespace: string, buildName: string): Promise<string | null> {
    try {
      return await readFile(this.logPath(await this.repoDir(repoPath), sha, namespace, buildName), "utf8");
    } catch {
      return null;
    }
  }

  async writeLog(repoPath: string, sha: string, namespace: string, buildName: string, log: string): Promise<void> {
    const repoDir = await this.repoDir(repoPath);
    const path = this.logPath(repoDir, sha, namespace, buildName);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, log, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  private async evict(directory: string): Promise<void> {
    const names = (await readdir(directory)).filter(name => /^[0-9a-f]{40,64}\.json$/i.test(name));
    if (names.length <= this.maxEntries) return;
    const entries = await Promise.all(
      names.map(async name => ({ name, accessedAt: (await stat(join(directory, name))).atimeMs })),
    );
    entries.sort((left, right) => left.accessedAt - right.accessedAt || left.name.localeCompare(right.name));
    const removed = entries.slice(0, entries.length - this.maxEntries);
    await Promise.all(
      removed.map(async entry => {
        const sha = entry.name.replace(/\.json$/i, "");
        await rm(join(directory, entry.name), { force: true });
        const logsDir = join(directory, "logs");
        try {
          const logs = await readdir(logsDir);
          await Promise.all(
            logs.filter(name => name.startsWith(`${sha}_`)).map(name => rm(join(logsDir, name), { force: true })),
          );
        } catch {}
      }),
    );
  }
}
