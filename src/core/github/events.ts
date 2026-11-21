/** GitHub Actions's Dashboard events: what it stored for an app, as the Dashboard shows it. */
import { type DashboardEvent, fact, runEvents, timeOf, VERBS } from "../dashboard/events";
import { formatDuration } from "../duration";
import { categorize } from "../status";
import { GITHUB_ID, GITHUB_PULLS_TAB } from "./id";
import type { GitHubCacheEntry } from "./merge";
import type { GitHubPullRequest } from "./types";

export function githubEvents(
  app: string,
  entries: readonly Pick<GitHubCacheEntry, "sha" | "runs">[],
): DashboardEvent[] {
  return runEvents(
    app,
    GITHUB_ID,
    entries.flatMap(entry => entry.runs),
    run => {
      const status = categorize(run.status, run.conclusion);
      return {
        status,
        text: `${run.name} #${run.runNumber} ${VERBS[status]}`,
        ...(run.url ? { url: run.url } : {}),
        ...(run.headBranch ? { branch: run.headBranch } : {}),
        facts: [
          ...fact("Workflow", run.name),
          ...fact("Run", `#${run.runNumber}`),
          ...fact("Trigger", run.event),
          ...fact("Duration", formatDuration(run.startedAt ?? null, run.updatedAt)),
        ],
      };
    },
  );
}

/** How a pull request event reads: `PR #123 opened`. */
const PULL_VERBS = { opened: "opened", merged: "merged", closed: "closed" } as const;

/**
 * The pull requests GitHub lists now, as Dashboard events: each opened at its creation, and merged or closed at its
 * end. Held, not saved: the Dashboard's window drops each when it is older. An event is on the pull request's head
 * commit and branch, and opens its row in the Pull requests tab.
 */
export function githubPullEvents(app: string, pulls: readonly GitHubPullRequest[]): DashboardEvent[] {
  const byId = new Map<string, DashboardEvent>();
  for (const pr of pulls) {
    const ends = [
      ["opened", pr.createdAt] as const,
      ...(pr.state !== "open" && pr.closedAt ? [[pr.state, pr.closedAt] as const] : []),
    ];
    for (const [kind, at] of ends) {
      const time = timeOf(at);
      if (time === null) continue;
      const id = `${app}:${GITHUB_ID}:pull:${pr.number}:${kind}`;
      byId.set(id, {
        id,
        app,
        source: GITHUB_ID,
        time,
        // Its mark: ✓ merged, ○ closed without merging; ◀ opened (GitHub's own mark), muted for a draft (`skipped`:
        // not ready for review).
        status: kind === "merged" ? "pass" : kind === "closed" ? "cancelled" : pr.draft ? "skipped" : "unknown",
        text: `PR #${pr.number} ${PULL_VERBS[kind]} · ${pr.title}`,
        sha: pr.headSha,
        branch: pr.headRef,
        url: pr.url,
        tab: GITHUB_PULLS_TAB,
        entry: String(pr.number),
        facts: [
          ...fact("Pull request", `#${pr.number} ${pr.title}`),
          ...fact("Branch", `${pr.headRef} → ${pr.baseRef}`),
          ...fact("Author", pr.author ? `@${pr.author}` : null),
        ],
      });
    }
  }
  return [...byId.values()];
}

/** A pull request event's kind; null for a run's. */
export const githubPullEventKind = (event: DashboardEvent): "opened" | "merged" | "closed" | null => {
  const match = event.id.startsWith(`${event.app}:${GITHUB_ID}:pull:`)
    ? /:(opened|merged|closed)$/.exec(event.id)
    : null;
  return (match?.[1] as "opened" | "merged" | "closed" | undefined) ?? null;
};
