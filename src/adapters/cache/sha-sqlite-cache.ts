import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { addDebugEvent, redactDebugValue } from "../../core/debug-events";
import { monotonicNow, NEVER } from "../../core/monotonic";
import { DEFAULT_PROVIDER_CACHE_LIMIT, type ProviderCacheLimit } from "../../core/provider-settings";
import { storageRoot } from "../system/storage-path";

export const DEFAULT_PROVIDER_CACHE_ROOT = storageRoot("cache");
function isCacheBusy(error: unknown): boolean {
  return !!(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    (error.code.startsWith("SQLITE_BUSY") || error.code.startsWith("SQLITE_LOCKED"))
  );
}

/**
 * The open cache databases (one connection per folder) and what belongs to each: a folder that couldn't open, a busy
 * one's pause, the cache screen's suspension, the write epochs that drop writes started before an eviction, and the
 * listeners told about each write. The terminal app uses `providerCacheRegistry`, the process's; a host with several
 * apps (a web host) can give each its own.
 */
export class ProviderCacheRegistry {
  private readonly databases = new Map<string, Database>();
  private readonly unavailableRoots = new Set<string>();
  private readonly reportedErrors = new Map<string, string>();
  private readonly writesBlockedUntil = new Map<string, number>();
  private readonly suspendedRoots = new Set<string>();
  private readonly writeEpochs = new Map<string, number>();
  private readonly writeListeners = new Set<(repoPath: string) => void>();

  /**
   * Calls `listener` with the repository after each snapshot a provider writes, so a view built from the caches (the
   * dashboard) can read them again. Returns the function that stops it.
   */
  onWrite(listener: (repoPath: string) => void): () => void {
    this.writeListeners.add(listener);
    return () => this.writeListeners.delete(listener);
  }

  notifyWrite(repoPath: string): void {
    for (const listener of this.writeListeners) listener(repoPath);
  }

  /** Writes started before now are dropped (an eviction or reset ran meanwhile). */
  invalidateWrites(root = DEFAULT_PROVIDER_CACHE_ROOT): void {
    const directory = resolve(root);
    this.writeEpochs.set(directory, (this.writeEpochs.get(directory) ?? 0) + 1);
  }

  /** While the cache screen shows, nothing writes. */
  setSuspended(suspended: boolean, root = DEFAULT_PROVIDER_CACHE_ROOT): void {
    const directory = resolve(root);
    if (suspended && !this.suspendedRoots.has(directory)) {
      this.invalidateWrites(directory);
      this.suspendedRoots.add(directory);
    } else if (!suspended) this.suspendedRoots.delete(directory);
  }

  writeEpoch(root: string): number {
    return this.writeEpochs.get(root) ?? 0;
  }

  /** A write that started at `epoch` may go ahead: not suspended, not invalidated since, not paused after a busy one. */
  canWrite(root: string, epoch: number): boolean {
    return (
      !this.suspendedRoots.has(root) &&
      epoch === this.writeEpoch(root) &&
      monotonicNow() >= (this.writesBlockedUntil.get(root) ?? NEVER)
    );
  }

  /** Puts a cache error in Debug once; a busy database pauses writes for a second. */
  reportError(root: string, error: unknown): void {
    if (isCacheBusy(error)) this.writesBlockedUntil.set(root, monotonicNow() + 1_000);
    const message = redactDebugValue(error instanceof Error ? error.message : String(error));
    if (this.reportedErrors.get(root) === message) return;
    this.reportedErrors.set(root, message);
    addDebugEvent({ source: "error", status: "error", message: `Provider cache: ${message}` });
  }

  database(root = DEFAULT_PROVIDER_CACHE_ROOT): Database {
    const directory = resolve(root);
    const cached = this.databases.get(directory);
    if (cached) return cached;
    if (this.unavailableRoots.has(directory)) throw new Error("Provider cache unavailable for this session.");
    if (monotonicNow() < (this.writesBlockedUntil.get(directory) ?? NEVER))
      throw new Error("Provider cache temporarily busy.");
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
      this.databases.set(directory, db);
      return db;
    } catch (error) {
      db?.close();
      if (!isCacheBusy(error)) this.unavailableRoots.add(directory);
      this.reportError(directory, error);
      throw error;
    }
  }

  /** Closes a folder's database (or every one) and forgets what belonged to it. */
  close(root?: string): void {
    const roots =
      root === undefined
        ? [
            ...new Set([
              ...this.databases.keys(),
              ...this.unavailableRoots,
              ...this.writesBlockedUntil.keys(),
              ...this.writeEpochs.keys(),
              ...this.suspendedRoots,
            ]),
          ]
        : [resolve(root)];
    for (const directory of roots) {
      this.databases.get(directory)?.close();
      this.databases.delete(directory);
      this.unavailableRoots.delete(directory);
      this.reportedErrors.delete(directory);
      this.writesBlockedUntil.delete(directory);
      this.suspendedRoots.delete(directory);
      this.writeEpochs.delete(directory);
    }
  }
}

