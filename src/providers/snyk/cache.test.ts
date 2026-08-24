import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnykCache } from "./cache";
import type { SnykScanResult } from "./types";

const roots: string[] = [];

afterEach(async () => {
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
    const stored = await readFile(await cache.pathFor("/repo", scan.sha), "utf8");
    expect(Object.keys(JSON.parse(stored))).toEqual(["sha", "scannedAt", "counts", "findings"]);
  });

  test("ignores and deletes corrupt entries", async () => {
    const cache = new SnykCache({ root: await cacheRoot() });
    const sha = "b".repeat(40);
    const path = await cache.pathFor("/repo", sha);
    await cache.write("/repo", result(sha));
    await writeFile(path, "not-json");

    expect(await cache.read("/repo", sha)).toBeNull();
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("evicts the least recently accessed entry", async () => {
    const cache = new SnykCache({ root: await cacheRoot(), maxEntries: 10 });
    const shas = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"));
    for (const [index, sha] of shas.entries()) {
      await cache.write("/repo", result(sha));
      const accessedAt = new Date(1_700_000_000_000 + index * 1_000);
      await utimes(await cache.pathFor("/repo", sha), accessedAt, accessedAt);
    }
    await cache.read("/repo", shas[0]);
    const newest = "f".repeat(40);
    await cache.write("/repo", result(newest));

    expect(await cache.read("/repo", shas[0])).not.toBeNull();
    expect(await cache.read("/repo", shas[1])).toBeNull();
    expect(await cache.read("/repo", newest)).not.toBeNull();
  });
});
