/**
 * The Events tab's tree, without drawing: namespace, then each reason newest first (the warnings' first, then the
 * Normal events' the cluster lists now), then the resources it happened to, newest first. An event is always about one object, so ten pods crash-looping are ten BackOff events: one
 * reason row with ten resources. A resource the cluster no longer has, or whose events OpenShift deleted, is shown
 * from the cache: cached. Each row carries its prefix (the tree's lines), so the tab only draws it.
 */
import type { OpenShiftWarning } from "../../../core/openshift/warnings";

export type EventsRow =
  | { kind: "namespace"; key: string; prefix: string; namespace: string; count: number; open: boolean }
  | {
      kind: "reason";
      key: string;
      prefix: string;
      reason: string;
      count: number;
      open: boolean;
      /** A warning's reason (kept, in the warning color); else a Normal event's, shown while the cluster lists it. */
      warning: boolean;
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
      /** Its newest event of this reason: what the resource is (namespace, kind, name, uid), to open it. */
      warning: OpenShiftWarning;
    };

export interface EventsTreeOptions {
  isPresent: (warning: OpenShiftWarning) => boolean;
  isCached: (warning: OpenShiftWarning) => boolean;
  collapsed: ReadonlySet<string>;
  /** The Normal events the cluster lists now: after the warnings, never cached themselves. */
  normal?: readonly OpenShiftWarning[];
}

export const namespaceKey = (namespace: string) => `namespace:${namespace}`;
export const reasonKey = (namespace: string, reason: string, warning = true) =>
  `reason:${namespace}:${reason}${warning ? "" : ":normal"}`;

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

/** Every row of the tab's tree. */
export function eventsTreeRows(warnings: readonly OpenShiftWarning[], options: EventsTreeOptions): EventsRow[] {
  const isWarning = new Set(warnings);
  const sorted = [...warnings, ...(options.normal ?? [])].sort(newestFirst);
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
    // What went wrong leads: the warnings' reasons, then the Normal events'.
    const reasons = [
      ...groupBy(
        inNamespace.filter(entry => isWarning.has(entry)),
        entry => entry.reason,
      ),
      ...groupBy(
        inNamespace.filter(entry => !isWarning.has(entry)),
        entry => entry.reason,
      ),
    ];
    reasons.forEach((ofReason, reasonIndex) => {
      const first = ofReason[0] as OpenShiftWarning;
      const reason = first.reason;
      const warning = isWarning.has(first);
      const reasonLast = reasonIndex === reasons.length - 1;
      const key = reasonKey(namespace, reason, warning);
      const open = !options.collapsed.has(key);
      rows.push({
        kind: "reason",
        key,
        prefix: branch(nsLead, reasonLast),
        reason,
        count: ofReason.length,
        open,
        warning,
      });
      if (!open) return;
      const reasonLead = below(nsLead, reasonLast);
      // One recreated under its old name is two: the one the commit has, and the removed one.
      const resources = groupBy(
        ofReason,
        warning => `${warning.kind}\u0000${warning.name}\u0000${options.isPresent(warning) ? "present" : "removed"}`,
      );
      resources.forEach((events, index) => {
        const newest = events[0] as OpenShiftWarning;
        const removed = !options.isPresent(newest);
        rows.push({
          kind: "resource",
          key: `resource:${key}:${newest.kind}:${newest.name}:${removed ? "removed" : "present"}`,
          prefix: branch(reasonLead, index === resources.length - 1),
          resourceKind: newest.kind,
          name: newest.name,
          removed,
          // A Normal event is shown only while the cluster lists it: cached only when its resource is gone.
          cached: removed || (warning && events.every(options.isCached)),
          count: events.length,
          lastSeen: newest.lastSeen,
          warning: newest,
        });
      });
    });
  });
  return rows;
}
