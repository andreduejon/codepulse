import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_PROVIDER_CACHE_ROOT, invalidateProviderCacheWrites, providerCacheDatabase } from "./sha-sqlite-cache";

export const CACHE_INACTIVITY_MS = 90 * 24 * 60 * 60 * 1_000;

export interface CacheGroupSummary {
  provider: string;
  repoHash: string;
  repoPath: string;
  snapshotCount: number;
  payloadBytes: number;
  artifactCount: number;
  artifactBytes: number;
  logCount: number;
  logBytes: number;
  lastAccessed: number;
  cleanupAt: number;
}

export interface ProviderCacheSummary {
  path: string;
  databaseBytes: number;
  journalBytes: number;
  groups: CacheGroupSummary[];
}

export interface CacheEvictionResult {
  snapshotCount: number;
  artifactCount: number;
}

export type CacheRepositorySummary = Pick<
  CacheGroupSummary,
  "repoHash" | "repoPath" | "snapshotCount" | "lastAccessed" | "cleanupAt"
>;

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

function assertRepositoryHash(hash: string): string {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash))
    throw new Error("Cache operation requires a repository hash.");
  return hash.toLowerCase();
}

function assertTimestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || now + CACHE_INACTIVITY_MS > 8_640_000_000_000_000)
    throw new Error("Cache operation requires a valid timestamp.");
}

export function getProviderCacheSummary(root = DEFAULT_PROVIDER_CACHE_ROOT): ProviderCacheSummary {
  const path = join(resolve(root), "cache.sqlite");
  const groups = existsSync(path)
    ? providerCacheDatabase(root)
        .query<CacheGroupSummary, [number]>(`
    WITH artifact_sizes AS (
      SELECT snapshot_id, COUNT(*) AS artifact_count,
        SUM(length(CAST(content AS BLOB))) AS artifact_bytes,
        SUM(kind = 'log') AS log_count,
        SUM(CASE WHEN kind = 'log' THEN length(CAST(content AS BLOB)) ELSE 0 END) AS log_bytes
      FROM artifacts GROUP BY snapshot_id
    ), repository_activity AS (
      SELECT repo_hash, MAX(MAX(accessed_at, cleanup_reset_at)) AS latest
      FROM snapshots GROUP BY repo_hash
    )
    SELECT s.provider, s.repo_hash AS repoHash, MAX(s.repo_path) AS repoPath,
      COUNT(*) AS snapshotCount, SUM(length(CAST(s.payload AS BLOB))) AS payloadBytes,
      COALESCE(SUM(a.artifact_count), 0) AS artifactCount,
      COALESCE(SUM(a.artifact_bytes), 0) AS artifactBytes,
      COALESCE(SUM(a.log_count), 0) AS logCount,
      COALESCE(SUM(a.log_bytes), 0) AS logBytes,
      MAX(s.accessed_at) AS lastAccessed, r.latest + ? AS cleanupAt
    FROM snapshots s JOIN repository_activity r ON r.repo_hash = s.repo_hash
    LEFT JOIN artifact_sizes a ON a.snapshot_id = s.id
    GROUP BY s.repo_hash, s.provider
    ORDER BY lastAccessed ASC, repoPath, s.provider
  `)
        .all(CACHE_INACTIVITY_MS)
    : [];
  return {
    path,
    databaseBytes: fileSize(path),
    journalBytes: fileSize(`${path}-wal`) + fileSize(`${path}-shm`),
    groups,
  };
}

export function resetRepositoryCacheTimer(
  repoHash: string,
  root = DEFAULT_PROVIDER_CACHE_ROOT,
  now = Date.now(),
): number {
  const hash = assertRepositoryHash(repoHash);
  assertTimestamp(now);
  if (!existsSync(join(resolve(root), "cache.sqlite"))) return 0;
  return providerCacheDatabase(root)
    .query("UPDATE snapshots SET cleanup_reset_at = ? WHERE repo_hash = ?")
    .run(now, hash).changes > 0
    ? 1
    : 0;
}

