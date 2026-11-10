import { expect, test } from "bun:test";
import { JENKINS_WHOLE_BUILD, jenkinsBuildSummary, jenkinsLogEntries } from "./build-summary";
import type { JenkinsJob, JenkinsStage } from "./types";

const START = Date.parse("2026-11-10T10:00:00.000Z");
const at = (seconds: number) => new Date(START + seconds * 1000).toISOString();
const stage = (id: string, name: string, conclusion: string | null, from: number, seconds: number | null) =>
  ({
    id,
    name,
    status: conclusion === null ? "running" : "completed",
    conclusion,
    startedAt: at(from),
    completedAt: seconds === null ? null : at(from + seconds),
  }) satisfies JenkinsStage;

const pipeline: JenkinsJob = {
  id: "main#41",
  name: "Pipeline",
  status: "completed",
  conclusion: "failure",
  startedAt: at(0),
  completedAt: at(309),
  steps: [
    stage("1", "Checkout", "success", 0, 4),
    stage("2", "Unit tests", "failure", 4, 210),
    stage("3", "Publish image to the internal registry", "skipped", 214, 0),
  ],
  tests: { passCount: 1204, failCount: 3, skipCount: 12, failed: [] },
};

test("the whole build's summary: each stage with its mark and time, then the test counts", () => {
  const lines = jenkinsBuildSummary(pipeline);
  expect(lines.map(line => line.text.trimEnd())).toEqual([
    expect.stringMatching(/^ {2}STAGE\s+DURATION$/),
    expect.stringMatching(/^Checkout\s+4s$/),
    expect.stringMatching(/^Unit tests\s+3m 30s$/),
    // Skipped: no time.
    "Publish image to the internal registry",
    "Tests  3 failed · 1,204 passed · 12 skipped",
  ]);
  expect(lines.map(line => line.mark)).toEqual([undefined, "pass", "fail", "skipped", "fail"]);
  expect(lines.map(line => line.kind)).toEqual(["muted", "normal", "normal", "normal", "normal"]);
  // Times end under DURATION; names line up under STAGE (the mark takes the first two columns).
  const [header, checkout, unit] = lines.map(line => line.text);
  expect(checkout.length + 2).toBe(header.length);
  expect(unit.length + 2).toBe(header.length);
});

test("a running build's summary marks the running stage; a build without stages or report has none", () => {
  const running = jenkinsBuildSummary({
    ...pipeline,
    status: "running",
    conclusion: null,
    completedAt: null,
    steps: [stage("1", "Checkout", "success", 0, 4), stage("2", "Build", null, 4, null)],
    tests: undefined,
  });
  expect(running.map(line => line.mark)).toEqual([undefined, "pass", "running"]);
  expect(running.at(-1)?.text.trimEnd()).toBe("Build");
  expect(jenkinsBuildSummary({ ...pipeline, steps: [], tests: undefined })).toEqual([]);
});

test("the log entries: the whole build first, then each stage, each with its time", () => {
  expect(jenkinsLogEntries(pipeline)).toEqual([
    { id: "build", name: JENKINS_WHOLE_BUILD, detail: "5m 09s" },
    { id: "stage:1", name: "Checkout", detail: "4s" },
    { id: "stage:2", name: "Unit tests", detail: "3m 30s" },
    { id: "stage:3", name: "Publish image to the internal registry", detail: undefined },
  ]);
});
