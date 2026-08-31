import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeById, ShaJsonCache } from "./sha-json-cache";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

interface Entry {
  sha: string;
  value: string;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Entry;
  return typeof entry.sha === "string" && typeof entry.value === "string";
}

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codepulse-sha-cache-test-"));
  roots.push(root);
  return root;
}

describe("ShaJsonCache", () => {
  test("stores and reads a SHA entry", async () => {
    const cache = new ShaJsonCache<Entry>({
      root: await cacheRoot(),
      isEntry,
      invalidMessage: "bad",
    });
    const sha = "a".repeat(40);
    await cache.write("/repo", { sha, value: "ok" });
    expect(await cache.read("/repo", sha)).toEqual({ sha, value: "ok" });
    const stored = JSON.parse(await readFile(await cache.pathFor("/repo", sha), "utf8"));
    expect(stored).toEqual({ sha, value: "ok" });
  });

  test("ignores and deletes corrupt entries", async () => {
    const cache = new ShaJsonCache<Entry>({
      root: await cacheRoot(),
      isEntry,
      invalidMessage: "bad",
    });
    const sha = "b".repeat(40);
    await cache.write("/repo", { sha, value: "ok" });
    const path = await cache.pathFor("/repo", sha);
    await writeFile(path, "not-json");
    expect(await cache.read("/repo", sha)).toBeNull();
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("evicts the least recently accessed entry", async () => {
    const cache = new ShaJsonCache<Entry>({
      root: await cacheRoot(),
      maxEntries: 10,
      isEntry,
      invalidMessage: "bad",
    });
    const shas = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"));
    for (const [index, sha] of shas.entries()) {
      await cache.write("/repo", { sha, value: "n" });
      const accessedAt = new Date(1_700_000_000_000 + index * 1_000);
      await utimes(await cache.pathFor("/repo", sha), accessedAt, accessedAt);
    }
    await cache.read("/repo", shas[0]);
    const newest = "f".repeat(40);
    await cache.write("/repo", { sha: newest, value: "new" });
    expect(await cache.read("/repo", shas[0])).not.toBeNull();
    expect(await cache.read("/repo", shas[1])).toBeNull();
    expect(await cache.read("/repo", newest)).not.toBeNull();
  });

  test("stores logs and evicts them with the SHA", async () => {
    const cache = new ShaJsonCache<Entry>({
      root: await cacheRoot(),
      maxEntries: 10,
      isEntry,
      invalidMessage: "bad",
    });
    const shas = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"));
    for (const [index, sha] of shas.entries()) {
      await cache.write("/repo", { sha, value: "n" });
      await cache.writeLog("/repo", sha, "job-1", "log-body");
      const accessedAt = new Date(1_700_000_000_000 + index * 1_000);
      await utimes(await cache.pathFor("/repo", sha), accessedAt, accessedAt);
    }
    await cache.read("/repo", shas[0]);
    const newest = "f".repeat(40);
    await cache.write("/repo", { sha: newest, value: "new" });

    expect(await cache.readLog("/repo", shas[0], "job-1")).toBe("log-body");
    expect(await cache.readLog("/repo", shas[1], "job-1")).toBeNull();
    expect(await cache.read("/repo", shas[1])).toBeNull();
  });
});

describe("mergeById", () => {
  test("incoming wins on id conflict", () => {
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
});
