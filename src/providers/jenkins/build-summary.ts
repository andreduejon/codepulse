import { formatDuration } from "../../utils/date";
import type { JobLogSummaryLine } from "../github-actions/log-dialog";
import { stepsSummary, stepTime } from "../shared/log-summary";
import type { JenkinsJob, JenkinsTestReport } from "./types";

/** The log viewer's first entry for a build, before its stages: the summary, then the whole console. */
export const JENKINS_FULL_LOG = "full log";
const WHOLE_BUILD_ID = "build";

export interface JenkinsLogEntry {
  id: string;
  name: string;
  /** Its time, after the name in the dialog title. */
  detail?: string;
  /** How the footer names it as the arrow's target (`← full log`). */
  navLabel?: string;
}

export const isWholeBuildEntry = (entry: { id: string | number }) => entry.id === WHOLE_BUILD_ID;

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
      name: JENKINS_FULL_LOG,
      detail: formatDuration(pipeline.startedAt, pipeline.completedAt) || undefined,
      navLabel: JENKINS_FULL_LOG,
    },
    ...pipeline.steps.map(stage => ({
      id: `stage:${stage.id}`,
      name: stage.name,
      detail: stepTime(stage) || undefined,
    })),
  ];
}

/**
 * What the tree leaves out, above the whole console: each stage with its mark and time (`STAGE  DURATION`), then the
 * test counts. Empty for a build without stages or test report.
 */
export function jenkinsBuildSummary(pipeline: JenkinsJob): JobLogSummaryLine[] {
  const lines = stepsSummary("STAGE", pipeline.steps);
  if (pipeline.tests)
    lines.push({
      text: ["Tests", jenkinsTestCounts(pipeline.tests)].filter(Boolean).join("  "),
      kind: "normal",
      mark: pipeline.tests.failCount > 0 ? "fail" : "pass",
    });
  return lines;
}
