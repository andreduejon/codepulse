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

/** Whether a warning is about this object: the same name, and the same uid when both have one (not a recreated one). */
const sameObject = (warning: OpenShiftWarning, resource: OpenShiftResource) =>
  warning.namespace === resource.namespace &&
  warning.kind === resource.kind &&
  warning.name === resource.name &&
  (!warning.uid || !resource.uid || warning.uid === resource.uid);

const isWorkload = (kind: string) => kind === "Deployment" || kind === "DeploymentConfig";

/**
 * Each commit's warnings: those about a resource it holds (by namespace, kind and name, and uid), and those about a
 * ReplicaSet or ReplicationController whose Deployment or DeploymentConfig it holds. A Deployment keeps its name
 * across commits, so its warning goes to the commit it runs only when it happened after that commit's rollout began:
 * the later of its newest ReplicaSet or ReplicationController's creation and the commit's oldest pod there (the live
 * list lists ReplicaSets but watches only pods). An earlier one was the previous commit's. A warning
 * about a resource no commit holds is left out: there is nowhere to show it.
 */
export function linkWarningsToCommits(
  warnings: readonly OpenShiftWarning[],
  commits: ReadonlyMap<string, OpenShiftCommitData>,
  controllers: readonly OpenShiftControllerReference[] = [],
): Map<string, OpenShiftWarning[]> {
  const byResource = new Map<string, { sha: string; resource: OpenShiftResource }>();
  const shaByWorkloadUid = new Map<string, string>();
  /** Each commit's oldest pod per namespace: its rollout there began no later (pods are watched, ReplicaSets not). */
  const oldestPod = new Map<string, string>();
  for (const [sha, commit] of commits)
    for (const resource of resourcesOf(commit)) {
      if (resource.kind === "Pod" && resource.updatedAt) {
        const key = `${sha}\u0000${resource.namespace}`;
        const oldest = oldestPod.get(key);
        if (!oldest || resource.updatedAt < oldest) oldestPod.set(key, resource.updatedAt);
      }
      byResource.set(resourceKey(resource.namespace, resource.kind, resource.name), { sha, resource });
      if (resource.uid && isWorkload(resource.kind))
        shaByWorkloadUid.set(`${resource.namespace}\u0000${resource.uid}`, sha);
    }
  const shaByController = new Map<string, string>();
  /** When each workload's newest rollout began: its newest controller's creation. */
  const rolloutStart = new Map<string, string>();
  for (const controller of controllers)
    for (const owner of controller.ownerReferences) {
      const key = `${controller.namespace}\u0000${owner.uid}`;
      const sha = shaByWorkloadUid.get(key);
      if (sha) shaByController.set(`${controller.namespace}\u0000${controller.uid}`, sha);
      if (controller.createdAt && controller.createdAt > (rolloutStart.get(key) ?? ""))
        rolloutStart.set(key, controller.createdAt);
    }
  const linked = new Map<string, OpenShiftWarning[]>();
  for (const entry of warnings) {
    const held = byResource.get(resourceKey(entry.namespace, entry.kind, entry.name));
    const own = held && sameObject(entry, held.resource) ? held : undefined;
    if (own && isWorkload(entry.kind) && own.resource.uid) {
      const starts = [
        rolloutStart.get(`${entry.namespace}\u0000${own.resource.uid}`),
        oldestPod.get(`${own.sha}\u0000${entry.namespace}`),
      ].filter((time): time is string => !!time);
      const began = starts.sort().at(-1);
      if (began && entry.lastSeen && entry.lastSeen < began) continue;
    }
    const sha = own?.sha ?? (entry.uid ? shaByController.get(`${entry.namespace}\u0000${entry.uid}`) : undefined);
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
/**
 * Whether the commit still has what the warning is about: a resource with its name and uid, or, for a ReplicaSet or
 * ReplicationController, one in the live list. Ask only once the live list loaded: before, nothing is known gone.
 */
export function isAboutPresentResource(
  warning: OpenShiftWarning,
  commit: OpenShiftCommitData | null | undefined,
  controllers: readonly OpenShiftControllerReference[],
): boolean {
  if (warning.kind === "ReplicaSet" || warning.kind === "ReplicationController")
    return (
      !warning.uid ||
      controllers.some(controller => controller.namespace === warning.namespace && controller.uid === warning.uid)
    );
  return commit ? resourcesOf(commit).some(resource => sameObject(warning, resource)) : false;
}

export function warningsAbout(resource: OpenShiftResource, warnings: readonly OpenShiftWarning[]): OpenShiftWarning[] {
  return warnings.filter(entry => sameObject(entry, resource));
}
