/** GitHub Actions's marks, explained below its detail tabs and beside its events on the Dashboard. */
import type { GitHubPullRequest } from "../../../core/github/types";
import type { Theme } from "../../context/theme";
import { statusIcon } from "../../utils/status-icon";
import { type LegendItem, runLegend } from "../shared/detail-legend";
import { statusColor } from "../shared/status";

export const GITHUB_LEGEND: LegendItem[] = runLegend("cancelled");

type Mark = { icon: string; color: (theme: Theme) => string };

/**
 * A pull request's mark: ◀ open (into its target, like the graph's merge preview) in GitHub's colour, muted for a draft;
 * ✓ merged, ○ closed without merging, as a run that passed or was cancelled.
 */
export function pullMark(state: GitHubPullRequest["state"], draft = false): Mark {
  if (state === "merged") return { icon: statusIcon("pass"), color: theme => statusColor(theme, "pass") };
  if (state === "closed") return { icon: statusIcon("cancelled"), color: theme => statusColor(theme, "cancelled") };
  return { icon: "◀", color: theme => (draft ? theme.foregroundMuted : theme.githubActionsBg) };
}

const item = (mark: Mark, label: string): LegendItem => [[[mark.icon, mark.color]], label];

/** The Pull requests tab's marks, below it. */
export const PULLS_LEGEND: LegendItem[] = [
  item(pullMark("open"), "open"),
  item(pullMark("open", true), "draft"),
  item(pullMark("merged"), "merged"),
  item(pullMark("closed"), "closed"),
];
