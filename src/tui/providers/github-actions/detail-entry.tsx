import type {
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubPullRequest,
  GitHubWorkflowRun,
} from "../../../core/github/types";
import { scopedMemory } from "../../components/detail-memory";
import { detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { ActionsDetailTab } from "./detail-tab";
import { GITHUB_LEGEND } from "./legend";
import { PullRequestsTab } from "./pulls-tab";

/** What GitHub Actions hands the detail view. */
export interface GitHubDetailSource extends ProviderDetailSource<GitHubCommitData> {
  /** A run's jobs (with steps), read when it is expanded. */
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJobFetchResult>;
  /** Read one commit again (`Reload commit`). */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  /** Enter on a job, or on an annotation with its message to search: the job log. */
  onOpenJobLog?: (job: GitHubJob, run: GitHubWorkflowRun, jobs?: GitHubJob[], search?: string) => void;
  /** The open pull requests whose branch points at a commit, by number; none without it. */
  pullRequestsAt?: (sha: string) => GitHubPullRequest[];
}

export const githubDetail = detailEntry<GitHubDetailSource>({
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
      memory={scopedMemory(props.context.memory, "github-actions")}
      onOpenJobLog={props.source.onOpenJobLog}
      targetRunId={props.context.target}
      targetColor={props.context.targetColor}
    />
  ),
  legend: (source, sha) => ((source.getCommitData(sha)?.runs.length ?? 0) > 0 ? GITHUB_LEGEND : null),
});

/** The Pull requests tab: only on a commit a pull request's branch points at, counting them. */
export const githubPullsDetail = detailEntry<GitHubDetailSource>({
  Tab: props => (
    <PullRequestsTab
      mouseEnabled={props.context.mouseEnabled}
      onMouseFocus={props.context.onMouseFocus}
      sha={props.context.sha}
      pullRequestsAt={sha => props.source.pullRequestsAt?.(sha) ?? []}
      fetchCommitData={props.source.fetchCommitData}
      unavailableReason={props.context.unavailable("github-actions", props.source.status)}
      loading={props.source.status?.kind === "loading"}
      {...props.context.cursor}
    />
  ),
  label: (source, sha) => {
    const count = source.pullRequestsAt?.(sha).length ?? 0;
    return count > 0 ? `Pull requests (${count})` : null;
  },
});
