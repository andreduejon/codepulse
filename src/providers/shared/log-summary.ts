import { formatDuration } from "../../utils/date";
import type { JobLogSummaryLine } from "./job-log-dialog";
import { categorize } from "./status";

/** A Jenkins stage or a GitHub step: what a log's summary lists. */
export interface TimedStep {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** A step's time; none while it runs, and none when skipped (it never ran; GitHub gives it the same start and end). */
export function stepTime(step: Omit<TimedStep, "name">): string {
  if (categorize(step.status, step.conclusion) === "skipped") return "";
  return formatDuration(step.startedAt, step.completedAt);
}

/**
 * The top of a log in the viewer: a muted `STAGE  DURATION` (or `STEP`) header, then each step with its mark and
 * time. The marks go in the line number column, so the names start where the log text does. Empty without steps.
 */
export function stepsSummary(heading: string, steps: readonly TimedStep[]): JobLogSummaryLine[] {
  if (steps.length === 0) return [];
  const rows = steps.map(step => ({
    name: step.name,
    time: stepTime(step),
    mark: categorize(step.status, step.conclusion),
  }));
  const nameWidth = Math.max(heading.length, ...rows.map(row => row.name.length));
  const timeWidth = Math.max("DURATION".length, ...rows.map(row => row.time.length));
  const line = (name: string, time: string) => `${name.padEnd(nameWidth)}  ${time.padStart(timeWidth)}`;
  return [
    { text: line(heading, "DURATION"), kind: "muted" },
    ...rows.map(row => ({
      text: row.time ? line(row.name, row.time) : row.name,
      kind: "normal" as const,
      mark: row.mark,
    })),
  ];
}
