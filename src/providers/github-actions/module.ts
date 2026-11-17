/** GitHub Actions as a provider module. */
import { githubEvents } from "../../core/dashboard/events";
import type { GitHubJob, GitHubWorkflowRun } from "../../core/github/types";
import type { ProviderModule } from "../module";
import type { GitHubDetailSource } from "./detail-entry";
import { githubJobLogTarget } from "./log-target";
import { useGitHubCI } from "./use-github-ci";

export const githubModule = {
  id: "github-actions",
  start: ({ state, actions, settings, suspended, onOpenJobLog }) => {
    const github = useGitHubCI({ state, actions, config: settings.github, suspended });
    return {
      instance: github,
      getCommitData: github.getCommitData,
      invalidate: github.invalidate,
      refresh: github.refresh,
      heldEvents: app => githubEvents(app, github.heldEntries()),
      detailSource: {
        getCommitData: github.getCommitData,
        fetchJobsForRun: github.fetchJobsForRun,
        fetchCommitData: github.fetchCommitDataForSHA,
        get status() {
          return state.providerStatusFor("github-actions");
        },
        onOpenJobLog: (job: GitHubJob, run: GitHubWorkflowRun, jobs?: GitHubJob[], search?: string) =>
          onOpenJobLog(githubJobLogTarget(github, job, run, jobs ?? [job], search)),
      },
    };
  },
} satisfies ProviderModule<ReturnType<typeof useGitHubCI>, GitHubDetailSource>;
