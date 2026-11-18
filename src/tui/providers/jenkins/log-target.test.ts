import { expect, mock, test } from "bun:test";
import type { JenkinsFailedTest, JenkinsJob, JenkinsRun } from "../../../core/jenkins/types";
import { jenkinsBuildLogTarget, jenkinsTestFailureTarget } from "./log-target";

/** The log dialog's download signal: the targets pass it to every request. */
const signal = new AbortController().signal;

const run = {
  id: "main#41",
  name: "main",
  runNumber: 41,
  url: "https://jenkins.invalid/job/shop/job/main/41/",
} as JenkinsRun;
const pipeline: JenkinsJob = {
  id: "main#41",
  name: "Pipeline",
  status: "completed",
  conclusion: "failure",
  startedAt: "2026-11-10T10:00:00.000Z",
  completedAt: "2026-11-10T10:05:09.000Z",
  steps: [
    {
      id: "1",
      name: "Unit tests",
      status: "completed",
      conclusion: "failure",
      startedAt: "2026-11-10T10:00:00.000Z",
      completedAt: "2026-11-10T10:03:30.000Z",
    },
  ],
};
const console_ = ["Started", "[Pipeline] { (Unit tests)", "+ ./gradlew test", "[Pipeline] }", "Finished"].join("\n");

test("a Jenkins build opens at an entry: the full log with its summary, or a stage's part of the console", async () => {
  const ci = {
    fetchRunLog: mock(async () => console_),
    fetchJobsForRun: mock(async () => ({ jobs: [pipeline], error: null })),
  };
  const target = jenkinsBuildLogTarget(ci, run, pipeline, 1);
  expect(target).toMatchObject({ provider: "jenkins", noun: "stage" });
  expect(target.job).toMatchObject({ name: "Unit tests", detail: "3m 30s" });
  expect(await target.fetchLog(target.job, signal)).toBe("[Pipeline] { (Unit tests)\n+ ./gradlew test\n[Pipeline] }");
  const full = await target.fetchLog(target.jobs[0], signal);
  expect(full).toMatchObject({ log: console_ });
  expect(typeof full === "string" ? [] : full.summary?.length).toBe(2);
  expect(ci.fetchRunLog).toHaveBeenCalledWith(run, signal);
  expect(ci.fetchJobsForRun).toHaveBeenCalledWith(run, signal);
});

test("a stage in a parallel branch, or one the console lacks, opens the full log with a line that says so", async () => {
  const parallel = [
    "[Pipeline] parallel",
    "[Pipeline] { (Branch: Unit tests)",
    "[Pipeline] { (Branch: Lint)",
    "[Pipeline] { (Unit tests)",
    "[Pipeline] { (Lint)",
    "+ ./gradlew test",
    "+ ./gradlew lint",
  ].join("\n");
  const ci = {
    fetchRunLog: mock(async () => parallel),
    fetchJobsForRun: mock(async () => ({ jobs: [pipeline], error: null })),
  };
  const target = jenkinsBuildLogTarget(ci, run, pipeline, 1);
  expect(await target.fetchLog(target.job, signal)).toEqual({
    log: parallel,
    note: "Runs in parallel: the full log, with the other branches' lines",
  });
  ci.fetchRunLog.mockImplementation(async () => "Started\nFinished");
  expect(await target.fetchLog(target.job, signal)).toEqual({
    log: "Started\nFinished",
    note: "Not in the log yet: the full log",
  });
});

test("a finished build's console is read once for all its stages; a failed read is tried again", async () => {
  const finished = { ...run, status: "completed", conclusion: "failure" } as JenkinsRun;
  const ci = {
    fetchRunLog: mock(async (): Promise<string> => {
      throw new Error("Jenkins is unreachable");
    }),
    fetchJobsForRun: mock(async () => ({ jobs: [pipeline], error: null })),
  };
  const target = jenkinsBuildLogTarget(ci, finished, pipeline, 1);
  await expect(target.fetchLog(target.job, signal)).rejects.toThrow("Jenkins is unreachable");
  ci.fetchRunLog.mockImplementation(async () => console_);
  expect(await target.fetchLog(target.job, signal)).toBe("[Pipeline] { (Unit tests)\n+ ./gradlew test\n[Pipeline] }");
  expect(await target.fetchLog(target.jobs[0], signal)).toMatchObject({ log: console_ });
  expect(await target.fetchLog(target.job, signal)).toBe("[Pipeline] { (Unit tests)\n+ ./gradlew test\n[Pipeline] }");
  expect(ci.fetchRunLog).toHaveBeenCalledTimes(2);
});

test("a failed Jenkins test opens its error and stack; o opens the test report; no failed tests open nothing", async () => {
  const failed: JenkinsFailedTest[] = [
    { className: "com.demo.CartTest", name: "rounds", details: "expected 9.99", stackTrace: "at CartTest" },
  ];
  const target = jenkinsTestFailureTarget(run, failed, 0);
  expect(target).toMatchObject({ noun: "test", job: { name: "CartTest › rounds" } });
  expect(target?.run.url).toBe("https://jenkins.invalid/job/shop/job/main/41/testReport/");
  expect(await target?.fetchLog(target.job, signal)).toBe("com.demo.CartTest › rounds\nexpected 9.99\n\nat CartTest");
  expect(jenkinsTestFailureTarget(run, [], 0)).toBeNull();
});
