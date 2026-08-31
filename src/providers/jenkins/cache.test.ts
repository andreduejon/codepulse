import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isJenkinsCacheEntry, JenkinsCache } from "./cache";
import type { JenkinsJob, JenkinsRun } from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function run(sha: string, id = "job#1"): JenkinsRun {
  return {
    id,
    name: "job",
    status: "completed",
    conclusion: "success",
    headSha: sha,
    runNumber: 1,
    startedAt: null,
    updatedAt: "2026-08-31T00:00:00.000Z",
    url: "https://jenkins.example.com/job/job/1",
    jobLabel: "job",
    jobUrl: "https://jenkins.example.com/job/job",
  };
}

function job(id = "job#1"): JenkinsJob {
  return {
    id,
    name: "Pipeline",
    status: "completed",
    conclusion: "success",
    startedAt: null,
    completedAt: null,
    steps: [
      {
        id: "1",
        name: "Build",
        status: "completed",
        conclusion: "success",
        startedAt: null,
        completedAt: null,
      },
    ],
  };
}

describe("JenkinsCache", () => {
  test("round-trips terminal runs with stages", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepulse-jenkins-cache-test-"));
    roots.push(root);
    const cache = new JenkinsCache({ root });
    const sha = "c".repeat(40);
    const entry = { sha, runs: [run(sha)], jobs: { "job#1": [job()] } };
    await cache.write("/repo", entry);
    expect(await cache.read("/repo", sha)).toEqual(entry);
  });

  test("accepts legacy run-only snapshots", () => {
    expect(isJenkinsCacheEntry({ sha: "d".repeat(40), runs: [run("d".repeat(40))] })).toBe(true);
  });

  test("rejects invalid snapshots", () => {
    expect(isJenkinsCacheEntry({ sha: "x", runs: [{ id: 1 }] })).toBe(false);
    expect(isJenkinsCacheEntry({ sha: "d".repeat(40), runs: [run("d".repeat(40))], jobs: [] })).toBe(false);
    expect(
      isJenkinsCacheEntry({
        sha: "d".repeat(40),
        runs: [run("d".repeat(40))],
        jobs: { "job#1": [{ id: "job#1" }] },
      }),
    ).toBe(false);
  });
});
