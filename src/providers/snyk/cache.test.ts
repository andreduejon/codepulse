import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeProviderCaches, providerCacheDatabase } from "../shared/sha-sqlite-cache";
import { SnykCache } from "./cache";
import type { SnykScanResult } from "./types";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots) closeProviderCaches(root);
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function result(sha: string): SnykScanResult {
  return {
    sha,
    scannedAt: "2026-08-21T10:00:00.000Z",
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
  };
}

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codepulse-snyk-cache-test-"));
  roots.push(root);
  return root;
}

describe("SnykCache", () => {
  test("stores only the normalized scan and reads it back", async () => {
    const cache = new SnykCache({ root: await cacheRoot() });
    const scan = result("a".repeat(40));
    await cache.write("/repo", scan);

    expect(await cache.read("/repo", scan.sha)).toEqual(scan);
    const stored = providerCacheDatabase(cache.root)
      .query<{ payload: string }, []>("SELECT payload FROM snapshots")
      .get();
    expect(Object.keys(JSON.parse(stored?.payload ?? ""))).toEqual(["sha", "scannedAt", "counts", "findings"]);
  });

  test("ignores and deletes corrupt entries", async () => {
    const cache = new SnykCache({ root: await cacheRoot() });
    const sha = "b".repeat(40);
    await cache.write("/repo", result(sha));
    providerCacheDatabase(cache.root).query("UPDATE snapshots SET payload = ?").run(JSON.stringify({ sha }));

    expect(await cache.read("/repo", sha)).toBeNull();
    expect(await cache.list("/repo")).toEqual([]);
  });

  test("evicts the least recently accessed entry", async () => {
    const cache = new SnykCache({ root: await cacheRoot(), maxEntries: 10 });
    const shas = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"));
    for (const [index, sha] of shas.entries()) {
      await cache.write("/repo", result(sha));
      providerCacheDatabase(cache.root)
        .query("UPDATE snapshots SET accessed_at = ? WHERE sha = ?")
        .run(1_700_000_000_000 + index * 1_000, sha);
    }
    await cache.read("/repo", shas[0]);
    const newest = "f".repeat(40);
    await cache.write("/repo", result(newest));

    expect(await cache.read("/repo", shas[0])).not.toBeNull();
    expect(await cache.read("/repo", shas[1])).toBeNull();
    expect(await cache.read("/repo", newest)).not.toBeNull();
  });
});
