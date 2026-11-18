import type { GitHubJob, GitHubJobFetchResult, GitHubWorkflowRun } from "../../../core/github/types";
import type { JobLogTarget } from "../shared/job-log-dialog";
import { githubJobLogEntries, githubJobSummary } from "./job-summary";

/** What a job log reads from the GitHub provider. */
export interface GitHubLogReader {
  fetchJobLogForJob: (jobId: number, run: GitHubWorkflowRun, signal?: AbortSignal) => Promise<string>;
  fetchJobsForRun: (run: GitHubWorkflowRun, signal?: AbortSignal) => Promise<GitHubJobFetchResult>;
}

/**
 * A GitHub job in the log viewer, ←/→ to the run's other jobs. The title gives the job's time and the log starts
 * with its steps (marks and times); they are read again with the log, so `r` updates a running job.
 */
export function githubJobLogTarget(
  ci: GitHubLogReader,
  job: GitHubJob,
  run: GitHubWorkflowRun,
  jobs: readonly GitHubJob[],
  search?: string,
): JobLogTarget {
  const known = jobs.length > 0 ? jobs : [job];
  const entries = githubJobLogEntries(known);
  return {
    provider: "github-actions",
    job: entries.find(entry => entry.id === job.id) ?? entries[0],
    run,
    search,
    jobs: entries,
    fetchLog: async (current, signal) => {
      const log = await ci.fetchJobLogForJob(Number(current.id), run, signal);
      const latest = await ci.fetchJobsForRun(run, signal).catch(() => null);
      const shown = [...(latest?.jobs ?? []), ...known].find(candidate => candidate.id === current.id);
      if (!shown) return { log, summary: [] };
      return { log, summary: githubJobSummary(shown), detail: githubJobLogEntries([shown])[0]?.detail };
    },
  };
}