export function resetAllCacheTimers(root = DEFAULT_PROVIDER_CACHE_ROOT, now = Date.now()): number {
  assertTimestamp(now);
  if (!existsSync(join(resolve(root), "cache.sqlite"))) return 0;
  const db = providerCacheDatabase(root);
  return db
    .transaction(() => {
      const count =
        db.query<{ count: number }, []>("SELECT COUNT(DISTINCT repo_hash) AS count FROM snapshots").get()?.count ?? 0;
      db.query("UPDATE snapshots SET cleanup_reset_at = ?").run(now);
      return count;
    })
    .immediate();
}

export function evictProviderCache(
  repoHash: string,
  provider: string,
  root = DEFAULT_PROVIDER_CACHE_ROOT,
): CacheEvictionResult {
  const hash = assertRepositoryHash(repoHash);
  if (typeof provider !== "string" || !provider) throw new Error("Cache eviction requires a provider ID.");
  if (!existsSync(join(resolve(root), "cache.sqlite"))) return { snapshotCount: 0, artifactCount: 0 };
  const db = providerCacheDatabase(root);
  const result = db
    .transaction(() => {
      const counts = db
        .query<CacheEvictionResult, [string, string]>(`
      SELECT (SELECT COUNT(*) FROM snapshots WHERE repo_hash = ?1 AND provider = ?2) AS snapshotCount,
        (SELECT COUNT(*) FROM artifacts a JOIN snapshots s ON s.id = a.snapshot_id
          WHERE s.repo_hash = ?1 AND s.provider = ?2) AS artifactCount
    `)
        .get(hash, provider);
      db.query("DELETE FROM snapshots WHERE repo_hash = ? AND provider = ?").run(hash, provider);
      return counts ?? { snapshotCount: 0, artifactCount: 0 };
    })
    .immediate();
  invalidateProviderCacheWrites(root);
  return result;
}

export function evictRepositoryCache(repoHash: string, root = DEFAULT_PROVIDER_CACHE_ROOT): CacheEvictionResult {
  const hash = assertRepositoryHash(repoHash);
  if (!existsSync(join(resolve(root), "cache.sqlite"))) return { snapshotCount: 0, artifactCount: 0 };
  const db = providerCacheDatabase(root);
  const result = db
    .transaction(() => {
      const counts = db
        .query<CacheEvictionResult, [string]>(`
      SELECT (SELECT COUNT(*) FROM snapshots WHERE repo_hash = ?1) AS snapshotCount,
        (SELECT COUNT(*) FROM artifacts a JOIN snapshots s ON s.id = a.snapshot_id
          WHERE s.repo_hash = ?1) AS artifactCount
    `)
        .get(hash);
      db.query("DELETE FROM snapshots WHERE repo_hash = ?").run(hash);
      return counts ?? { snapshotCount: 0, artifactCount: 0 };
    })
    .immediate();
  invalidateProviderCacheWrites(root);
  return result;
}

export function cleanupInactiveProviderCaches(root = DEFAULT_PROVIDER_CACHE_ROOT, now = Date.now()): number {
  assertTimestamp(now);
  if (!existsSync(join(resolve(root), "cache.sqlite"))) return 0;
  const db = providerCacheDatabase(root);
  const cutoff = now - CACHE_INACTIVITY_MS;
  const count = db
    .transaction(() => {
      const expired = db
        .query<{ repo_hash: string }, [number]>(`
      SELECT repo_hash FROM snapshots GROUP BY repo_hash
      HAVING MAX(MAX(accessed_at, cleanup_reset_at)) <= ?
    `)
        .all(cutoff);
      db.query(`DELETE FROM snapshots WHERE repo_hash IN (
      SELECT repo_hash FROM snapshots GROUP BY repo_hash
      HAVING MAX(MAX(accessed_at, cleanup_reset_at)) <= ?
    )`).run(cutoff);
      return expired.length;
    })
    .immediate();
  if (count > 0) invalidateProviderCacheWrites(root);
  return count;
}
