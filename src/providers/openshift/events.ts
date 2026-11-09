import { formatRelativeDate } from "../../utils/date";
import type { OpenShiftEvent, OpenShiftResourceKind } from "./types";

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
