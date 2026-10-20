import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeProviderCaches, providerCacheDatabase } from "../shared/sha-sqlite-cache";
import { SnykCache } from "./cache";
import { isSnykScanResult } from "./parser";
import type { SnykDependencyGraph, SnykScanResult } from "./types";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots) closeProviderCaches(root);
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function result(sha: string): SnykScanResult {
  return {
    sha,
    scannedAt: "2026-08-21T10:00:00.000Z",
    includesDev: true,
    dependencyProjects: [],
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
  };
}

function dependencyGraph(targetFile = "yarn.lock", packageManager = "yarn"): SnykDependencyGraph {
  return {
    targetFile,
    packageManager,
    rootNodeId: "root",
    packages: [
      { id: "fixture@", name: "fixture", version: null },
      { id: "dependency@1.0.0", name: "dependency", version: "1.0.0" },
    ],
    nodes: [
      {
        nodeId: "root",
        pkgId: "fixture@",
        deps: ["dependency", "dependency:pruned"],
        scope: "unknown",
        referenceNodeId: null,
      },
      { nodeId: "dependency", pkgId: "dependency@1.0.0", deps: [], scope: "prod", referenceNodeId: null },
      { nodeId: "dependency:pruned", pkgId: "dependency@1.0.0", deps: [], scope: "dev", referenceNodeId: "dependency" },
    ],
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
    expect(Object.keys(JSON.parse(stored?.payload ?? ""))).toEqual([
      "sha",
      "scannedAt",
      "includesDev",
      "dependencyProjects",
      "counts",
      "findings",
    ]);
  });

  test("round-trips findings and dependency graphs with every project status in one snapshot", async () => {
    const cache = new SnykCache({ root: await cacheRoot() });
    const scan: SnykScanResult = {
      ...result("a".repeat(40)),
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      findings: [
        {
          id: "SNYK-FIXTURE-1",
          title: "Fixture finding",
          severity: "high",
          dependency: "dependency",
          installedVersion: "1.0.0",
          fixedVersion: "2.0.0",
          fixedIn: ["2.0.0"],
          exploit: "Mature",
          cvssScore: 9.8,
          project: "fixture",
          targetFile: "bun.lock",
        },
      ],
      dependencyProjects: [
        { targetFile: "bun.lock", packageManager: "bun", status: "scanned", graphs: [dependencyGraph()], reason: null },
        {
          targetFile: "packages/legacy/yarn.lock",
          packageManager: "yarn",
          status: "skipped",
          graphs: [],
          reason: "Unsupported lockfile version",
        },
        {
          targetFile: "packages/app/pnpm-lock.yaml",
          packageManager: "pnpm",
          status: "failed",
          graphs: [dependencyGraph("packages/app/pnpm-lock.yaml", "pnpm")],
          reason: "One workspace graph failed",
        },
        {
          targetFile: "packages/broken/yarn.lock",
          packageManager: "yarn",
          status: "failed",
          graphs: [],
          reason: "Graph command failed",
        },
      ],
    };
    await cache.write("/repo", scan);

    expect(await cache.read("/repo", scan.sha)).toEqual(scan);
    expect(
      providerCacheDatabase(cache.root).query<{ count: number }, []>("SELECT COUNT(*) AS count FROM snapshots").get()
        ?.count,
    ).toBe(1);
  });

  test.each(["includesDev", "dependencyProjects", "both"])(
    "rejects and deletes old entries missing %s",
    async missing => {
      const cache = new SnykCache({ root: await cacheRoot() });
      const scan = result("a".repeat(40));
      await cache.write("/repo", scan);
      const old: Record<string, unknown> = { ...scan };
      if (missing !== "dependencyProjects") delete old.includesDev;
      if (missing !== "includesDev") delete old.dependencyProjects;
      providerCacheDatabase(cache.root).query("UPDATE snapshots SET payload = ?").run(JSON.stringify(old));

      expect(await cache.read("/repo", scan.sha)).toBeNull();
      expect(await cache.list("/repo")).toEqual([]);
    },
  );

  test("rejects malformed normalized graphs on write and deletes malformed cached graphs on read", async () => {
    const cache = new SnykCache({ root: await cacheRoot() });
    const scan = result("a".repeat(40));
    scan.dependencyProjects = [
      { targetFile: "bun.lock", packageManager: "bun", status: "scanned", graphs: [dependencyGraph()], reason: null },
    ];
    await cache.write("/repo", scan);
    scan.dependencyProjects[0].graphs[0].nodes[1].deps = ["missing"];
    providerCacheDatabase(cache.root).query("UPDATE snapshots SET payload = ?").run(JSON.stringify(scan));

    await expect(cache.write("/repo", scan)).rejects.toThrow("Cannot cache an invalid Snyk scan result.");
    expect(await cache.read("/repo", scan.sha)).toBeNull();
    expect(await cache.list("/repo")).toEqual([]);
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

describe("dependency project cache validation", () => {
  test("rejects graphs for the wrong manager or project and duplicate project coverage", () => {
    const scan = result("a".repeat(40));
    const project = {
      targetFile: "packages/app/bun.lock",
      packageManager: "bun",
      status: "scanned",
      graphs: [dependencyGraph("packages/app/yarn.lock")],
      reason: null,
    };
    expect(
      isSnykScanResult({
        ...scan,
        dependencyProjects: [{ ...project, graphs: [dependencyGraph("packages/app/yarn.lock", "npm")] }],
      }),
    ).toBe(false);
    expect(
      isSnykScanResult({
        ...scan,
        dependencyProjects: [{ ...project, graphs: [dependencyGraph("packages/other/yarn.lock")] }],
      }),
    ).toBe(false);
    expect(isSnykScanResult({ ...scan, dependencyProjects: [project, project] })).toBe(false);
  });

  test.each([
    { targetFile: "/private/fixture/bun.lock" },
    { targetFile: "../bun.lock" },
    { targetFile: "./bun.lock" },
    { targetFile: "packages\\app\\bun.lock" },
    { targetFile: "" },
    { packageManager: "npm" },
    { packageManager: null },
    { status: "unknown", reason: "not supported" },
    { status: "scanned", graphs: [] },
    { status: "scanned", reason: "unexpected" },
    { status: "skipped", reason: "not supported" },
    { status: "skipped", graphs: [], reason: " " },
    { status: "failed", reason: null },
    { status: "failed", reason: " " },
    { status: "failed", reason: "failed", graphs: [{}] },
    { graphs: null },
  ])("rejects invalid project targets, statuses, reasons or graphs (%#)", fields => {
    const scan = result("a".repeat(40));
    const project = {
      targetFile: "bun.lock",
      packageManager: "bun",
      status: "scanned",
      graphs: [dependencyGraph()],
      reason: null,
      ...fields,
    };
    expect(isSnykScanResult({ ...scan, dependencyProjects: [project] })).toBe(false);
  });
});
