/** GitHub Actions's Dashboard events: what it stored for an app, as the Dashboard shows it. */
import { type DashboardEvent, fact, runEvents, VERBS } from "../dashboard/events";
import { formatDuration } from "../duration";
import { categorize } from "../status";
import { GITHUB_ID } from "./id";
import type { GitHubCacheEntry } from "./merge";

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
