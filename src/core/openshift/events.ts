/** OpenShift's Dashboard events: what it stored for an app, as the Dashboard shows it. */
import { type DashboardEvent, fact, timeOf } from "../dashboard/events";
import { formatDuration } from "../duration";
import { OPENSHIFT_ID } from "./id";
import type { OpenShiftCacheEntry } from "./merge";

export function openShiftEvents(app: string, entries: readonly OpenShiftCacheEntry[]): DashboardEvent[] {
  const events = new Map<string, DashboardEvent>();
  for (const build of entries.flatMap(entry => entry.builds)) {
    // When it finished; its creation time otherwise.
    const objectStatus = (build.object as { status?: Record<string, unknown> } | undefined)?.status ?? {};
    const text = (key: string) => (typeof objectStatus[key] === "string" ? (objectStatus[key] as string) : null);
    const completed = text("completionTimestamp");
    const time = timeOf(completed) ?? timeOf(build.updatedAt);
    const reason = [text("reason"), text("message")].filter(Boolean).join(": ");
    const id = `${app}:${OPENSHIFT_ID}:${build.namespace}/${build.id}`;
    if (time === null || events.has(id)) continue;
    const outcome =
      build.status === "pass"
        ? "complete"
        : build.status === "fail"
          ? "failed"
          : build.status === "cancelled"
            ? "cancelled"
            : "running";
    // The Git ref its BuildConfig builds, when it names one (`develop`, `refs/heads/develop`); else Git finds it.
    const spec = (build.object as { spec?: { source?: { git?: { ref?: unknown } } } } | undefined)?.spec;
    const ref = spec?.source?.git?.ref;
    const branch = typeof ref === "string" ? ref.trim().replace(/^refs\/heads\//, "") : "";
    events.set(id, {
      id,
      app,
      entry: build.id,
      source: OPENSHIFT_ID,
      time,
      status: build.status,
      text: `build ${build.name} ${outcome} in ${build.namespace}`,
      sha: build.commitSha,
      ...(branch ? { branch } : {}),
      facts: [
        ...fact("Namespace", build.namespace),
        ...fact("Build", build.name),
        ...fact("Reason", build.status === "fail" ? reason : null),
        ...fact("Duration", formatDuration(build.updatedAt ?? null, completed)),
      ],
    });
  }
  return [...events.values()];
}
