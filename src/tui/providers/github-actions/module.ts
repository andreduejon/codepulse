/** GitHub Actions as a provider module. */

import { githubProvider } from "../../../core/github/definition";
import { githubEvents, githubPullEventKind, githubPullEvents } from "../../../core/github/events";
import { GITHUB_PULLS_TAB } from "../../../core/github/id";
import type { GitHubJob, GitHubWorkflowRun } from "../../../core/github/types";
import { statusIcon } from "../../utils/status-icon";
import { providerModule } from "../module";
import { CI_GRAPH_COLUMNS } from "../shared/ci-columns";
import { statusColor } from "../shared/status";
import { type GitHubDetailSource, githubDetail, githubPullsDetail } from "./detail-entry";
import { GITHUB_HELP } from "./help";
import { GITHUB_LEGEND, PULLS_LEGEND, pullMark } from "./legend";
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
      closedPullRequestsAt: github.closedPullRequestsAt,
    };
    return {
      instance: github,
      getCommitData: github.getCommitData,
      invalidate: github.invalidate,
      refresh: github.refresh,
      // Its runs, and its pull requests opened, merged or closed (held only: the Dashboard's window drops them).
      heldEvents: app => [
        ...githubEvents(app, github.heldEntries()),
        ...githubPullEvents(app, github.heldPullRequests()),
      ],
      detailSource,
      // The CI columns, and after a commit's refs a chip per pull request whose branch points at it: its number only, the
      // rest is in the Pull requests tab; a draft's and a merged or closed one's muted.
      graphColumns: {
        ...CI_GRAPH_COLUMNS,
        refs: sha => [
          ...github.pullRequestsAt(sha).map(pr => ({ name: `PR #${pr.number}`, muted: pr.draft, whole: true })),
          // Merged or closed recently: muted, so the Pull requests tab's other rows are found too (the tab says which).
          ...github.closedPullRequestsAt(sha).map(pr => ({ name: `PR #${pr.number}`, muted: true, whole: true })),
        ],
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
  legend: [...GITHUB_LEGEND, ...PULLS_LEGEND.slice(0, 2)],
  // A pull request opened: ◀, muted for a draft (its status `skipped`). Merged and closed, and every run: how it ended.
  eventMark: event => {
    const status = event.status;
    if (githubPullEventKind(event) === "opened") return pullMark("open", status === "skipped");
    return status && { icon: statusIcon(status), color: theme => statusColor(theme, status) };
  },
});
