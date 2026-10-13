import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearDebugEvents, getDebugEvents } from "../../debug/events";
import type { ProviderCacheLimit } from "./auto-refresh";
import { closeProviderCaches, mergeById, providerCacheDatabase, ShaSqliteCache } from "./sha-sqlite-cache";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    closeProviderCaches(root);
    await rm(root, { recursive: true, force: true });
  }
});

interface Entry {
  sha: string;
  value: string;
}
function isEntry(value: unknown): value is Entry {
  return (
    typeof value === "object" &&
    value !== null &&
    "sha" in value &&
    typeof value.sha === "string" &&
    "value" in value &&
    typeof value.value === "string"
  );
}
async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codepulse-sqlite-cache-test-"));
  roots.push(root);
  return root;
}
function cache(root: string, provider = "test", maxEntries: ProviderCacheLimit = 20) {
  return new ShaSqliteCache<Entry>({ root, provider, maxEntries, isEntry, invalidMessage: "bad" });
}
function setAccess(root: string, sha: string, accessedAt: number) {
  providerCacheDatabase(root)
    .query("UPDATE snapshots SET accessed_at = ? WHERE provider = ? AND sha = ?")
    .run(accessedAt, "test", sha);
}

describe("ShaSqliteCache", () => {
  test("stores normalized snapshots, canonical path, schema version and bound JSON", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "A".repeat(40);
    const value = "quote ' ; DROP TABLE snapshots; 雪";
    await disk.write("/repo", { sha, value });
    expect(await disk.read("/repo", sha)).toEqual({ sha: sha.toLowerCase(), value });
    const db = providerCacheDatabase(root);
    const row = db
      .query<{ payload: string; repo_path: string; cleanup_reset_at: number }, []>(
        "SELECT payload, repo_path, cleanup_reset_at FROM snapshots",
      )
      .get();
    expect(JSON.parse(row?.payload ?? "")).toEqual({ sha: sha.toLowerCase(), value });
    expect(row?.repo_path).toBe(resolve("/repo"));
    expect(row?.cleanup_reset_at).toBe(0);
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    closeProviderCaches(root);
    expect(await disk.read("/repo", sha)).toEqual({ sha: sha.toLowerCase(), value });
    expect(
      providerCacheDatabase(root).query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys,
    ).toBe(1);
  });

  test("shares one connection but isolates providers and repository folders", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const other = cache(root, "future/provider");
    const sha = "a".repeat(40);
    await disk.write("/repo-a", { sha, value: "a" });
    await disk.write("/repo-b", { sha, value: "b" });
    await other.write("/repo-a", { sha, value: "other" });
    expect(providerCacheDatabase(root)).toBe(providerCacheDatabase(root));
    expect((await disk.read("/repo-a", sha))?.value).toBe("a");
    expect((await disk.read("/repo-b", sha))?.value).toBe("b");
    expect((await other.read("/repo-a", sha))?.value).toBe("other");
    expect(await disk.read("/repo-c", sha)).toBeNull();
    expect(await disk.list("/repo-c")).toEqual([]);
    const rows = providerCacheDatabase(root).query<{ id: number }, []>("SELECT id FROM snapshots").all();
    expect(new Set(rows.map(row => row.id)).size).toBe(3);
    expect(rows.every(row => Number.isInteger(row.id) && row.id > 0)).toBe(true);
  });

  test("symlink aliases share canonical repository identity", async () => {
    const root = await cacheRoot();
    const repo = join(root, "repo");
    const alias = join(root, "alias");
    await mkdir(repo);
    await symlink(repo, alias, process.platform === "win32" ? "junction" : "dir");
    const sha = "a".repeat(40);
    const disk = cache(root);
    await disk.write(repo, { sha, value: "same" });
    expect((await disk.read(alias, sha))?.value).toBe("same");
    expect(providerCacheDatabase(root).query("SELECT sha FROM snapshots").all()).toHaveLength(1);
  });

  test("rejects invalid writes, abbreviated SHAs and missing provider IDs", async () => {
    const disk = cache(await cacheRoot());
    await expect(disk.write("/repo", { sha: "a".repeat(40), value: 1 } as unknown as Entry)).rejects.toThrow("bad");
    await expect(disk.write("/repo", { sha: "abcdef0", value: "bad" })).rejects.toThrow("exact commit SHA");
    await expect(disk.read("/repo", "../escape")).rejects.toThrow("exact commit SHA");
    expect(await disk.readLog("/repo", "abcdef0", "job")).toBeNull();
    expect(() => cache(disk.root, "")).toThrow("Provider cache ID is required.");
  });

  test("rejects malformed JSON in SQL and deletes only invalid provider snapshots", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "b".repeat(40);
    const other = cache(root, "other");
    await disk.write("/repo", { sha, value: "ok" });
    await other.write("/repo", { sha, value: "keep" });
    await disk.writeLog("/repo", sha, "job", "drop");
    await other.writeLog("/repo", sha, "job", "keep");
    const db = providerCacheDatabase(root);
    expect(() => db.query("UPDATE snapshots SET payload = ? WHERE provider = ?").run("not-json", "test")).toThrow();
    db.query("UPDATE snapshots SET payload = ? WHERE provider = ?").run(JSON.stringify({ sha, value: 1 }), "test");
    expect(await disk.read("/repo", sha)).toBeNull();
    expect(await disk.list("/repo")).toEqual([]);
    expect((await other.read("/repo", sha))?.value).toBe("keep");
    expect(await disk.readLog("/repo", sha, "job")).toBeNull();
    expect(await other.readLog("/repo", sha, "job")).toBe("keep");
  });

  test("treats mismatched payload SHA as invalid", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "b".repeat(40);
    await disk.write("/repo", { sha, value: "ok" });
    providerCacheDatabase(root)
      .query("UPDATE snapshots SET payload = ?")
      .run(JSON.stringify({ sha: "c".repeat(40), value: "wrong SHA" }));
    expect(await disk.read("/repo", sha)).toBeNull();
    expect(await disk.list("/repo")).toEqual([]);
  });

  test("invalid read cannot delete snapshot refreshed after its payload was selected", async () => {
    const root = await cacheRoot();
    const sha = "a".repeat(40);
    let refreshDuringValidation = false;
    const disk = new ShaSqliteCache<Entry>({
      root,
      provider: "test",
      invalidMessage: "bad",
      isEntry: (value): value is Entry => {
        if (refreshDuringValidation) {
          refreshDuringValidation = false;
          providerCacheDatabase(root)
            .query("UPDATE snapshots SET payload = ?")
            .run(JSON.stringify({ sha, value: "refreshed" }));
        }
        return isEntry(value);
      },
    });
    await disk.write("/repo", { sha, value: "initial" });
    await disk.writeLog("/repo", sha, "job", "keep log");
    providerCacheDatabase(root)
      .query("UPDATE snapshots SET payload = ?")
      .run(JSON.stringify({ sha, value: 1 }));
    refreshDuringValidation = true;
    expect(await disk.read("/repo", sha)).toBeNull();
    expect((await disk.read("/repo", sha))?.value).toBe("refreshed");
    expect(await disk.readLog("/repo", sha, "job")).toBe("keep log");
  });

  test("evicts least recently accessed SHA and its logs without touching neighbours", async () => {
    const root = await cacheRoot();
    const disk = cache(root, "test", 10);
    const other = cache(root, "other");
    const shas = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"));
    for (const [index, sha] of shas.entries()) {
      await disk.write("/repo", { sha, value: "n" });
      await disk.writeLog("/repo", sha, "job-1", "log-body");
      setAccess(root, sha, 1_700_000_000_000 + index * 1_000);
    }
    await disk.write("/neighbour", { sha: shas[1], value: "keep" });
    await other.write("/repo", { sha: shas[1], value: "keep" });
    await other.writeLog("/repo", shas[1], "job-1", "keep-log");
    await disk.read("/repo", shas[0]);
    const newest = "f".repeat(40);
    await disk.write("/repo", { sha: newest, value: "new" });
    expect(await disk.read("/repo", shas[0])).not.toBeNull();
    expect(await disk.read("/repo", shas[1])).toBeNull();
    expect(await disk.readLog("/repo", shas[1], "job-1")).toBeNull();
    expect(await disk.readLog("/repo", shas[0], "job-1")).toBe("log-body");
    expect(await other.readLog("/repo", shas[1], "job-1")).toBe("keep-log");
    expect(await disk.read("/neighbour", shas[1])).not.toBeNull();
    expect(await other.read("/repo", shas[1])).not.toBeNull();
  });

  test.each([100, 200, 500] as const)(
    "retains %i entries and deterministically breaks access-time ties",
    async limit => {
      const root = await cacheRoot();
      const disk = cache(root, "test", limit);
      for (let index = 0; index <= limit; index++) {
        const sha = index.toString(16).padStart(40, "0");
        await disk.write("/repo", { sha, value: "n" }, { evict: false });
      }
      providerCacheDatabase(root).query("UPDATE snapshots SET accessed_at = 1").run();
      await disk.evictForRepo("/repo");
      expect(await disk.list("/repo")).toHaveLength(limit);
      expect(await disk.read("/repo", "0".repeat(40))).toBeNull();
      expect(await disk.read("/repo", limit.toString(16).padStart(40, "0"))).not.toBeNull();
    },
  );

  test("upsert preserves manual reset metadata and deferred eviction", async () => {
    const root = await cacheRoot();
    const disk = cache(root, "test", 10);
    const sha = "0".repeat(40);
    await disk.write("/repo", { sha, value: "old" });
    await disk.writeLog("/repo", sha, "job", "keep log");
    const id = providerCacheDatabase(root).query<{ id: number }, []>("SELECT id FROM snapshots").get()?.id;
    providerCacheDatabase(root).query("UPDATE snapshots SET cleanup_reset_at = 123").run();
    await disk.write("/repo", { sha, value: "new" });
    expect(
      providerCacheDatabase(root)
        .query<{ cleanup_reset_at: number }, []>("SELECT cleanup_reset_at FROM snapshots")
        .get()?.cleanup_reset_at,
    ).toBe(123);
    expect((await disk.read("/repo", sha))?.value).toBe("new");
    expect(providerCacheDatabase(root).query<{ id: number }, []>("SELECT id FROM snapshots").get()?.id).toBe(id);
    expect(await disk.readLog("/repo", sha, "job")).toBe("keep log");
    await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        disk.write(
          "/repo",
          {
            sha: index.toString(16).padStart(40, "0"),
            value: "n",
          },
          { evict: false },
        ),
      ),
    );
    expect(await disk.list("/repo")).toHaveLength(11);
    await disk.evictForRepo("/repo");
    expect(await disk.list("/repo")).toHaveLength(10);
  });

  test("rolls back upsert and parent eviction if artifact cascade fails", async () => {
    const root = await cacheRoot();
    const disk = cache(root, "test", 10);
    for (let index = 0; index < 10; index++)
      await disk.write("/repo", { sha: index.toString(16).padStart(40, "0"), value: "n" });
    await disk.writeLog("/repo", "0".repeat(40), "job", "keep log");
    setAccess(root, "0".repeat(40), 1);
    providerCacheDatabase(root).exec(
      "CREATE TRIGGER deny_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
    );
    const sha = "f".repeat(40);
    await disk.write("/repo", { sha, value: "must roll back" });
    expect(await disk.read("/repo", sha)).toBeNull();
    expect(await disk.list("/repo")).toHaveLength(10);
    expect(await disk.readLog("/repo", "0".repeat(40), "job")).toBe("keep log");
  });

  test("foreign keys reject orphans and cascade all artifact kinds on parent deletion", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "parent" });
    await disk.writeLog("/repo", sha, "job", "log text");
    const db = providerCacheDatabase(root);
    const parent = db.query<{ id: number }, []>("SELECT id FROM snapshots").get();
    if (!parent) throw new Error("Missing test snapshot");
    const insert = db.query("INSERT INTO artifacts (snapshot_id, kind, artifact_key, content) VALUES (?, ?, ?, ?)");
    expect(() => insert.run(parent.id + 1, "log", "orphan", "bad")).toThrow();
    expect(() => insert.run(parent.id, "json", "response", "not-json")).toThrow();
    const response = JSON.stringify({ jobs: [{ id: 1 }] });
    insert.run(parent.id, "json", "job", response);
    expect(db.query<{ content: string }, []>("SELECT content FROM artifacts WHERE kind = 'json'").get()?.content).toBe(
      response,
    );
    expect(await disk.readLog("/repo", sha, "job")).toBe("log text");
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(2);
    db.query("DELETE FROM snapshots WHERE id = ?").run(parent.id);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toEqual([]);
    expect(await disk.readLog("/repo", sha, "job")).toBeNull();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("log writes skip missing parents and cannot attach late logs to reused IDs", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.writeLog("/repo", sha, "job", "missing parent");
    expect(await disk.list("/repo")).toEqual([]);
    const db = providerCacheDatabase(root);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toEqual([]);
    await disk.write("/repo", { sha, value: "first" });
    const originalId = db.query<{ id: number }, []>("SELECT id FROM snapshots").get()?.id;
    db.query("DELETE FROM snapshots").run();
    const otherSha = "b".repeat(40);
    await disk.write("/repo", { sha: otherSha, value: "new parent" });
    expect(db.query<{ id: number }, []>("SELECT id FROM snapshots").get()?.id).toBe(originalId);
    await disk.writeLog("/repo", sha, "job", "late old log");
    await disk.writeLog("/other-repo", otherSha, "job", "wrong repository");
    await cache(root, "other").writeLog("/repo", otherSha, "job", "wrong provider");
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toEqual([]);
    expect(await disk.list("/repo")).toEqual([otherSha]);
    expect(await disk.readLog("/repo", otherSha, "job")).toBeNull();
  });

  test("logs update actual last access without changing manual reset metadata", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "parent" });
    const db = providerCacheDatabase(root);
    db.query("UPDATE snapshots SET accessed_at = 1, cleanup_reset_at = 123").run();
    const writtenAt = Date.now();
    await disk.writeLog("/repo", sha, "job", "log");
    expect(
      db.query<{ accessed_at: number }, []>("SELECT accessed_at FROM snapshots").get()?.accessed_at,
    ).toBeGreaterThanOrEqual(writtenAt);
    db.query("UPDATE snapshots SET accessed_at = 1").run();
    const readAt = Date.now();
    expect(await disk.readLog("/repo", sha, "job")).toBe("log");
    const row = db
      .query<{ accessed_at: number; cleanup_reset_at: number }, []>(
        "SELECT accessed_at, cleanup_reset_at FROM snapshots",
      )
      .get();
    expect(row?.accessed_at).toBeGreaterThanOrEqual(readAt);
    expect(row?.cleanup_reset_at).toBe(123);
  });

  test("snapshot limit does not count log artifacts", async () => {
    const root = await cacheRoot();
    const disk = cache(root, "test", 10);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "parent" });
    for (let index = 0; index < 20; index++) await disk.writeLog("/repo", sha, String(index), "log");
    await disk.evictForRepo("/repo");
    expect(await disk.list("/repo")).toEqual([sha]);
    expect(providerCacheDatabase(root).query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(20);
  });

  test("log upsert and last-access update roll back together", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "parent" });
    await disk.writeLog("/repo", sha, "job", "original");
    const db = providerCacheDatabase(root);
    db.exec(
      "CREATE TRIGGER deny_touch BEFORE UPDATE OF accessed_at ON snapshots BEGIN SELECT RAISE(ABORT, 'test log rollback'); END;",
    );
    await disk.writeLog("/repo", sha, "job", "must roll back");
    expect(await disk.readLog("/repo", sha, "job")).toBe("original");
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(1);
  });

  test("known development v1 cache rebuilds cold without snapshot migration", async () => {
    const root = await cacheRoot();
    const old = new Database(join(root, "cache.sqlite"));
    old.exec(`CREATE TABLE snapshots (
      provider TEXT NOT NULL, repo_hash TEXT NOT NULL, repo_path TEXT NOT NULL,
      sha TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload)),
      accessed_at INTEGER NOT NULL, cleanup_reset_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider, repo_hash, sha)
    ); PRAGMA user_version = 1;`);
    old
      .query(
        "INSERT INTO snapshots (provider, repo_hash, repo_path, sha, payload, accessed_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("test", "old-hash", "/repo", "a".repeat(40), JSON.stringify({ sha: "a".repeat(40), value: "old" }), 1);
    old.close();
    const db = providerCacheDatabase(root);
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(db.query("SELECT id FROM snapshots").all()).toEqual([]);
    expect(db.query("SELECT snapshot_id FROM artifacts").all()).toEqual([]);
    const disk = cache(root);
    await disk.write("/repo", { sha: "a".repeat(40), value: "new" });
    await disk.writeLog("/repo", "a".repeat(40), "job", "new log");
    expect(await disk.readLog("/repo", "a".repeat(40), "job")).toBe("new log");
  });

  test("unknown schema stays intact instead of resetting data", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "keep" });
    await disk.writeLog("/repo", sha, "job", "keep log");
    providerCacheDatabase(root).exec("PRAGMA user_version = 99;");
    closeProviderCaches(root);
    expect(await disk.read("/repo", sha)).toBeNull();
    expect(await disk.readLog("/repo", sha, "job")).toBeNull();
    await disk.write("/repo", { sha, value: "must not overwrite" });
    const db = new Database(join(root, "cache.sqlite"));
    try {
      expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(99);
      expect(db.query<{ content: string }, []>("SELECT content FROM artifacts").get()?.content).toBe("keep log");
      expect(
        JSON.parse(db.query<{ payload: string }, []>("SELECT payload FROM snapshots").get()?.payload ?? "").value,
      ).toBe("keep");
    } finally {
      db.close();
    }
  });

  test("second connection can read and write, contention is bounded and nonfatal", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "first" });
    const second = new Database(join(root, "cache.sqlite"));
    try {
      expect(second.query("SELECT sha FROM snapshots").all()).toHaveLength(1);
      second.query("UPDATE snapshots SET payload = ?").run(JSON.stringify({ sha, value: "second" }));
      expect((await disk.read("/repo", sha))?.value).toBe("second");
      second.exec("BEGIN IMMEDIATE;");
      const start = performance.now();
      await disk.write("/repo", { sha: "b".repeat(40), value: "locked" });
      expect(performance.now() - start).toBeLessThan(1_000);
      const readStart = performance.now();
      for (let index = 0; index < 10; index++) expect((await disk.read("/repo", sha))?.value).toBe("second");
      expect(performance.now() - readStart).toBeLessThan(500);
      second.exec("ROLLBACK;");
      await Bun.sleep(1_050);
      await disk.write("/repo", { sha, value: "recovered" });
      expect((await disk.read("/repo", sha))?.value).toBe("recovered");
    } finally {
      second.close();
    }
  });

  test.each(["snapshots", "logs", "eviction"] as const)("queued %s writes respect contention cooldown", async kind => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "keep" });
    await disk.writeLog("/repo", sha, "job", "keep log");
    const writer = new Database(join(root, "cache.sqlite"));
    try {
      writer.exec("BEGIN IMMEDIATE;");
      const start = performance.now();
      await Promise.all(
        Array.from({ length: 10 }, (_, index) => {
          if (kind === "snapshots")
            return disk.write("/repo", { sha: index.toString(16).padStart(40, "0"), value: "locked" });
          if (kind === "logs") return disk.writeLog("/repo", sha, `locked-${index}`, "locked");
          return disk.evictForRepo("/repo");
        }),
      );
      expect(performance.now() - start).toBeLessThan(750);
      expect(await disk.list("/repo")).toEqual([sha]);
      expect(await disk.readLog("/repo", sha, "job")).toBe("keep log");
      expect(providerCacheDatabase(root).query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(1);
      writer.exec("ROLLBACK;");
    } finally {
      writer.close();
    }
  });

  test("temporary startup contention recovers instead of disabling cache for session", async () => {
    const root = await cacheRoot();
    const writer = new Database(join(root, "cache.sqlite"));
    try {
      writer.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");
      const disk = cache(root);
      const sha = "a".repeat(40);
      expect(await disk.read("/repo", sha)).toBeNull();
      writer.exec("ROLLBACK;");
      await Bun.sleep(1_050);
      await disk.write("/repo", { sha, value: "recovered" });
      await disk.writeLog("/repo", sha, "job", "recovered log");
      expect((await disk.read("/repo", sha))?.value).toBe("recovered");
      expect(await disk.readLog("/repo", sha, "job")).toBe("recovered log");
    } finally {
      writer.close();
    }
  });

  test("bad DB is preserved and cache failure doesn't lose live results", async () => {
    const root = await cacheRoot();
    const path = join(root, "cache.sqlite");
    await writeFile(path, "broken database");
    const disk = cache(root);
    clearDebugEvents();
    await disk.write("/repo", { sha: "a".repeat(40), value: "live" });
    expect(await disk.read("/repo", "a".repeat(40))).toBeNull();
    expect(await disk.list("/repo")).toEqual([]);
    expect(await readFile(path, "utf8")).toBe("broken database");
    expect(getDebugEvents().some(event => event.message.startsWith("Provider cache:"))).toBe(true);
  });

  test("stores arbitrary log keys as bound data without creating text files", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    await disk.write("/repo", { sha, value: "parent" });
    const key = "../../escape'; DROP TABLE snapshots; --";
    const log = "line one\n雪 '\"\n".repeat(10_000);
    await disk.writeLog("/repo", sha, key, log);
    expect(await disk.readLog("/repo", sha, key)).toBe(log);
    await disk.writeLog("/repo", sha, key, "updated");
    expect(await disk.readLog("/repo", sha, key)).toBe("updated");
    expect(providerCacheDatabase(root).query("SELECT snapshot_id FROM artifacts").all()).toHaveLength(1);
    closeProviderCaches(root);
    expect(await disk.readLog("/repo", sha, key)).toBe("updated");
    expect(await Bun.file(join(root, "test")).exists()).toBe(false);
    expect(await Bun.file(join(root, "escape")).exists()).toBe(false);
  });

  test("does not read or migrate legacy JSON snapshots or text logs", async () => {
    const root = await cacheRoot();
    const disk = cache(root);
    const sha = "a".repeat(40);
    const hash = createHash("sha256").update(resolve("/repo")).digest("hex");
    const directory = join(root, "test", hash);
    await mkdir(join(directory, "logs"), { recursive: true });
    const path = join(directory, `${sha}.json`);
    await writeFile(path, JSON.stringify({ sha, value: "legacy" }));
    const logPath = join(directory, "logs", `${sha}_job.txt`);
    await writeFile(logPath, "legacy log");
    expect(await disk.read("/repo", sha)).toBeNull();
    await disk.write("/repo", { sha, value: "new" });
    expect(await disk.readLog("/repo", sha, "job")).toBeNull();
    expect(await Bun.file(path).exists()).toBe(true);
    expect(await readFile(logPath, "utf8")).toBe("legacy log");
  });

  test.skipIf(process.platform === "win32")(
    "restricts DB and journal file permissions for snapshots and logs",
    async () => {
      const root = await cacheRoot();
      const disk = cache(root);
      const sha = "a".repeat(40);
      await disk.write("/repo", { sha, value: "n" });
      await disk.writeLog("/repo", sha, "job", "log");
      for (const path of [join(root, "cache.sqlite"), join(root, "cache.sqlite-wal"), join(root, "cache.sqlite-shm")]) {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      }
    },
  );
});

test("mergeById lets incoming values win without dropping other IDs", () => {
  expect(
    mergeById(
      [{ id: "a", n: 1 }],
      [
        { id: "a", n: 2 },
        { id: "b", n: 3 },
      ],
    ),
  ).toEqual([
    { id: "a", n: 2 },
    { id: "b", n: 3 },
  ]);
});
