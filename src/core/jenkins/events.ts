/** Jenkins's Dashboard events: what it stored for an app, as the Dashboard shows it. */
import { type DashboardEvent, fact, runEvents, VERBS } from "../dashboard/events";
import { formatDuration } from "../duration";
import { categorize } from "../status";
import { JENKINS_ID } from "./id";
import type { JenkinsCacheEntry } from "./merge";

export function jenkinsEvents(
  app: string,
  entries: readonly Pick<JenkinsCacheEntry, "sha" | "runs">[],
): DashboardEvent[] {
  return runEvents(
    app,
    JENKINS_ID,
    entries.flatMap(entry => entry.runs),
    run => {
      const status = categorize(run.status, run.conclusion);
      const verb = status === "cancelled" ? "aborted" : VERBS[status];
      return {
        status,
        text: `${run.jobLabel || run.name} #${run.runNumber} ${verb}`,
        ...(run.url ? { url: run.url } : {}),
        ...(run.branch ? { branch: run.branch } : {}),
        facts: [
          ...fact("Job", run.jobLabel || run.name),
          ...fact("Build", `#${run.runNumber}`),
          ...fact("Duration", formatDuration(run.startedAt, run.updatedAt)),
        ],
      };
    },
  );
}
