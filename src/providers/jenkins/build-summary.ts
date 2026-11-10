import { formatDuration } from "../../utils/date";
import type { JobLogSummaryLine } from "../github-actions/log-dialog";
import { categorize } from "../shared/status";
import type { JenkinsJob, JenkinsStage, JenkinsTestReport } from "./types";

/** The log viewer's first entry for a build, before its stages: the summary, then the whole console. */
export const JENKINS_WHOLE_BUILD = "whole build";
const WHOLE_BUILD_ID = "build";

export interface JenkinsLogEntry {
  id: string;
  name: string;
  /** Its time, after the name in the dialog title. */
  detail?: string;
}

export const isWholeBuildEntry = (entry: { id: string | number }) => entry.id === WHOLE_BUILD_ID;

/** A stage's time; a skipped stage never ran, so it has none. */
function stageTime(stage: JenkinsStage): string {
  if (categorize(stage.status, stage.conclusion) === "skipped") return "";
  return formatDuration(stage.startedAt, stage.completedAt);
}

const count = (value: number) => value.toLocaleString("en-US");

/** `3 failed · 1,204 passed · 12 skipped`, leaving out the zeros. */
export function jenkinsTestCounts(report: JenkinsTestReport): string {
  return [
    report.failCount > 0 ? `${count(report.failCount)} failed` : "",
    report.passCount > 0 ? `${count(report.passCount)} passed` : "",
    report.skipCount > 0 ? `${count(report.skipCount)} skipped` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The log viewer's entries for a build: the whole build, then each stage, each with its time for the title. */
export function jenkinsLogEntries(pipeline: JenkinsJob): JenkinsLogEntry[] {
  return [
    {
      id: WHOLE_BUILD_ID,
      name: JENKINS_WHOLE_BUILD,
      detail: formatDuration(pipeline.startedAt, pipeline.completedAt) || undefined,
    },
    ...pipeline.steps.map(stage => ({
      id: `stage:${stage.id}`,
      name: stage.name,
      detail: stageTime(stage) || undefined,
    })),
  ];
}

/**
 * What the tree leaves out, above the whole console: each stage with its mark and time (`STAGE  DURATION`), then the
 * test counts. Empty for a build without stages or test report.
 */
export function jenkinsBuildSummary(pipeline: JenkinsJob): JobLogSummaryLine[] {
  const rows = pipeline.steps.map(stage => ({
    name: stage.name,
    time: stageTime(stage),
    mark: categorize(stage.status, stage.conclusion),
  }));
  const nameWidth = Math.max("STAGE".length, ...rows.map(row => row.name.length));
  const timeWidth = Math.max("DURATION".length, ...rows.map(row => row.time.length));
  const line = (name: string, time: string) => `${name.padEnd(nameWidth)}  ${time.padStart(timeWidth)}`;
  const lines: JobLogSummaryLine[] = [];
  if (rows.length > 0) {
    // The marks take the first two columns of the rows below.
    lines.push({ text: `  ${line("STAGE", "DURATION")}`, kind: "muted" });
    for (const row of rows)
      lines.push({ text: row.time ? line(row.name, row.time) : row.name, kind: "normal", mark: row.mark });
  }
  if (pipeline.tests)
    lines.push({
      text: ["Tests", jenkinsTestCounts(pipeline.tests)].filter(Boolean).join("  "),
      kind: "normal",
      mark: pipeline.tests.failCount > 0 ? "fail" : "pass",
    });
  return lines;
}
