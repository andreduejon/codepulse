/**
 * Kubernetes warnings about a commit's resources, as OpenShift reported them: an event of type `Warning`, nothing
 * codepulse decides itself. They are kept with the commit they belong to, so they outlast the cluster's own copy (3
 * hours on OpenShift by default), and go with the commit's snapshot when the cache limit evicts it.
 */
import type {
  OpenShiftCommitData,
  OpenShiftControllerReference,
  OpenShiftResource,
  OpenShiftResourceKind,
} from "./types";

export interface OpenShiftWarning {
  /** The event's uid: the same warning read again updates this one. */
  id: string;
  namespace: string;
  /** The resource it is about. */
  kind: string;
  name: string;
  uid?: string;
  reason: string;
  message: string;
  /** How many times it happened. */
  count: number;
  /** When it first and last happened (ISO), or null when the event has no time. */
  firstSeen: string | null;
  lastSeen: string | null;
}

/** The warnings listed in each configured namespace. */
export interface OpenShiftWarningList {
  warnings: OpenShiftWarning[];
  /** Namespaces whose events the token may not list. */
  denied: string[];
  /** Namespaces whose list failed for another reason. */
  failed: string[];
  /** The token expired: nothing more was asked. */
  failure?: "auth";
}

const newestFirst = (a: OpenShiftWarning, b: OpenShiftWarning) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");

/** One entry per warning, the newest read of each (an older read never undoes a newer one), newest first. */
export function mergeWarnings(
  existing: readonly OpenShiftWarning[],
  incoming: readonly OpenShiftWarning[],
): OpenShiftWarning[] {
  const byId = new Map<string, OpenShiftWarning>();
  for (const entry of [...existing, ...incoming]) {
    const kept = byId.get(entry.id);
    const newer =
      !kept ||
      (entry.lastSeen ?? "") > (kept.lastSeen ?? "") ||
      ((entry.lastSeen ?? "") === (kept.lastSeen ?? "") && entry.count >= kept.count);
    if (newer) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort(newestFirst);
}

const resourceKey = (namespace: string, kind: string, name: string) => `${namespace}\u0000${kind}\u0000${name}`;

/** Every resource a commit holds, in any namespace. */
function resourcesOf(commit: OpenShiftCommitData): OpenShiftResource[] {
  return commit.namespaces.flatMap(ns => [
    ...ns.builds,
    ...ns.imageStreamTags,
    ...ns.deployments,
    ...ns.deploymentConfigs,
    ...ns.pods,
  ]);
}

/**
 * Each commit's warnings: those about a resource it holds (by namespace, kind and name), and those about a
 * ReplicaSet or ReplicationController whose Deployment or DeploymentConfig it holds. A warning about a resource no
 * commit holds is left out: there is nowhere to show it.
 */
export function linkWarningsToCommits(
  warnings: readonly OpenShiftWarning[],
  commits: ReadonlyMap<string, OpenShiftCommitData>,
  controllers: readonly OpenShiftControllerReference[] = [],
): Map<string, OpenShiftWarning[]> {
  const shaByResource = new Map<string, string>();
  const shaByWorkloadUid = new Map<string, string>();
  for (const [sha, commit] of commits)
    for (const resource of resourcesOf(commit)) {
      shaByResource.set(resourceKey(resource.namespace, resource.kind, resource.name), sha);
      if (resource.uid && (resource.kind === "Deployment" || resource.kind === "DeploymentConfig"))
        shaByWorkloadUid.set(`${resource.namespace}\u0000${resource.uid}`, sha);
    }
  const shaByController = new Map<string, string>();
  for (const controller of controllers)
    for (const owner of controller.ownerReferences) {
      const sha = shaByWorkloadUid.get(`${controller.namespace}\u0000${owner.uid}`);
      if (sha) shaByController.set(`${controller.namespace}\u0000${controller.uid}`, sha);
    }
  const linked = new Map<string, OpenShiftWarning[]>();
  for (const entry of warnings) {
    const sha =
      shaByResource.get(resourceKey(entry.namespace, entry.kind, entry.name)) ??
      (entry.uid ? shaByController.get(`${entry.namespace}\u0000${entry.uid}`) : undefined);
    if (!sha) continue;
    const list = linked.get(sha) ?? [];
    list.push(entry);
    linked.set(sha, list);
  }
  for (const [sha, list] of linked) linked.set(sha, list.sort(newestFirst));
  return linked;
}

/** Whether two lists hold the same warnings, each read the same: nothing to show or save again. */
export function sameWarnings(a: readonly OpenShiftWarning[], b: readonly OpenShiftWarning[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, i) => {
      const other = b[i];
      return other?.id === entry.id && other.count === entry.count && other.lastSeen === entry.lastSeen;
    })
  );
}

const RESOURCE_KINDS: ReadonlySet<string> = new Set<OpenShiftResourceKind>([
  "Build",
  "ImageStreamTag",
  "Deployment",
  "DeploymentConfig",
  "Pod",
]);

/**
 * The resource a warning is about, to open: the commit's own, or one with only its name when the commit no longer has
 * it (a pod that was replaced). Null for a kind codepulse doesn't show (a ReplicaSet).
 */
export function resourceOfWarning(
  warning: OpenShiftWarning,
  commit: OpenShiftCommitData | null,
): OpenShiftResource | null {
  if (!RESOURCE_KINDS.has(warning.kind)) return null;
  const own = commit ? warningsTarget(commit, warning) : undefined;
  if (own) return own;
  return {
    id: `${warning.namespace}/${warning.kind}/${warning.name}`,
    kind: warning.kind as OpenShiftResourceKind,
    namespace: warning.namespace,
    name: warning.name,
    status: "unknown",
    imageRefs: [],
  };
}

const warningsTarget = (commit: OpenShiftCommitData, warning: OpenShiftWarning) =>
  resourcesOf(commit).find(
    resource =>
      resource.namespace === warning.namespace && resource.kind === warning.kind && resource.name === warning.name,
  );

/** The warnings about one resource. */
export function warningsAbout(resource: OpenShiftResource, warnings: readonly OpenShiftWarning[]): OpenShiftWarning[] {
  return warnings.filter(
    entry => entry.namespace === resource.namespace && entry.kind === resource.kind && entry.name === resource.name,
  );
}
