import { onCleanup } from "solid-js";
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
import { targetRowIndex } from "../../graph/merge-preview";
import { detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { ActionsDetailTab } from "./detail-tab";
import { GITHUB_LEGEND, PULLS_LEGEND } from "./legend";
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
  /** The merged or closed ones whose branch pointed at it. */
  closedPullRequestsAt?: (sha: string) => GitHubPullRequest[];
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

const hasPulls = (source: GitHubDetailSource, sha: string) =>
  (source.pullRequestsAt?.(sha).length ?? 0) + (source.closedPullRequestsAt?.(sha).length ?? 0) > 0;

/** The pull request versions fetched wholly: one whose commits are still missing after that isn't fetched again. */
const fetchedPulls = new Set<string>();

/** The Pull requests tab: only on a commit a pull request's branch points (or pointed, merged or closed) at. */
export const githubPullsDetail = detailEntry<GitHubDetailSource>({
  Tab: props => {
    // Rendered inside the details, below the app's providers: Git and the open repository are there.
    const git = useGit();
    const { state } = useAppState();
    /**
     * Its files as Git has them: from where its branch left the target's. The target as GitHub names it, else the commit
     * its branch points at in the graph (on any remote, as the merge preview finds it), else the local branch.
     */
    // Reads and fetches stop with the tab (another commit, another repository): none lands in the wrong one.
    const reads = new AbortController();
    onCleanup(() => reads.abort());
    const readFiles = async (repo: string, pr: GitHubPullRequest) => {
      const rows = state.graphRows();
      const target = rows[targetRowIndex(rows, { base: pr.baseSha, baseRef: pr.baseRef })]?.commit.hash;
      for (const base of [...new Set([pr.baseSha, target ?? "", pr.baseRef])].filter(Boolean)) {
        if (reads.signal.aborted) return null;
        const found = await git.getRangeFiles(repo, base, pr.headSha, reads.signal);
        if (found) return found;
      }
      return null;
    };
    /**
     * When Git hasn't its commits: they are fetched (this pull request's alone), then read again. Once both arrived they
     * aren't fetched again for this version; a fetch that failed, wholly or in part, is tried again with the next read.
     */
    const loadFiles = async (pr: GitHubPullRequest, onFetch: () => void) => {
      const repo = state.repoPath();
      const found = await readFiles(repo, pr);
      const version = `${repo}\0${pr.number}\0${pr.headSha}\0${pr.baseSha}\0${pr.baseRef}`;
      if (found || fetchedPulls.has(version) || reads.signal.aborted) return found;
      onFetch();
      if (await git.fetchPullRequest(repo, pr.number, pr.baseRef, reads.signal)) fetchedPulls.add(version);
      return reads.signal.aborted ? null : readFiles(repo, pr);
    };
    return (
      <PullRequestsTab
        mouseEnabled={props.context.mouseEnabled}
        onMouseFocus={props.context.onMouseFocus}
        sha={props.context.sha}
        pullRequestsAt={sha => props.source.pullRequestsAt?.(sha) ?? []}
        closedPullRequestsAt={sha => props.source.closedPullRequestsAt?.(sha) ?? []}
        target={props.context.target}
        targetColor={props.context.targetColor}
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
  // Like the other provider tabs, no count: its first row has the total, the graph a chip for each open one.
  label: (source, sha) => (hasPulls(source, sha) ? "Pull requests" : null),
  legend: (source, sha) => (hasPulls(source, sha) ? PULLS_LEGEND : null),
});
