/** GitHub Actions as a provider module. */

import { githubProvider } from "../../../core/github/definition";
import { githubEvents } from "../../../core/github/events";
import { GITHUB_PULLS_TAB } from "../../../core/github/id";
import type { GitHubJob, GitHubWorkflowRun } from "../../../core/github/types";
import { providerModule } from "../module";
import { CI_GRAPH_COLUMNS } from "../shared/ci-columns";
import { type GitHubDetailSource, githubDetail, githubPullsDetail } from "./detail-entry";
import { GITHUB_HELP } from "./help";
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
      pullRequestsAt: github.pullRequestsAt,
    };
    return {
      instance: github,
      getCommitData: github.getCommitData,
      invalidate: github.invalidate,
      refresh: github.refresh,
      heldEvents: app => githubEvents(app, github.heldEntries()),
      detailSource,
      // The CI columns, and after a commit's refs a chip per open pull request whose branch points at it, a draft's
      // muted: its number only, the rest is in the Pull requests tab.
      graphColumns: {
        ...CI_GRAPH_COLUMNS,
        refs: sha => github.pullRequestsAt(sha).map(pr => ({ name: `PR #${pr.number}`, muted: pr.draft, whole: true })),
      },
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
  detailEntries: { [githubProvider.id]: githubDetail, [GITHUB_PULLS_TAB]: githubPullsDetail },
  help: GITHUB_HELP,
  legend: GITHUB_LEGEND,
});
