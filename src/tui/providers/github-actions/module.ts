/** GitHub Actions as a provider module. */

import { githubProvider } from "../../../core/github/definition";
import { githubEvents } from "../../../core/github/events";
import type { GitHubJob, GitHubWorkflowRun } from "../../../core/github/types";
import { providerModule } from "../module";
import { type GitHubDetailSource, githubDetail } from "./detail-entry";
import { GITHUB_LEGEND } from "./legend";
import { githubJobLogTarget } from "./log-target";
import { buildGitHubProviderItems } from "./menu-items";
import { useGitHubCI } from "./use-github-ci";

export const githubModule = providerModule({
  definition: githubProvider,
  start: ({ state, actions, settings, suspended, onOpenJobLog, adapters }) => {
    const github = useGitHubCI({ state, actions, config: settings, suspended, adapters });
    const detailSource: GitHubDetailSource = {
      getCommitData: github.getCommitData,
      fetchJobsForRun: github.fetchJobsForRun,
      fetchCommitData: github.fetchCommitDataForSHA,
      get status() {
        return state.providerStatusFor(githubProvider.id);
      },
      onOpenJobLog: (job: GitHubJob, run: GitHubWorkflowRun, jobs?: GitHubJob[], search?: string) =>
        onOpenJobLog(githubJobLogTarget(github, job, run, jobs ?? [job], search)),
    };
    return {
      instance: github,
      getCommitData: github.getCommitData,
      invalidate: github.invalidate,
      refresh: github.refresh,
      heldEvents: app => githubEvents(app, github.heldEntries()),
      detailSource,
    };
  },
  colors: theme => ({ bg: theme.githubActionsBg, fg: theme.githubActionsFg }),
  menuItems: menu =>
    buildGitHubProviderItems(
      menu.settings,
      menu.state.remoteUrl(),
      menu.tokenIsSet(menu.settings.tokenEnvVar) ? "env" : null,
      undefined,
      menu.update,
      menu.lastRefresh,
    ),
  detailEntries: { [githubProvider.id]: githubDetail },
  legend: GITHUB_LEGEND,
});
