import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHE_INACTIVITY_MS,
  cleanupInactiveProviderCaches,
  evictProviderCache,
  evictRepositoryCache,
  getProviderCacheSummary,
  resetAllCacheTimers,
  resetRepositoryCacheTimer,
} from "./cache-management";
import {
  closeProviderCaches,
  providerCacheDatabase,
  repositoryIdentity,
  ShaSqliteCache,
  setProviderCacheSuspended,
} from "./sha-sqlite-cache";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1_000;
const SHA = "a".repeat(40);
const roots: string[] = [];
interface Entry {
  sha: string;
  value: string;
}
const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" &&
  value !== null &&
  "sha" in value &&
  typeof value.sha === "string" &&
  "value" in value &&
  typeof value.value === "string";

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "codepulse-cache-management-test-"));
  roots.push(path);
  return path;
}

async function seed(path: string, repoPath: string, provider: string, accessedAt: number, sha = SHA) {
  const disk = new ShaSqliteCache<Entry>({ root: path, provider, isEntry, invalidMessage: "invalid test entry" });
  await disk.write(repoPath, { sha, value: "雪 'cache'" });
  await disk.writeLog(repoPath, sha, "job", "雪 log");
  const { hash } = await repositoryIdentity(repoPath);
  providerCacheDatabase(path)
    .query("UPDATE snapshots SET accessed_at = ? WHERE repo_hash = ? AND provider = ? AND sha = ?")
    .run(accessedAt, hash, provider, sha);
  return { disk, hash };
}

afterEach(async () => {
  for (const path of roots.splice(0)) {
    closeProviderCaches(path);
    await rm(path, { recursive: true, force: true });
  }
});