/** The process's cache registry. */
export const providerCacheRegistry = new ProviderCacheRegistry();

/** See ProviderCacheRegistry.onWrite. */
export const onProviderCacheWrite = (listener: (repoPath: string) => void): (() => void) =>
  providerCacheRegistry.onWrite(listener);
export const invalidateProviderCacheWrites = (root?: string): void => providerCacheRegistry.invalidateWrites(root);
export const setProviderCacheSuspended = (suspended: boolean, root?: string): void =>
  providerCacheRegistry.setSuspended(suspended, root);
export const providerCacheDatabase = (root?: string): Database => providerCacheRegistry.database(root);
export const closeProviderCaches = (root?: string): void => providerCacheRegistry.close(root);

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

export { mergeById } from "../../core/merge-by-id";

/**
 * Merge each SHA's terminal results into its cached snapshot, then apply the count limit once.
 * Stops writing as soon as `isCurrent` turns false (repository switch, provider reset).
 */
export async function persistMergedSnapshots<T extends { sha: string }, I>(
  disk: ShaSqliteCache<T>,
  repoPath: string,
  shas: readonly string[],
  isCurrent: () => boolean,
  incomingFor: (sha: string) => I[],
  merge: (sha: string, existing: T | null, incoming: I[]) => T,
): Promise<void> {
  if (!isCurrent()) return;
  const items = shas.map(sha => ({ sha, incoming: incomingFor(sha) })).filter(item => item.incoming.length > 0);
  if (items.length === 0) return;
  await disk.mergeMany(repoPath, items, merge, isCurrent);
}

/** A merge that made an entry the cache can't keep: a programming error, not a cache failure, so it is thrown. */
class InvalidEntryError extends Error {}

export interface ShaSqliteCacheOptions<T> {
  provider: string;
  root?: string;
  maxEntries?: ProviderCacheLimit;
  isEntry: (value: unknown) => value is T;
  invalidMessage: string;
  /** The open databases and their state: the process's unless a host gives its own. */
  registry?: ProviderCacheRegistry;
}

export class ShaSqliteCache<T extends { sha: string }> {
  readonly root: string;
  readonly provider: string;
  readonly maxEntries: ProviderCacheLimit;
  private readonly isEntry: (value: unknown) => value is T;
  private readonly invalidMessage: string;
  private readonly registry: ProviderCacheRegistry;

  constructor(options: ShaSqliteCacheOptions<T>) {
    if (typeof options.provider !== "string" || !options.provider) throw new Error("Provider cache ID is required.");
    this.root = resolve(options.root ?? DEFAULT_PROVIDER_CACHE_ROOT);
    this.provider = options.provider;
    this.maxEntries = options.maxEntries ?? DEFAULT_PROVIDER_CACHE_LIMIT;
    this.isEntry = options.isEntry;
    this.invalidMessage = options.invalidMessage;
    this.registry = options.registry ?? providerCacheRegistry;
  }

  async list(repoPath: string): Promise<string[]> {
    const { hash } = await repositoryIdentity(repoPath);
    try {
      return this.registry
        .database(this.root)
        .query<{ sha: string }, [string, string]>("SELECT sha FROM snapshots WHERE provider = ? AND repo_hash = ?")
        .all(this.provider, hash)
        .map(row => row.sha);
    } catch (error) {
      this.registry.reportError(this.root, error);
      return [];
    }
  }

  /**
   * Every valid snapshot of one repository, in one query and without marking any as used, so showing the whole
   * cache does not change which snapshots are evicted first. Invalid rows are skipped (`read` deletes them).
   */
  async peekAll(repoPath: string): Promise<T[]> {
    const { hash } = await repositoryIdentity(repoPath);
    try {
      return this.registry
        .database(this.root)
        .query<{ sha: string; payload: string }, [string, string]>(
          "SELECT sha, payload FROM snapshots WHERE provider = ? AND repo_hash = ?",
        )
        .all(this.provider, hash)
        .flatMap(row => {
          let value: unknown;
          try {
            value = JSON.parse(row.payload);
          } catch {
            return [];
          }
          return this.isEntry(value) && value.sha.toLowerCase() === row.sha ? [value] : [];
        });
    } catch (error) {
      this.registry.reportError(this.root, error);
      return [];
    }
  }

  /**
   * One commit's snapshot. A read marks it as used for eviction; `touch: false` only shows it, for commits that are
   * displayed but not worked with (cached history below a provider's fetch depth).
   */
  async read(repoPath: string, revision: string, options?: { touch?: boolean }): Promise<T | null> {
    const epoch = this.registry.writeEpoch(this.root);
    const sha = assertExactSha(revision);
    const { hash } = await repositoryIdentity(repoPath);
    try {
      const db = this.registry.database(this.root);
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
      if (options?.touch !== false) this.touch(db, hash, sha, epoch);
      return value;
    } catch (error) {
      this.registry.reportError(this.root, error);
      return null;
    }
  }

