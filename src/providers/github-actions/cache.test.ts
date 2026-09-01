import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubCache, isGitHubCacheEntry } from "./cache";
import type { GitHubJob, GitHubWorkflowRun } from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function run(sha: string, id = 1): GitHubWorkflowRun {
  return {
    id,
    name: "ci",
    status: "completed",
    conclusion: "success",
    headSha: sha,
    event: "push",
    runNumber: 1,
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function job(id = 11): GitHubJob {
  return {
    id,
    name: "test",
    status: "completed",
    conclusion: "success",
    startedAt: null,
    completedAt: null,
    steps: [
      {
        name: "Checkout",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: null,
        completedAt: null,
      },
    ],
  };
}

describe("GitHubCache", () => {
  test("round-trips terminal runs with jobs", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepulse-github-cache-test-"));
    roots.push(root);
    const cache = new GitHubCache({ root });
    const sha = "e".repeat(40);
    const entry = { sha, runs: [run(sha)], jobs: { "1": [job()] } };
    await cache.write("/repo", entry);
    expect(await cache.read("/repo", sha)).toEqual(entry);
  });

  test("accepts legacy run-only snapshots", () => {
    expect(isGitHubCacheEntry({ sha: "f".repeat(40), runs: [run("f".repeat(40))] })).toBe(true);
  });

  test("rejects invalid snapshots", () => {
    expect(isGitHubCacheEntry({ sha: "x", runs: [{ id: "nope" }] })).toBe(false);
    expect(isGitHubCacheEntry({ sha: "f".repeat(40), runs: [run("f".repeat(40))], jobs: [] })).toBe(false);
  });
});
