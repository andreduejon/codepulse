import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isSnykScanResult } from "./parser";
import type { SnykCacheLimit, SnykScanResult } from "./types";

export const DEFAULT_SNYK_CACHE_LIMIT: SnykCacheLimit = 20;
export const DEFAULT_SNYK_CACHE_ROOT = join(homedir(), ".cache", "codepulse", "snyk");

export interface SnykCacheOptions {
  root?: string;
  maxEntries?: SnykCacheLimit;
}

async function repositoryHash(repoPath: string): Promise<string> {
  let canonicalPath = resolve(repoPath);
  try {
    canonicalPath = await realpath(canonicalPath);
  } catch {}
  return createHash("sha256").update(canonicalPath).digest("hex");
}

function assertExactSha(sha: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) throw new Error("Snyk cache requires an exact commit SHA.");
  return sha.toLowerCase();
}

export class SnykCache {
  readonly root: string;
  readonly maxEntries: SnykCacheLimit;

  constructor(options: SnykCacheOptions = {}) {
    this.root = options.root ?? DEFAULT_SNYK_CACHE_ROOT;
    this.maxEntries = options.maxEntries ?? DEFAULT_SNYK_CACHE_LIMIT;
  }

  async pathFor(repoPath: string, sha: string): Promise<string> {
    return join(this.root, await repositoryHash(repoPath), `${assertExactSha(sha)}.json`);
  }

  async read(repoPath: string, sha: string): Promise<SnykScanResult | null> {
    const path = await this.pathFor(repoPath, sha);
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isSnykScanResult(value) || value.sha.toLowerCase() !== assertExactSha(sha)) {
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

  async write(repoPath: string, result: SnykScanResult): Promise<void> {
    if (!isSnykScanResult(result)) throw new Error("Cannot cache an invalid Snyk scan result.");
    const path = await this.pathFor(repoPath, result.sha);
    const directory = dirname(path);
    const temporaryPath = join(directory, `.${result.sha}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(result)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
    await this.evict(directory);
  }

  private async evict(directory: string): Promise<void> {
    const names = (await readdir(directory)).filter(name => /^[0-9a-f]{40,64}\.json$/i.test(name));
    if (names.length <= this.maxEntries) return;
    const entries = await Promise.all(
      names.map(async name => ({ name, accessedAt: (await stat(join(directory, name))).atimeMs })),
    );
    entries.sort((left, right) => left.accessedAt - right.accessedAt || left.name.localeCompare(right.name));
    await Promise.all(
      entries.slice(0, entries.length - this.maxEntries).map(entry => rm(join(directory, entry.name), { force: true })),
    );
  }
}
