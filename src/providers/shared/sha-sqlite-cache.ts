import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { addDebugEvent, redactDebugValue } from "../../debug/events";
import { storageRoot } from "../../utils/storage-path";
import { DEFAULT_PROVIDER_CACHE_LIMIT, type ProviderCacheLimit } from "./auto-refresh";

export const DEFAULT_PROVIDER_CACHE_ROOT = storageRoot("cache");
const databases = new Map<string, Database>();
const unavailableRoots = new Set<string>();
const reportedErrors = new Map<string, string>();
const writesBlockedUntil = new Map<string, number>();
const suspendedRoots = new Set<string>();
const writeEpochs = new Map<string, number>();

export function invalidateProviderCacheWrites(root = DEFAULT_PROVIDER_CACHE_ROOT): void {
  const directory = resolve(root);
  writeEpochs.set(directory, (writeEpochs.get(directory) ?? 0) + 1);
}

export function setProviderCacheSuspended(suspended: boolean, root = DEFAULT_PROVIDER_CACHE_ROOT): void {
  const directory = resolve(root);
  if (suspended && !suspendedRoots.has(directory)) {
    invalidateProviderCacheWrites(directory);
    suspendedRoots.add(directory);
  } else if (!suspended) suspendedRoots.delete(directory);
}

function isCacheBusy(error: unknown): boolean {
  return !!(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    (error.code.startsWith("SQLITE_BUSY") || error.code.startsWith("SQLITE_LOCKED"))
  );
}

function reportCacheError(root: string, error: unknown): void {
  if (isCacheBusy(error)) writesBlockedUntil.set(root, Date.now() + 1_000);
  const message = redactDebugValue(error instanceof Error ? error.message : String(error));
  if (reportedErrors.get(root) === message) return;
  reportedErrors.set(root, message);
  addDebugEvent({ source: "error", status: "error", message: `Provider cache: ${message}` });
}

