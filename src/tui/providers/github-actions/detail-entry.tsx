import type {
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubPullRequest,
  GitHubWorkflowRun,
} from "../../../core/github/types";
import { scopedMemory } from "../../components/detail-memory";
import { useGit } from "../../context/git";
import { useAppState } from "../../context/state";
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

/** The Pull requests tab: only on a commit a pull request's branch points at. */
export const githubPullsDetail = detailEntry<GitHubDetailSource>({
  Tab: props => {
    // Rendered inside the details, below the app's providers: Git and the open repository are there.
    const git = useGit();
    const { state } = useAppState();
    /** Its files as Git has them: from where its branch left the target's (the target as GitHub said, else fetched). */
    const loadFiles = async (pr: GitHubPullRequest) => {
      for (const base of [pr.baseSha, `origin/${pr.baseRef}`, pr.baseRef].filter(Boolean)) {
        const found = await git.getRangeFiles(state.repoPath(), base, pr.headSha);
        if (found) return found;
      }
      return null;
    };
    return (
      <PullRequestsTab
        mouseEnabled={props.context.mouseEnabled}
        onMouseFocus={props.context.onMouseFocus}
        sha={props.context.sha}
        pullRequestsAt={sha => props.source.pullRequestsAt?.(sha) ?? []}
        loadFiles={loadFiles}
        onOpenDiff={props.context.onOpenDiff}
        onMergePreview={props.context.onMergePreview}
        fetchCommitData={props.source.fetchCommitData}
        unavailableReason={props.context.unavailable("github-actions", props.source.status)}
        loading={props.source.status?.kind === "loading"}
        memory={scopedMemory(props.context.memory, "github-pulls")}
        {...props.context.cursor}
      />
    );
  },
  // Like the other provider tabs, no count: its first row has the total, the graph a chip for each.
  label: (source, sha) => ((source.pullRequestsAt?.(sha).length ?? 0) > 0 ? "Pull requests" : null),
});