describe("provider cache management", () => {
  test("empty inspection and operations do not create a database", async () => {
    const path = join(await root(), "unused");
    expect(getProviderCacheSummary(path)).toEqual({
      path: join(path, "cache.sqlite"),
      databaseBytes: 0,
      journalBytes: 0,
      groups: [],
    });
    expect(resetRepositoryCacheTimer("0".repeat(64), path, NOW)).toBe(0);
    expect(resetAllCacheTimers(path, NOW)).toBe(0);
    expect(evictProviderCache("0".repeat(64), "github-actions", path)).toEqual({ snapshotCount: 0, artifactCount: 0 });
    expect(cleanupInactiveProviderCaches(path, NOW)).toBe(0);
    expect(await Bun.file(join(path, "cache.sqlite")).exists()).toBe(false);
  });

  test("summary aggregates without multiplying snapshots and counts UTF-8 bytes", async () => {
    const path = await root();
    const first = await seed(path, "/repo-a", "github-actions", NOW - 60 * DAY);
    await seed(path, "/repo-a", "github-actions", NOW - 61 * DAY, "b".repeat(40));
    await seed(path, "/repo-a", "jenkins", NOW - DAY);
    await seed(path, "/repo-b", "github-actions", NOW - 2 * DAY);
    const db = providerCacheDatabase(path);
    const id = db
      .query<{ id: number }, [string, string]>(
        "SELECT id FROM snapshots WHERE repo_hash = ? AND provider = ? ORDER BY sha",
      )
      .get(first.hash, "github-actions")?.id;
    if (id === undefined) throw new Error("Missing test snapshot");
    const response = JSON.stringify({ result: "雪" });
    db.query("INSERT INTO artifacts (snapshot_id, kind, artifact_key, content) VALUES (?, 'json', 'response', ?)").run(
      id,
      response,
    );
    const before = db.query("SELECT id, accessed_at, cleanup_reset_at FROM snapshots ORDER BY id").all();
    const summary = getProviderCacheSummary(path);
    expect(summary.groups.map(group => [group.repoHash, group.provider])).toEqual([
      [first.hash, "github-actions"],
      [(await repositoryIdentity("/repo-b")).hash, "github-actions"],
      [first.hash, "jenkins"],
    ]);
    const github = summary.groups[0];
    expect(github.snapshotCount).toBe(2);
    expect(github.payloadBytes).toBe(Buffer.byteLength(JSON.stringify({ sha: SHA, value: "雪 'cache'" })) * 2);
    expect(github.artifactCount).toBe(3);
    expect(github.logCount).toBe(2);
    expect(github.logBytes).toBe(Buffer.byteLength("雪 log") * 2);
    expect(github.artifactBytes).toBe(github.logBytes + Buffer.byteLength(response));
    expect(github.lastAccessed).toBe(NOW - 60 * DAY);
    expect(github.cleanupAt).toBe(NOW - DAY + CACHE_INACTIVITY_MS);
    expect(summary.groups[2].cleanupAt).toBe(github.cleanupAt);
    expect(summary.databaseBytes).toBeGreaterThan(0);
    expect(summary.journalBytes).toBeGreaterThan(0);
    expect(db.query("SELECT id, accessed_at, cleanup_reset_at FROM snapshots ORDER BY id").all()).toEqual(before);
  });

  test("single reset covers repository providers without changing LRU or neighbours", async () => {
    const path = await root();
    const selected = await seed(path, "/repo-a", "github-actions", NOW - 120 * DAY);
    await seed(path, "/repo-a", "jenkins", NOW - 100 * DAY);
    await seed(path, "/repo-b", "github-actions", NOW - 110 * DAY);
    const db = providerCacheDatabase(path);
    const before = db.query("SELECT id, accessed_at FROM snapshots ORDER BY id").all();
    expect(resetRepositoryCacheTimer(selected.hash.toUpperCase(), path, NOW)).toBe(1);
    const groups = getProviderCacheSummary(path).groups;
    expect(
      groups
        .filter(group => group.repoHash === selected.hash)
        .every(group => group.cleanupAt === NOW + CACHE_INACTIVITY_MS),
    ).toBe(true);
    expect(groups.find(group => group.repoHash !== selected.hash)?.cleanupAt).toBe(
      NOW - 110 * DAY + CACHE_INACTIVITY_MS,
    );
    expect(db.query("SELECT id, accessed_at FROM snapshots ORDER BY id").all()).toEqual(before);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(3);
    expect(cleanupInactiveProviderCaches(path, NOW)).toBe(1);
    expect(getProviderCacheSummary(path).groups).toHaveLength(2);
  });

  test("reset all counts repositories, changes only timers and deletes nothing", async () => {
    const path = await root();
    await seed(path, "/repo-a", "github-actions", NOW - 110 * DAY);
    await seed(path, "/repo-a", "jenkins", NOW - 120 * DAY);
    await seed(path, "/repo-b", "github-actions", NOW - 130 * DAY);
    const db = providerCacheDatabase(path);
    const before = db.query("SELECT id, accessed_at, payload FROM snapshots ORDER BY id").all();
    expect(resetAllCacheTimers(path, NOW)).toBe(2);
    expect(getProviderCacheSummary(path).groups.every(group => group.cleanupAt === NOW + CACHE_INACTIVITY_MS)).toBe(
      true,
    );
    expect(db.query("SELECT id, accessed_at, payload FROM snapshots ORDER BY id").all()).toEqual(before);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(3);
    expect(cleanupInactiveProviderCaches(path, NOW)).toBe(0);
  });

  test("cleanup uses latest activity across all providers and includes exact 90-day boundary", async () => {
    const path = await root();
    const expired = await seed(path, "/expired", "github-actions", NOW - CACHE_INACTIVITY_MS);
    await seed(path, "/expired", "jenkins", NOW - CACHE_INACTIVITY_MS - 1);
    const active = await seed(path, "/active", "github-actions", NOW - 120 * DAY);
    await seed(path, "/active", "jenkins", NOW - CACHE_INACTIVITY_MS + 1);
    await seed(path, "/reset", "github-actions", NOW - 140 * DAY);
    resetRepositoryCacheTimer((await repositoryIdentity("/reset")).hash, path, NOW);
    await seed(path, "/future", "github-actions", NOW + DAY);
    expect(cleanupInactiveProviderCaches(path, NOW)).toBe(1);
    const summary = getProviderCacheSummary(path);
    expect(summary.groups.some(group => group.repoHash === expired.hash)).toBe(false);
    expect(summary.groups.filter(group => group.repoHash === active.hash)).toHaveLength(2);
    expect(summary.groups).toHaveLength(4);
    expect(providerCacheDatabase(path).query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(4);
    expect(providerCacheDatabase(path).query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(cleanupInactiveProviderCaches(path, NOW)).toBe(0);
  });

  test("selected eviction removes only selected repository/provider with all artifacts", async () => {
    const path = await root();
    const selected = await seed(path, "/repo-a", "github-actions", NOW);
    await seed(path, "/repo-a", "github-actions", NOW, "b".repeat(40));
    await seed(path, "/repo-a", "jenkins", NOW);
    await seed(path, "/repo-b", "github-actions", NOW);
    expect(evictProviderCache(selected.hash, "github-actions", path)).toEqual({ snapshotCount: 2, artifactCount: 2 });
    const groups = getProviderCacheSummary(path).groups;
    expect(groups).toHaveLength(2);
    expect(groups.find(group => group.repoHash === selected.hash)?.provider).toBe("jenkins");
    expect(providerCacheDatabase(path).query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(2);
    expect(evictProviderCache(selected.hash, "github-actions", path)).toEqual({ snapshotCount: 0, artifactCount: 0 });
  });

  test("provider IDs remain bound data, never SQL", async () => {
    const path = await root();
    const provider = "future'; DELETE FROM snapshots; --";
    const selected = await seed(path, "/repo-a", provider, NOW);
    await seed(path, "/repo-a", "jenkins", NOW);
    expect(evictProviderCache(selected.hash, provider, path)).toEqual({ snapshotCount: 1, artifactCount: 1 });
    expect(getProviderCacheSummary(path).groups.map(group => group.provider)).toEqual(["jenkins"]);
  });

  test("repository eviction deletes its providers and artifacts but preserves other repositories", async () => {
    const path = await root();
    const selected = await seed(path, "/repo-a", "github-actions", NOW);
    await seed(path, "/repo-a", "jenkins", NOW);
    await seed(path, "/repo-b", "github-actions", NOW);
    await seed(path, "/repo-b", "jenkins", NOW);
    const before = getProviderCacheSummary(path).groups.filter(group => group.repoHash !== selected.hash);
    expect(evictRepositoryCache(selected.hash, path)).toEqual({ snapshotCount: 2, artifactCount: 2 });
    expect(getProviderCacheSummary(path).groups).toEqual(before);
    expect(providerCacheDatabase(path).query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(2);
    expect(evictRepositoryCache(selected.hash, path)).toEqual({ snapshotCount: 0, artifactCount: 0 });
  });

  test("repository eviction rolls back and rejects empty or malformed selectors", async () => {
    const path = await root();
    const selected = await seed(path, "/repo", "github-actions", NOW);
    for (const hash of ["", "a".repeat(63), "'; DELETE FROM snapshots; --"]) {
      expect(() => evictRepositoryCache(hash, path)).toThrow("repository hash");
    }
    const db = providerCacheDatabase(path);
    db.exec(
      "CREATE TRIGGER deny_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'blocked repository eviction'); END;",
    );
    expect(() => evictRepositoryCache(selected.hash, path)).toThrow("blocked repository eviction");
    expect(getProviderCacheSummary(path).groups).toHaveLength(1);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(1);
  });

  test("repository eviction fences already-started writes across its providers", async () => {
    const path = await root();
    const selected = await seed(path, "/repo", "github-actions", NOW);
    const other = await seed(path, "/repo", "jenkins", NOW);
    const writes = [
      selected.disk.write("/repo", { sha: SHA, value: "stale" }),
      other.disk.write("/repo", { sha: SHA, value: "stale" }),
      other.disk.writeLog("/repo", SHA, "job", "stale"),
    ];
    expect(evictRepositoryCache(selected.hash, path)).toEqual({ snapshotCount: 2, artifactCount: 2 });
    await Promise.all(writes);
    expect(getProviderCacheSummary(path).groups).toEqual([]);
  });

  test("manual eviction and cleanup failures roll back instead of claiming success", async () => {
    const path = await root();
    const selected = await seed(path, "/expired", "github-actions", NOW - 120 * DAY);
    const db = providerCacheDatabase(path);
    db.exec(
      "CREATE TRIGGER deny_artifact_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'blocked test eviction'); END;",
    );
    expect(() => evictProviderCache(selected.hash, "github-actions", path)).toThrow("blocked test eviction");
    expect(() => cleanupInactiveProviderCaches(path, NOW)).toThrow("blocked test eviction");
    expect(getProviderCacheSummary(path).groups).toHaveLength(1);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(1);
  });

  test("bulk timer reset rolls back if any update fails", async () => {
    const path = await root();
    await seed(path, "/repo-a", "github-actions", NOW);
    await seed(path, "/repo-b", "jenkins", NOW);
    const db = providerCacheDatabase(path);
    db.exec(
      "CREATE TRIGGER deny_reset BEFORE UPDATE OF cleanup_reset_at ON snapshots WHEN OLD.provider = 'jenkins' BEGIN SELECT RAISE(ABORT, 'blocked reset'); END;",
    );
    expect(() => resetAllCacheTimers(path, NOW)).toThrow("blocked reset");
    expect(
      db
        .query<{ cleanup_reset_at: number }, []>("SELECT cleanup_reset_at FROM snapshots")
        .all()
        .every(row => row.cleanup_reset_at === 0),
    ).toBe(true);
  });

  test("validates selectors and timestamps before any destructive query", async () => {
    const path = await root();
    const selected = await seed(path, "/repo", "github-actions", NOW);
    for (const hash of ["", "a".repeat(63), "'; DELETE FROM snapshots; --"]) {
      expect(() => evictProviderCache(hash, "github-actions", path)).toThrow("repository hash");
      expect(() => resetRepositoryCacheTimer(hash, path, NOW)).toThrow("repository hash");
    }
    expect(() => evictProviderCache(selected.hash, "", path)).toThrow("provider ID");
    for (const now of [-1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => resetRepositoryCacheTimer(selected.hash, path, now)).toThrow("valid timestamp");
      expect(() => resetAllCacheTimers(path, now)).toThrow("valid timestamp");
      expect(() => cleanupInactiveProviderCaches(path, now)).toThrow("valid timestamp");
    }
    expect(getProviderCacheSummary(path).groups).toHaveLength(1);
  });

  test("suspension keeps cached reads available but blocks recency and background writes", async () => {
    const path = await root();
    const selected = await seed(path, "/repo", "github-actions", NOW - DAY);
    const before = getProviderCacheSummary(path).groups[0];
    setProviderCacheSuspended(true, path);
    expect((await selected.disk.read("/repo", SHA))?.value).toBe("雪 'cache'");
    expect(await selected.disk.readLog("/repo", SHA, "job")).toBe("雪 log");
    await selected.disk.write("/repo", { sha: "b".repeat(40), value: "blocked" });
    await selected.disk.writeLog("/repo", SHA, "job", "blocked");
    expect(getProviderCacheSummary(path).groups[0]).toEqual(before);
    expect(resetRepositoryCacheTimer(selected.hash, path, NOW)).toBe(1);
    expect(getProviderCacheSummary(path).groups[0].lastAccessed).toBe(before.lastAccessed);
    setProviderCacheSuspended(false, path);
    await selected.disk.write("/repo", { sha: "b".repeat(40), value: "resumed" });
    expect(getProviderCacheSummary(path).groups[0].snapshotCount).toBe(2);
  });

  test("pause and resume invalidate operations already awaiting repository lookup", async () => {
    const path = await root();
    const selected = await seed(path, "/repo", "github-actions", NOW - DAY);
    const before = getProviderCacheSummary(path).groups[0];
    const reading = selected.disk.read("/repo", SHA);
    const logReading = selected.disk.readLog("/repo", SHA, "job");
    const writing = selected.disk.write("/repo", { sha: "b".repeat(40), value: "stale" });
    const logWriting = selected.disk.writeLog("/repo", SHA, "job", "stale");
    setProviderCacheSuspended(true, path);
    setProviderCacheSuspended(false, path);
    await Promise.all([reading, logReading, writing, logWriting]);
    expect(getProviderCacheSummary(path).groups[0]).toEqual(before);
  });

  test("confirmed eviction cannot be undone by already-started local cache writes", async () => {
    const path = await root();
    const selected = await seed(path, "/repo", "github-actions", NOW);
    const writing = selected.disk.write("/repo", { sha: SHA, value: "stale snapshot" });
    const logWriting = selected.disk.writeLog("/repo", SHA, "job", "stale log");
    expect(evictProviderCache(selected.hash, "github-actions", path)).toEqual({ snapshotCount: 1, artifactCount: 1 });
    await Promise.all([writing, logWriting]);
    expect(getProviderCacheSummary(path).groups).toEqual([]);
    expect(providerCacheDatabase(path).query("SELECT snapshot_id FROM artifacts").all()).toEqual([]);
  });

  test("startup cleanup also invalidates pending writes for removed cache", async () => {
    const path = await root();
    const selected = await seed(path, "/expired", "github-actions", NOW - 120 * DAY);
    const writing = selected.disk.write("/expired", { sha: SHA, value: "stale" });
    expect(cleanupInactiveProviderCaches(path, NOW)).toBe(1);
    await writing;
    expect(getProviderCacheSummary(path).groups).toEqual([]);
  });

  test("invalid snapshots are not deleted by paused or stale cache reads", async () => {
    const path = await root();
    const selected = await seed(path, "/repo", "github-actions", NOW);
    const db = providerCacheDatabase(path);
    db.query("UPDATE snapshots SET payload = ?").run(JSON.stringify({ sha: SHA, value: 1 }));
    setProviderCacheSuspended(true, path);
    expect(await selected.disk.read("/repo", SHA)).toBeNull();
    expect(db.query("SELECT id FROM snapshots").all()).toHaveLength(1);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(1);
    setProviderCacheSuspended(false, path);
    const pending = selected.disk.read("/repo", SHA);
    setProviderCacheSuspended(true, path);
    setProviderCacheSuspended(false, path);
    expect(await pending).toBeNull();
    expect(db.query("SELECT id FROM snapshots").all()).toHaveLength(1);
    expect(await selected.disk.read("/repo", SHA)).toBeNull();
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toEqual([]);
  });
});
