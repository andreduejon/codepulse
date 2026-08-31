import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeById, OpenShiftCache, type OpenShiftCacheEntry } from "./cache";

const roots: string[] = [];

afterEach(async () => {
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
    const stored = JSON.parse(await readFile(await cache.pathFor("/repo", snapshot.sha), "utf8"));
    expect(Object.keys(stored)).toEqual(["sha", "builds"]);
    expect(stored.builds[0].object).toEqual({ kind: "Build", metadata: { name: "build-1" } });
  });

  test("ignores and deletes corrupt entries", async () => {
    const cache = new OpenShiftCache({ root: await cacheRoot() });
    const sha = "b".repeat(40);
    const path = await cache.pathFor("/repo", sha);
    await cache.write("/repo", entry(sha));
    await writeFile(path, "not-json");

    expect(await cache.read("/repo", sha)).toBeNull();
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("evicts least recently accessed SHA and its logs", async () => {
    const cache = new OpenShiftCache({ root: await cacheRoot(), maxEntries: 10 });
    const shas = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"));
    for (const [index, sha] of shas.entries()) {
      await cache.write("/repo", entry(sha));
      await cache.writeLog("/repo", sha, "ns", "build-1", "log");
      const accessedAt = new Date(1_700_000_000_000 + index * 1_000);
      await utimes(await cache.pathFor("/repo", sha), accessedAt, accessedAt);
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
