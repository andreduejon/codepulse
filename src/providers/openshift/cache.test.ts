import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeProviderCaches, providerCacheDatabase } from "../shared/sha-sqlite-cache";
import { mergeById, OpenShiftCache, type OpenShiftCacheEntry } from "./cache";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots) closeProviderCaches(root);
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function entry(sha: string, name = "build-1"): OpenShiftCacheEntry {
  return {
    sha,
    builds: [
      {
        id: `Build:ns:${name}`,
        name,
        namespace: "ns",
        status: "pass",
        imageRefs: ["sha256:abc"],
        commitSha: sha,
      },
    ],
  };
}

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codepulse-openshift-cache-test-"));
  roots.push(root);
  return root;
}

describe("mergeById", () => {
  test("keeps existing ids and lets incoming win on conflict", () => {
    const existing = [
      { id: "a", name: "old-a" },
      { id: "b", name: "keep-b" },
    ];
    const incoming = [
      { id: "a", name: "new-a" },
      { id: "c", name: "new-c" },
    ];
    expect(mergeById(existing, incoming)).toEqual([
      { id: "a", name: "new-a" },
      { id: "b", name: "keep-b" },
      { id: "c", name: "new-c" },
    ]);
  });
});

describe("OpenShiftCache", () => {
  test("stores builds and roundtrips the API object", async () => {
    const cache = new OpenShiftCache({ root: await cacheRoot() });
    const snapshot = entry("a".repeat(40));
    snapshot.builds[0].object = { kind: "Build", metadata: { name: "build-1" } };
    await cache.write("/repo", snapshot);

    expect(await cache.read("/repo", snapshot.sha)).toEqual({ ...snapshot, sha: snapshot.sha.toLowerCase() });
    const row = providerCacheDatabase(cache.root).query<{ payload: string }, []>("SELECT payload FROM snapshots").get();
    const stored = JSON.parse(row?.payload ?? "");
    expect(Object.keys(stored)).toEqual(["sha", "builds"]);
    expect(stored.builds[0].object).toEqual({ kind: "Build", metadata: { name: "build-1" } });
  });

  test("ignores and deletes corrupt entries", async () => {
    const cache = new OpenShiftCache({ root: await cacheRoot() });
    const sha = "b".repeat(40);
    await cache.write("/repo", entry(sha));
    providerCacheDatabase(cache.root).query("UPDATE snapshots SET payload = ?").run(JSON.stringify({ sha }));

    expect(await cache.read("/repo", sha)).toBeNull();
    expect(await cache.list("/repo")).toEqual([]);
  });

  test("evicts least recently accessed SHA and its logs", async () => {
    const cache = new OpenShiftCache({ root: await cacheRoot(), maxEntries: 10 });
    const shas = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"));
    for (const [index, sha] of shas.entries()) {
      await cache.write("/repo", entry(sha));
      await cache.writeLog("/repo", sha, "ns", "build-1", "log");
      providerCacheDatabase(cache.root)
        .query("UPDATE snapshots SET accessed_at = ? WHERE sha = ?")
        .run(1_700_000_000_000 + index * 1_000, sha);
    }
    await cache.read("/repo", shas[0]);
    const newest = "f".repeat(40);
    await cache.write("/repo", entry(newest));

    expect(await cache.read("/repo", shas[0])).not.toBeNull();
    expect(await cache.read("/repo", shas[1])).toBeNull();
    expect(await cache.readLog("/repo", shas[1], "ns", "build-1")).toBeNull();
    expect(await cache.read("/repo", newest)).not.toBeNull();
  });

  test("lists cached commit SHAs", async () => {
    const cache = new OpenShiftCache({ root: await cacheRoot() });
    const sha = "c".repeat(40);
    await cache.write("/repo", entry(sha));
    expect(await cache.list("/repo")).toEqual([sha]);
    expect(await cache.list("/other")).toEqual([]);
  });
});
