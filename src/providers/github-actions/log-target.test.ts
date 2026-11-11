import { expect, mock, test } from "bun:test";
import { githubJobLogTarget } from "./log-target";
import type { GitHubJob, GitHubWorkflowRun } from "./types";

const run = { id: 9001, name: "CI", runNumber: 812, headSha: "a".repeat(40), status: "completed" } as GitHubWorkflowRun;
const job = (id: number, name: string): GitHubJob => ({
  id,
  name,
  status: "completed",
  conclusion: "success",
  startedAt: "2026-11-10T10:00:00.000Z",
  completedAt: "2026-11-10T10:02:17.000Z",
  steps: [
    {
      number: 1,
      name: "Build",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-11-10T10:00:00.000Z",
      completedAt: "2026-11-10T10:02:17.000Z",
    },
  ],
});

test("a GitHub job log opens at its job, ←/→ to the run's jobs, and reads its steps again with the log", async () => {
  const build = job(1, "build");
  const testJob = job(2, "test");
  const ci = {
    fetchJobLogForJob: mock(async (id: number) => `log of ${id}`),
    fetchJobsForRun: mock(async () => ({ jobs: [build, { ...testJob, name: "test (fresh)" }], error: null })),
  };
  const target = githubJobLogTarget(ci, testJob, run, [build, testJob], "Expected 200");
  expect(target.provider).toBe("github-actions");
  expect(target.job).toEqual({ id: 2, name: "test", detail: "2m 17s" });
  expect(target.jobs.map(entry => entry.name)).toEqual(["build", "test"]);
  expect(target.search).toBe("Expected 200");
  const content = await target.fetchLog(target.job);
  expect(content).toMatchObject({ log: "log of 2" });
  expect(typeof content === "string" ? [] : content.summary?.map(line => line.text.trimEnd())).toEqual([
    expect.stringMatching(/^STEP/),
    expect.stringMatching(/^Build\s+2m 17s$/),
  ]);
  expect(ci.fetchJobLogForJob).toHaveBeenCalledWith(2, run);
});

test("a job that was running when its log opened gets its time once r reads it again finished", async () => {
  const running = { ...job(2, "test"), status: "in_progress", conclusion: null, completedAt: null };
  const ci = {
    fetchJobLogForJob: mock(async () => "log"),
    fetchJobsForRun: mock(async () => ({ jobs: [job(2, "test")], error: null })),
  };
  const target = githubJobLogTarget(ci, running, run, [running]);
  expect(target.job.detail).toBeUndefined();
  expect(await target.fetchLog(target.job)).toMatchObject({ detail: "2m 17s" });
});
