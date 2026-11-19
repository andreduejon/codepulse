/**
 * The Events tab's tree, without drawing: namespace, then each reason (what a failing resource's status says first,
 * then the warnings', then the Normal events' the cluster lists now, each newest first), then the resources it
 * happened to, newest first. An event is always about one object, so ten pods crash-looping are ten BackOff events:
 * one reason row with ten resources. A resource the cluster no longer has, or whose events OpenShift deleted, is
 * shown from the cache: cached. Each row carries its prefix (the tree's lines), so the tab only draws it.
 */
import type { OpenShiftFailure } from "../../../core/openshift/failures";
import type { OpenShiftWarning } from "../../../core/openshift/warnings";

/**
 * What a reason is: `failure`, what a failing resource's status says (red, as `✗`); `warning`, a warning event (kept,
 * in the warning color); `normal`, a Normal event, shown while the cluster lists it.
 */
export type EventsLevel = "failure" | "warning" | "normal";

export type EventsRow =
  | { kind: "namespace"; key: string; prefix: string; namespace: string; count: number; open: boolean }
  | {
      kind: "reason";
      key: string;
      prefix: string;
      reason: string;
      count: number;
      open: boolean;
      level: EventsLevel;
      /** Every resource below it is cached: it is over, muted. */
      cached: boolean;
    }
  | {
      kind: "resource";
      key: string;
      prefix: string;
      /** Its kind and name, as the row says them: `Pod shop-api-7d9f8-x2k4q`. */
      resourceKind: string;
      name: string;
      /** The cluster no longer has it (a replaced pod, a pruned build). */
      removed: boolean;
      /**
       * Shown from the cache: the cluster's latest lists lack the resource's uid, or every one of its events' uids
       * (OpenShift deleted them). The row says `(cached)` and is muted.
       */
      cached: boolean;
      /** Its events of this reason (one, unless their messages differed). */
      count: number;
      lastSeen: string | null;
      /** A failure's part of the status (`waiting`, `last run`), shown where an event shows its time. */
      status?: string;
      /** Its newest event of this reason: what the resource is (namespace, kind, name, uid), to open it. */
      warning: OpenShiftWarning;
    };

export interface EventsTreeOptions {
  isPresent: (warning: OpenShiftWarning) => boolean;
  isCached: (warning: OpenShiftWarning) => boolean;
  collapsed: ReadonlySet<string>;
  /** The Normal events the cluster lists now: after the warnings, never cached themselves. */
  normal?: readonly OpenShiftWarning[];
  /** What the commit's failing resources' status says: before the warnings, cached only once the resource is gone. */
  failures?: readonly OpenShiftFailure[];
}

export const namespaceKey = (namespace: string) => `namespace:${namespace}`;
export const reasonKey = (namespace: string, reason: string, level: EventsLevel = "warning") =>
  `reason:${namespace}:${reason}${level === "warning" ? "" : `:${level}`}`;

const newestFirst = (a: OpenShiftWarning, b: OpenShiftWarning) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");

/** The lines before a row: each open level's `│` or blank, then its own branch. */
const branch = (lead: string, last: boolean) => `${lead}${last ? "└─ " : "├─ "}`;
const below = (lead: string, last: boolean) => `${lead}${last ? "   " : "│  "}`;

/** Groups by a key, keeping the order the items come in (newest first). */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.values()];
}

const LEVELS: readonly EventsLevel[] = ["failure", "warning", "normal"];

/** Every row of the tab's tree. */
export function eventsTreeRows(warnings: readonly OpenShiftWarning[], options: EventsTreeOptions): EventsRow[] {
  const levelOf = new Map<OpenShiftWarning, EventsLevel>([
    ...(options.failures ?? []).map(entry => [entry, "failure"] as const),
    ...warnings.map(entry => [entry, "warning"] as const),
    ...(options.normal ?? []).map(entry => [entry, "normal"] as const),
  ]);
  const sorted = [...levelOf.keys()].sort(newestFirst);
  // Namespaces by name, so a new warning never moves them; reasons and resources newest first.
  const namespaces = groupBy(sorted, warning => warning.namespace).sort((a, b) =>
    (a[0]?.namespace ?? "").localeCompare(b[0]?.namespace ?? ""),
  );
  const rows: EventsRow[] = [];
  namespaces.forEach((inNamespace, nsIndex) => {
    const namespace = inNamespace[0]?.namespace ?? "";
    const nsLast = nsIndex === namespaces.length - 1;
    const nsKey = namespaceKey(namespace);
    const nsOpen = !options.collapsed.has(nsKey);
    rows.push({
      kind: "namespace",
      key: nsKey,
      prefix: branch("", nsLast),
      namespace,
      count: inNamespace.length,
      open: nsOpen,
    });
    if (!nsOpen) return;
    const nsLead = below("", nsLast);
    // What went wrong leads: what the status says, then the warnings' reasons, then the Normal events'.
    const reasons = LEVELS.flatMap(level =>
      groupBy(
        inNamespace.filter(entry => levelOf.get(entry) === level),
        entry => entry.reason,
      ).map(entries => ({ level, entries })),
    );
    // Each reason's resources, built also when it is collapsed: a reason whose resources are all cached is muted.
    reasons.forEach(({ level, entries: ofReason }, reasonIndex) => {
      const reason = (ofReason[0] as OpenShiftWarning).reason;
      const reasonLast = reasonIndex === reasons.length - 1;
      const key = reasonKey(namespace, reason, level);
      const reasonLead = below(nsLead, reasonLast);
      // One recreated under its old name is a row each, by its uid (also before the live list says which one is
      // there), so every one's events stay reachable (Enter opens the row's own object).
      const objectOf = (entry: OpenShiftWarning) =>
        `${entry.kind}:${entry.name}:${options.isPresent(entry) ? "present" : "removed"}:${entry.uid ?? ""}`;
      const resources = groupBy(ofReason, objectOf);
      const children = resources.map((events, index) => {
        const newest = events[0] as OpenShiftWarning;
        const removed = !options.isPresent(newest);
        return {
          kind: "resource" as const,
          key: `resource:${key}:${objectOf(newest)}`,
          prefix: branch(reasonLead, index === resources.length - 1),
          resourceKind: newest.kind,
          name: newest.name,
          removed,
          // A Normal event or a failure is shown only while the cluster has it: cached only when its resource is gone.
          cached: removed || (level === "warning" && events.every(options.isCached)),
          count: events.length,
          lastSeen: newest.lastSeen,
          ...(level === "failure" ? { status: (newest as OpenShiftFailure).status } : {}),
          warning: newest,
        };
      });
      const open = !options.collapsed.has(key);
      const head: EventsRow = {
        kind: "reason",
        key,
        prefix: branch(nsLead, reasonLast),
        reason,
        count: ofReason.length,
        open,
        level,
        cached: children.every(row => row.cached),
      };
      rows.push(head, ...(open ? children : []));
    });
  });
  return rows;
}
