/**
 * The Events tab's tree, without drawing: namespace, resource, then the resource's warnings newest first. A resource
 * the commit no longer has stays in its place, marked removed. Each row carries its prefix (the tree's lines), so the
 * tab only draws it.
 */
import type { OpenShiftWarning } from "../../../core/openshift/warnings";

export type EventsRow =
  | { kind: "namespace"; key: string; prefix: string; namespace: string; count: number; open: boolean }
  | {
      kind: "resource";
      key: string;
      prefix: string;
      /** Its kind and name, as the row says them: `Pod shop-api-7d9f8-x2k4q`. */
      resourceKind: string;
      name: string;
      /** The commit no longer has it. */
      removed: boolean;
      /** Its newest warning: what the resource is (namespace, kind, name, uid), to open it. */
      warning: OpenShiftWarning;
    }
  | { kind: "warning"; key: string; prefix: string; warning: OpenShiftWarning; removed: boolean };

/** Kinds in the order the Resources tab shows them; the rest after, by name. */
const KIND_ORDER = ["Deployment", "DeploymentConfig", "ReplicaSet", "ReplicationController", "Pod", "Build"];

const kindRank = (kind: string) => {
  const rank = KIND_ORDER.indexOf(kind);
  return rank < 0 ? KIND_ORDER.length : rank;
};

export const namespaceKey = (namespace: string) => `namespace:${namespace}`;

const newestFirst = (a: OpenShiftWarning, b: OpenShiftWarning) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");

/** The lines before a row: each open level's `│` or blank, then its own branch. */
const branch = (lead: string, last: boolean) => `${lead}${last ? "└─ " : "├─ "}`;
const below = (lead: string, last: boolean) => `${lead}${last ? "   " : "│  "}`;

interface ResourceGroup {
  kind: string;
  name: string;
  removed: boolean;
  warnings: OpenShiftWarning[];
}

/**
 * A namespace's resources by kind, then name, so a new warning or a removal never moves one; one recreated under its
 * old name is two: the one it has, then the removed one.
 */
function resourcesOf(warnings: readonly OpenShiftWarning[], isPresent: (warning: OpenShiftWarning) => boolean) {
  const groups = new Map<string, ResourceGroup>();
  for (const warning of warnings) {
    const removed = !isPresent(warning);
    const key = `${warning.kind}\u0000${warning.name}\u0000${removed}`;
    const group = groups.get(key) ?? { kind: warning.kind, name: warning.name, removed, warnings: [] };
    group.warnings.push(warning);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name) ||
      Number(a.removed) - Number(b.removed),
  );
}

/** Every row of the tab's tree. */
export function eventsTreeRows(
  warnings: readonly OpenShiftWarning[],
  isPresent: (warning: OpenShiftWarning) => boolean,
  collapsed: ReadonlySet<string>,
): EventsRow[] {
  const byNamespace = new Map<string, OpenShiftWarning[]>();
  for (const warning of warnings) {
    const list = byNamespace.get(warning.namespace) ?? [];
    list.push(warning);
    byNamespace.set(warning.namespace, list);
  }
  // Namespaces by name, so a new warning never moves them.
  const namespaces = [...byNamespace.entries()].sort(([a], [b]) => a.localeCompare(b));
  const rows: EventsRow[] = [];
  namespaces.forEach(([namespace, inNamespace], nsIndex) => {
    const nsLast = nsIndex === namespaces.length - 1;
    const key = namespaceKey(namespace);
    const open = !collapsed.has(key);
    rows.push({ kind: "namespace", key, prefix: branch("", nsLast), namespace, count: inNamespace.length, open });
    if (!open) return;
    const nsLead = below("", nsLast);
    const resources = resourcesOf(inNamespace, isPresent);
    resources.forEach((resource, index) => {
      const last = index === resources.length - 1;
      const sorted = [...resource.warnings].sort(newestFirst);
      rows.push({
        kind: "resource",
        key: `resource:${namespace}:${resource.kind}:${resource.name}:${resource.removed ? "removed" : "present"}`,
        prefix: branch(nsLead, last),
        resourceKind: resource.kind,
        name: resource.name,
        removed: resource.removed,
        warning: sorted[0] as OpenShiftWarning,
      });
      const resourceLead = below(nsLead, last);
      sorted.forEach((warning, warningIndex) => {
        rows.push({
          kind: "warning",
          key: `warning:${warning.id}`,
          prefix: branch(resourceLead, warningIndex === sorted.length - 1),
          warning,
          removed: resource.removed,
        });
      });
    });
  });
  return rows;
}
