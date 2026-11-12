import { expect, test } from "bun:test";
import { githubJobLogEntries, githubJobSummary } from "./job-summary";
import type { GitHubJob, GitHubStep } from "./types";

const START = Date.parse("2026-11-10T10:00:00.000Z");
const at = (seconds: number) => new Date(START + seconds * 1000).toISOString();
const step = (number: number, name: string, conclusion: string | null, from: number, seconds: number | null) =>
  ({
    number,
    name,
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    startedAt: at(from),
    completedAt: seconds === null ? null : at(from + seconds),
  }) satisfies GitHubStep;

const test_: GitHubJob = {
  id: 70012,
  name: "test",
  status: "completed",
  conclusion: "failure",
  startedAt: at(0),
  completedAt: at(317),
  steps: [
    step(1, "Set up job", "success", 0, 9),
    step(2, "Run tests", "failure", 9, 90),
    // GitHub gives a skipped step the same start and end.
    step(3, "Upload coverage", "skipped", 99, 0),
  ],
};

test("a GitHub job log starts with its steps: each with its mark and time, none for a skipped one", () => {
  const lines = githubJobSummary(test_);
  expect(lines.map(line => line.text.trimEnd())).toEqual([
    expect.stringMatching(/^STEP\s+DURATION$/),
    expect.stringMatching(/^Set up job\s+9s$/),
    expect.stringMatching(/^Run tests\s+1m 30s$/),
    "Upload coverage",
  ]);
  expect(lines.map(line => line.mark)).toEqual([undefined, "pass", "fail", "skipped"]);
  expect(lines[0].kind).toBe("muted");
  expect(githubJobSummary({ ...test_, steps: [] })).toEqual([]);
});

test("the log entries are the jobs, each with its time for the title; a running job has none", () => {
  const running: GitHubJob = {
    ...test_,
    id: 70013,
    name: "lint",
    status: "in_progress",
    conclusion: null,
    completedAt: null,
  };
  expect(githubJobLogEntries([test_, running])).toEqual([
    { id: 70012, name: "test", detail: "5m 17s" },
    { id: 70013, name: "lint", detail: undefined },
  ]);
});
