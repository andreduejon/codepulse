import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_PROVIDER_LIMIT, type ProviderLimit } from "./auto-refresh";

async function repositoryHash(repoPath: string): Promise<string> {
  let canonicalPath = resolve(repoPath);
  try {
    canonicalPath = await realpath(canonicalPath);
  } catch {}
  return createHash("sha256").update(canonicalPath).digest("hex");
}

export function assertExactSha(sha: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) throw new Error("Provider cache requires an exact commit SHA.");
  return sha.toLowerCase();
}

export function mergeById<T extends { id: string | number }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string | number, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export interface ShaJsonCacheOptions<T> {
  root: string;
  maxEntries?: ProviderLimit;
  isEntry: (value: unknown) => value is T;
  invalidMessage: string;
}

export class ShaJsonCache<T extends { sha: string }> {
  readonly root: string;
  readonly maxEntries: ProviderLimit;
  private readonly isEntry: (value: unknown) => value is T;
  private readonly invalidMessage: string;

  constructor(options: ShaJsonCacheOptions<T>) {
    this.root = options.root;
    this.maxEntries = options.maxEntries ?? DEFAULT_PROVIDER_LIMIT;
    this.isEntry = options.isEntry;
    this.invalidMessage = options.invalidMessage;
  }

  async repoDir(repoPath: string): Promise<string> {
    return join(this.root, await repositoryHash(repoPath));
  }

  async list(repoPath: string): Promise<string[]> {
    try {
      const names = await readdir(await this.repoDir(repoPath));
      return names
        .filter(name => /^[0-9a-f]{40,64}\.json$/i.test(name))
        .map(name => name.replace(/\.json$/i, "").toLowerCase());
    } catch {
      return [];
    }
  }

  async pathFor(repoPath: string, sha: string): Promise<string> {
    return join(await this.repoDir(repoPath), `${assertExactSha(sha)}.json`);
  }

  logPath(repoDir: string, sha: string, key: string): string {
    return join(repoDir, "logs", `${assertExactSha(sha)}_${safeLogKey(key)}.txt`);
  }

  async readLog(repoPath: string, sha: string, key: string): Promise<string | null> {
    try {
      return await readFile(this.logPath(await this.repoDir(repoPath), sha, key), "utf8");
    } catch {
      return null;
    }
  }

  async writeLog(repoPath: string, sha: string, key: string, log: string): Promise<void> {
    if (!log) return;
    const repoDir = await this.repoDir(repoPath);
    const path = this.logPath(repoDir, sha, key);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, log, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  async read(repoPath: string, sha: string): Promise<T | null> {
    const path = await this.pathFor(repoPath, sha);
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!this.isEntry(value) || value.sha.toLowerCase() !== assertExactSha(sha)) {
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

  async write(repoPath: string, entry: T, options?: { evict?: boolean }): Promise<void> {
    if (!this.isEntry(entry)) throw new Error(this.invalidMessage);
    const sha = assertExactSha(entry.sha);
    const path = await this.pathFor(repoPath, sha);
    const directory = dirname(path);
    const temporaryPath = join(directory, `.${sha}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ ...entry, sha })}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
    if (options?.evict !== false) await this.evict(directory);
  }

  async evictForRepo(repoPath: string): Promise<void> {
    try {
      await this.evict(await this.repoDir(repoPath));
    } catch {
      return;
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

export function safeLogKey(key: string): string {
  if (/^[a-zA-Z0-9._-]+$/.test(key) && key.length <= 80) return key;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
