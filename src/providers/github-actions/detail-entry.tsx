import { detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { ActionsDetailTab, GITHUB_LEGEND } from "./detail-tab";
import type { GitHubCommitData, GitHubJob, GitHubJobFetchResult, GitHubWorkflowRun } from "./types";

/** What GitHub Actions hands the detail view. */
export interface GitHubDetailSource extends ProviderDetailSource<GitHubCommitData> {
  /** A run's jobs (with steps), read when it is expanded. */
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJobFetchResult>;
  /** Read one commit again (`Reload commit`). */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  /** Enter on a job, or on an annotation with its message to search: the job log. */
  onOpenJobLog?: (job: GitHubJob, run: GitHubWorkflowRun, jobs?: GitHubJob[], search?: string) => void;
}

export const githubDetail = detailEntry({
  view: "github-actions",
  Tab: props => (
    <ActionsDetailTab
      mouseEnabled={props.context.mouseEnabled}
      onMouseFocus={props.context.onMouseFocus}
      sha={props.context.sha}
      getCommitData={props.source.getCommitData}
      fetchJobsForRun={props.source.fetchJobsForRun}
      fetchCommitData={props.source.fetchCommitData}
      unavailableReason={props.context.unavailable("github-actions", props.source.status)}
      loading={props.source.status?.kind === "loading"}
      {...props.context.cursor}
      onOpenJobLog={props.source.onOpenJobLog}
    />
  ),
  legend: (source, sha) => ((source.getCommitData(sha)?.runs.length ?? 0) > 0 ? GITHUB_LEGEND : null),
});
