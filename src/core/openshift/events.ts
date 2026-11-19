/** OpenShift's Dashboard events: what it stored for an app, as the Dashboard shows it. */
import { type DashboardEvent, fact, timeOf } from "../dashboard/events";
import { formatDuration } from "../duration";
import { OPENSHIFT_ID } from "./id";
import { cachedBuildStatus, type OpenShiftCacheEntry } from "./merge";

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
    const status = cachedBuildStatus(build);
    const outcome =
      status === "pass" ? "complete" : status === "fail" ? "failed" : status === "cancelled" ? "cancelled" : "running";
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
      status,
      text: `build ${build.name} ${outcome} in ${build.namespace}`,
      sha: build.commitSha,
      ...(branch ? { branch } : {}),
      facts: [
        ...fact("Namespace", build.namespace),
        ...fact("Build", build.name),
        ...fact("Reason", status === "fail" ? reason : null),
        ...fact("Duration", formatDuration(build.updatedAt ?? null, completed)),
      ],
    });
  }
  for (const entry of entries)
    for (const warning of entry.warnings ?? []) {
      // When it first happened, so repeating never moves it. Namespaces hold no `:`, so no build's id is like it.
      const time = timeOf(warning.firstSeen) ?? timeOf(warning.lastSeen);
      const id = `${app}:${OPENSHIFT_ID}:warning:${warning.namespace}/${warning.id}`;
      if (time === null || events.has(id)) continue;
      const kind = warning.kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      events.set(id, {
        id,
        app,
        entry: `${warning.kind}:${warning.namespace}:${warning.name}`,
        source: OPENSHIFT_ID,
        time,
        // Not how something ended: neutral. Its mark is OpenShift's own `!`.
        status: "unknown",
        text: [
          warning.reason,
          `${kind} ${warning.name} in ${warning.namespace}`,
          ...(warning.count > 1 ? [`${warning.count} times`] : []),
        ].join(" · "),
        sha: entry.sha,
        facts: [
          ...fact("Namespace", warning.namespace),
          ...fact("Resource", `${warning.kind} ${warning.name}`),
          ...fact("Reason", warning.reason),
          ...fact("Message", warning.message),
          ...fact("Times", String(warning.count)),
          ...fact("Repeated for", warning.count > 1 ? formatDuration(warning.firstSeen, warning.lastSeen) : null),
        ],
      });
    }
  return [...events.values()];
}

/** Whether an event is a saved warning, not a build. */
export const isOpenShiftWarningEvent = (event: DashboardEvent) =>
  event.id.startsWith(`${event.app}:${OPENSHIFT_ID}:warning:`);
