import { openShiftStatusRows } from "../../../core/openshift/resources";
import type { OpenShiftEvent, OpenShiftResourceKind } from "../../../core/openshift/types";
import type { OpenShiftWarning } from "../../../core/openshift/warnings";
import { formatRelativeDate } from "../../utils/date";

/** Kinds whose events say something about a failure. An ImageStreamTag has hardly any. */
export const OPENSHIFT_EVENT_KINDS: ReadonlySet<OpenShiftResourceKind> = new Set([
  "Pod",
  "Build",
  "Deployment",
  "DeploymentConfig",
]);

export const OPENSHIFT_NO_EVENTS = "No recent events. OpenShift keeps them for 3 hours by default.";

export interface OpenShiftEventLine {
  text: string;
  kind: "header" | "warning" | "normal";
}

/** The events view: a header and one aligned row per event, `LAST SEEN  TYPE  REASON  COUNT  MESSAGE`. */
export function formatOpenShiftEvents(events: readonly OpenShiftEvent[]): OpenShiftEventLine[] {
  const rows = events.map(event => ({
    age: event.lastSeen ? formatRelativeDate(event.lastSeen) : "",
    type: event.type,
    reason: event.reason,
    count: String(event.count),
    message: event.message,
  }));
  const width = (title: string, values: string[]) => Math.max(title.length, ...values.map(value => value.length));
  const ageWidth = width(
    "LAST SEEN",
    rows.map(row => row.age),
  );
  const typeWidth = width(
    "TYPE",
    rows.map(row => row.type),
  );
  const reasonWidth = width(
    "REASON",
    rows.map(row => row.reason),
  );
  const countWidth = width(
    "COUNT",
    rows.map(row => row.count),
  );
  const line = (age: string, type: string, reason: string, count: string, message: string) =>
    `${age.padEnd(ageWidth)}  ${type.padEnd(typeWidth)}  ${reason.padEnd(reasonWidth)}  ${count.padStart(countWidth)}  ${message}`;
  return [
    { text: line("LAST SEEN", "TYPE", "REASON", "COUNT", "MESSAGE"), kind: "header" },
    ...rows.map(row => ({
      text: line(row.age, row.type, row.reason, row.count, row.message),
      kind: row.type === "Warning" ? ("warning" as const) : ("normal" as const),
    })),
  ];
}

export const OPENSHIFT_CACHED_WARNINGS = "Cached (no longer in the cluster)";

/**
 * Below the events: the warnings codepulse kept that the cluster's events no longer have (OpenShift deleted them), in
 * the same columns, newest first. Nothing when there are none.
 */
export function formatCachedWarnings(
  saved: readonly OpenShiftWarning[],
  live: readonly OpenShiftEvent[],
): OpenShiftEventLine[] {
  const listed = new Set(live.flatMap(event => (event.id ? [event.id] : [])));
  const cached = saved
    .filter(warning => !listed.has(warning.id))
    .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
  if (cached.length === 0) return [];
  const events = cached.map(warning => ({
    type: "Warning",
    reason: warning.reason,
    message: warning.message,
    count: warning.count,
    lastSeen: warning.lastSeen,
  }));
  return [
    { text: "", kind: "normal" },
    { text: OPENSHIFT_CACHED_WARNINGS, kind: "header" },
    ...formatOpenShiftEvents(events),
  ];
}

/**
 * Above the events: what the resource's status says is wrong, a header and one aligned row per problem,
 * `STATUS  REASON  MESSAGE`. Nothing when it is fine (or its object is not loaded).
 */
export function formatOpenShiftStatus(kind: OpenShiftResourceKind, object: unknown): OpenShiftEventLine[] {
  const rows = openShiftStatusRows(kind, object);
  if (rows.length === 0) return [];
  const statusWidth = Math.max("STATUS".length, ...rows.map(row => row.status.length));
  const reasonWidth = Math.max("REASON".length, ...rows.map(row => row.reason.length));
  const line = (status: string, reason: string, message: string) =>
    `${status.padEnd(statusWidth)}  ${reason.padEnd(reasonWidth)}  ${message}`.trimEnd();
  return [
    { text: line("STATUS", "REASON", "MESSAGE"), kind: "header" },
    ...rows.map(row => ({ text: line(row.status, row.reason, row.message), kind: "warning" as const })),
  ];
}