export function providerCacheDatabase(root = DEFAULT_PROVIDER_CACHE_ROOT): Database {
  const directory = resolve(root);
  const cached = databases.get(directory);
  if (cached) return cached;
  if (unavailableRoots.has(directory)) throw new Error("Provider cache unavailable for this session.");
  if (Date.now() < (writesBlockedUntil.get(directory) ?? 0)) throw new Error("Provider cache temporarily busy.");
  let db: Database | undefined;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "cache.sqlite");
    closeSync(openSync(path, "a", 0o600));
    if (process.platform !== "win32") chmodSync(path, 0o600);
    db = new Database(path, { strict: true });
    db.exec("PRAGMA busy_timeout = 100; PRAGMA foreign_keys = ON;");
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1 && version !== 2)
      throw new Error(`Unsupported provider cache schema version: ${version}`);
    db.exec("PRAGMA journal_mode = WAL;");
    db.transaction(() => {
      const currentVersion = db?.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
      if (currentVersion !== 0 && currentVersion !== 1 && currentVersion !== 2)
        throw new Error(`Unsupported provider cache schema version: ${currentVersion}`);
      // Unreleased v1 cache is disposable, so rebuild instead of migrating it.
      if (currentVersion === 1) db?.exec("DROP TABLE snapshots;");
      db?.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL,
          repo_hash TEXT NOT NULL,
          repo_path TEXT NOT NULL,
          sha TEXT NOT NULL,
          payload TEXT NOT NULL CHECK (json_valid(payload)),
          accessed_at INTEGER NOT NULL,
          cleanup_reset_at INTEGER NOT NULL DEFAULT 0,
          UNIQUE (provider, repo_hash, sha)
        );
        CREATE TABLE IF NOT EXISTS artifacts (
          snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          artifact_key TEXT NOT NULL,
          content TEXT NOT NULL CHECK (kind != 'json' OR json_valid(content)),
          PRIMARY KEY (snapshot_id, kind, artifact_key)
        );
        PRAGMA user_version = 2;
      `);
    }).immediate();
    databases.set(directory, db);
    return db;
  } catch (error) {
    db?.close();
    if (!isCacheBusy(error)) unavailableRoots.add(directory);
    reportCacheError(directory, error);
    throw error;
  }
}

export function closeProviderCaches(root?: string): void {
  const roots =
    root === undefined
      ? [
          ...new Set([
            ...databases.keys(),
            ...unavailableRoots,
            ...writesBlockedUntil.keys(),
            ...writeEpochs.keys(),
            ...suspendedRoots,
          ]),
        ]
      : [resolve(root)];
  for (const directory of roots) {
    databases.get(directory)?.close();
    databases.delete(directory);
    unavailableRoots.delete(directory);
    reportedErrors.delete(directory);
    writesBlockedUntil.delete(directory);
    suspendedRoots.delete(directory);
    writeEpochs.delete(directory);
  }
}

export async function repositoryIdentity(repoPath: string): Promise<{ hash: string; path: string }> {
  let path = resolve(repoPath);
  try {
    path = await realpath(path);
  } catch {}
  return { path, hash: createHash("sha256").update(path).digest("hex") };
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

export interface ShaSqliteCacheOptions<T> {
  provider: string;
  root?: string;
  maxEntries?: ProviderCacheLimit;
  isEntry: (value: unknown) => value is T;
  invalidMessage: string;
}

export class ShaSqliteCache<T extends { sha: string }> {
  readonly root: string;
  readonly provider: string;
  readonly maxEntries: ProviderCacheLimit;
  private readonly isEntry: (value: unknown) => value is T;
  private readonly invalidMessage: string;

  constructor(options: ShaSqliteCacheOptions<T>) {
    if (typeof options.provider !== "string" || !options.provider) throw new Error("Provider cache ID is required.");
    this.root = resolve(options.root ?? DEFAULT_PROVIDER_CACHE_ROOT);
    this.provider = options.provider;
    this.maxEntries = options.maxEntries ?? DEFAULT_PROVIDER_CACHE_LIMIT;
    this.isEntry = options.isEntry;
    this.invalidMessage = options.invalidMessage;
  }

  async list(repoPath: string): Promise<string[]> {
    const { hash } = await repositoryIdentity(repoPath);
    try {
      return providerCacheDatabase(this.root)
        .query<{ sha: string }, [string, string]>("SELECT sha FROM snapshots WHERE provider = ? AND repo_hash = ?")
        .all(this.provider, hash)
        .map(row => row.sha);
    } catch (error) {
      reportCacheError(this.root, error);
      return [];
    }
  }

  async read(repoPath: string, revision: string): Promise<T | null> {
    const epoch = writeEpochs.get(this.root) ?? 0;
    const sha = assertExactSha(revision);
    const { hash } = await repositoryIdentity(repoPath);
    try {
      const db = providerCacheDatabase(this.root);
      const row = db
        .query<{ payload: string }, [string, string, string]>(
          "SELECT payload FROM snapshots WHERE provider = ? AND repo_hash = ? AND sha = ?",
        )
        .get(this.provider, hash, sha);
      if (!row) return null;
      let value: unknown;
      try {
        value = JSON.parse(row.payload);
      } catch {
        value = null;
      }
      if (!this.isEntry(value) || value.sha.toLowerCase() !== sha) {
        if (this.canWrite(epoch)) {
          db.query("DELETE FROM snapshots WHERE provider = ? AND repo_hash = ? AND sha = ? AND payload = ?").run(
            this.provider,
            hash,
            sha,
            row.payload,
          );
        }
        return null;
      }
      this.touch(db, hash, sha, epoch);
      return value;
    } catch (error) {
      reportCacheError(this.root, error);
      return null;
    }
  }

  async write(repoPath: string, entry: T, options?: { evict?: boolean }): Promise<void> {
    if (!this.isEntry(entry)) throw new Error(this.invalidMessage);
    const sha = assertExactSha(entry.sha);
    const payload = JSON.stringify({ ...entry, sha });
    const epoch = writeEpochs.get(this.root) ?? 0;
    if (!this.canWrite(epoch)) return;
    const { hash, path } = await repositoryIdentity(repoPath);
    if (!this.canWrite(epoch)) return;
    try {
      const db = providerCacheDatabase(this.root);
      db.transaction(() => {
        db.query(`INSERT INTO snapshots (provider, repo_hash, repo_path, sha, payload, accessed_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (provider, repo_hash, sha) DO UPDATE SET
            repo_path = excluded.repo_path, payload = excluded.payload, accessed_at = excluded.accessed_at`).run(
          this.provider,
          hash,
          path,
          sha,
          payload,
          Date.now(),
        );
        if (options?.evict !== false) this.evict(db, hash);
      })();
    } catch (error) {
      reportCacheError(this.root, error);
    }
  }

  async evictForRepo(repoPath: string): Promise<void> {
    const epoch = writeEpochs.get(this.root) ?? 0;
    if (!this.canWrite(epoch)) return;
    const { hash } = await repositoryIdentity(repoPath);
    if (!this.canWrite(epoch)) return;
    try {
      const db = providerCacheDatabase(this.root);
      db.transaction(() => this.evict(db, hash))();
    } catch (error) {
      reportCacheError(this.root, error);
    }
  }

  private evict(db: Database, hash: string): void {
    db.query(`
      DELETE FROM snapshots WHERE id IN (
        SELECT id FROM snapshots WHERE provider = ? AND repo_hash = ?
        ORDER BY accessed_at DESC, sha DESC LIMIT -1 OFFSET ?
      )
    `).run(this.provider, hash, this.maxEntries);
  }

  private canWrite(epoch: number): boolean {
    return (
      !suspendedRoots.has(this.root) &&
      epoch === (writeEpochs.get(this.root) ?? 0) &&
      Date.now() >= (writesBlockedUntil.get(this.root) ?? 0)
    );
  }

  private touch(db: Database, hash: string, sha: string, epoch: number): void {
    // One locked writer must not impose a busy wait on every snapshot in a hydration batch.
    if (!this.canWrite(epoch)) return;
    try {
      db.query("UPDATE snapshots SET accessed_at = ? WHERE provider = ? AND repo_hash = ? AND sha = ?").run(
        Date.now(),
        this.provider,
        hash,
        sha,
      );
    } catch (error) {
      reportCacheError(this.root, error);
    }
  }

  async readLog(repoPath: string, revision: string, key: string): Promise<string | null> {
    const epoch = writeEpochs.get(this.root) ?? 0;
    try {
      const sha = assertExactSha(revision);
      const { hash } = await repositoryIdentity(repoPath);
      const db = providerCacheDatabase(this.root);
      const row = db
        .query<{ content: string }, [string, string, string, string]>(`
        SELECT a.content FROM artifacts a JOIN snapshots s ON s.id = a.snapshot_id
        WHERE s.provider = ? AND s.repo_hash = ? AND s.sha = ? AND a.kind = 'log' AND a.artifact_key = ?
      `)
        .get(this.provider, hash, sha, key);
      if (!row) return null;
      this.touch(db, hash, sha, epoch);
      return row.content;
    } catch (error) {
      reportCacheError(this.root, error);
      return null;
    }
  }

  async writeLog(repoPath: string, revision: string, key: string, log: string): Promise<void> {
    const epoch = writeEpochs.get(this.root) ?? 0;
    if (!log || !this.canWrite(epoch)) return;
    const sha = assertExactSha(revision);
    const { hash } = await repositoryIdentity(repoPath);
    if (!this.canWrite(epoch)) return;
    try {
      const db = providerCacheDatabase(this.root);
      db.transaction(() => {
        // Resolve parent in the write itself, never retain IDs across a log download.
        const result = db
          .query(`
          INSERT INTO artifacts (snapshot_id, kind, artifact_key, content)
          SELECT id, 'log', ?, ? FROM snapshots WHERE provider = ? AND repo_hash = ? AND sha = ?
          ON CONFLICT (snapshot_id, kind, artifact_key) DO UPDATE SET content = excluded.content
        `)
          .run(key, log, this.provider, hash, sha);
        if (result.changes > 0)
          db.query(`
          UPDATE snapshots SET accessed_at = ? WHERE provider = ? AND repo_hash = ? AND sha = ?
        `).run(Date.now(), this.provider, hash, sha);
      })();
    } catch (error) {
      reportCacheError(this.root, error);
    }
  }
}
