import { formatDuration } from "../../core/duration";
import type { GitHubJob } from "../../core/github/types";
import type { JobLogEntry, JobLogSummaryLine } from "../shared/job-log-dialog";
import { stepsSummary } from "../shared/log-summary";

/** The top of a job's log in the viewer: each step with its mark and time (the tree shows only the marks). */
export function githubJobSummary(job: GitHubJob): JobLogSummaryLine[] {
  return stepsSummary("STEP", job.steps);
}

/** The log viewer's entries for a run's jobs, each with its time for the title. */
export function githubJobLogEntries(jobs: readonly GitHubJob[]): JobLogEntry[] {
  return jobs.map(job => ({
    id: job.id,
    name: job.name,
    detail: formatDuration(job.startedAt, job.completedAt) || undefined,
  }));
}