  async write(repoPath: string, entry: T, options?: { evict?: boolean }): Promise<void> {
    if (!this.isEntry(entry)) throw new Error(this.invalidMessage);
    const sha = assertExactSha(entry.sha);
    const payload = JSON.stringify({ ...entry, sha });
    const epoch = this.registry.writeEpoch(this.root);
    if (!this.canWrite(epoch)) return;
    const { hash, path } = await repositoryIdentity(repoPath);
    if (!this.canWrite(epoch)) return;
    try {
      const db = this.registry.database(this.root);
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
      this.registry.reportError(this.root, error);
      return;
    }
    this.registry.notifyWrite(repoPath);
  }

  /**
   * Merges each commit's new results into its entry, all in one transaction: an entry that comes out the same is not
   * written again, the count limit applies once, and listeners hear of it once, only when something was written.
   * Reading an entry to merge into doesn't count as using it; writing it does. Returns how many entries it wrote.
   */
  async mergeMany<I>(
    repoPath: string,
    items: readonly { sha: string; incoming: readonly I[] }[],
    merge: (sha: string, existing: T | null, incoming: I[]) => T,
    isCurrent: () => boolean = () => true,
  ): Promise<number> {
    const epoch = this.registry.writeEpoch(this.root);
    if (items.length === 0 || !this.canWrite(epoch) || !isCurrent()) return 0;
    const { hash, path } = await repositoryIdentity(repoPath);
    if (!this.canWrite(epoch) || !isCurrent()) return 0;
    let written = 0;
    try {
      const db = this.registry.database(this.root);
      const select = db.query<{ payload: string }, [string, string, string]>(
        "SELECT payload FROM snapshots WHERE provider = ? AND repo_hash = ? AND sha = ?",
      );
      const upsert = db.query(`INSERT INTO snapshots (provider, repo_hash, repo_path, sha, payload, accessed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (provider, repo_hash, sha) DO UPDATE SET
          repo_path = excluded.repo_path, payload = excluded.payload, accessed_at = excluded.accessed_at`);
      const now = Date.now();
      db.transaction(() => {
        for (const item of items) {
          const sha = assertExactSha(item.sha);
          const row = select.get(this.provider, hash, sha);
          let existing: T | null = null;
          if (row) {
            try {
              const value: unknown = JSON.parse(row.payload);
              if (this.isEntry(value) && value.sha.toLowerCase() === sha) existing = value;
            } catch {
              // An unreadable entry is replaced by the merge.
            }
          }
          const merged = merge(sha, existing, [...item.incoming]);
          if (!this.isEntry(merged)) throw new InvalidEntryError(this.invalidMessage);
          const payload = JSON.stringify({ ...merged, sha });
          if (row?.payload === payload) continue;
          upsert.run(this.provider, hash, path, sha, payload, now);
          written++;
        }
        if (written > 0) this.evict(db, hash);
      })();
    } catch (error) {
      if (error instanceof InvalidEntryError) throw new Error(error.message);
      this.registry.reportError(this.root, error);
      return 0;
    }
    if (written > 0) this.registry.notifyWrite(repoPath);
    return written;
  }

  async evictForRepo(repoPath: string): Promise<void> {
    const epoch = this.registry.writeEpoch(this.root);
    if (!this.canWrite(epoch)) return;
    const { hash } = await repositoryIdentity(repoPath);
    if (!this.canWrite(epoch)) return;
    try {
      const db = this.registry.database(this.root);
      db.transaction(() => this.evict(db, hash))();
    } catch (error) {
      this.registry.reportError(this.root, error);
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
    return this.registry.canWrite(this.root, epoch);
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
      this.registry.reportError(this.root, error);
    }
  }

  async readLog(repoPath: string, revision: string, key: string): Promise<string | null> {
    const epoch = this.registry.writeEpoch(this.root);
    try {
      const sha = assertExactSha(revision);
      const { hash } = await repositoryIdentity(repoPath);
      const db = this.registry.database(this.root);
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
      this.registry.reportError(this.root, error);
      return null;
    }
  }

  async writeLog(repoPath: string, revision: string, key: string, log: string): Promise<void> {
    const epoch = this.registry.writeEpoch(this.root);
    if (!log || !this.canWrite(epoch)) return;
    const sha = assertExactSha(revision);
    const { hash } = await repositoryIdentity(repoPath);
    if (!this.canWrite(epoch)) return;
    try {
      const db = this.registry.database(this.root);
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
      this.registry.reportError(this.root, error);
    }
  }
}
