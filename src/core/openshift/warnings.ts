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

interface Held {
  sha: string;
  resource: OpenShiftResource;
}

/**
 * Each commit's warnings: those about a resource it holds (by namespace, kind and name, and uid), and those about a
 * ReplicaSet or ReplicationController: the commit whose pods it runs, else its Deployment or DeploymentConfig's.
 * A resource several commits hold (a pod two of them match) has its warnings in each. A Deployment keeps its name
 * across commits, and during a rollout the previous commit holds it too through its old pods: its warning goes only
 * to the commit it runs (the commit it names, else the one whose rollout began last), and only when it happened after
 * that commit's rollout began: the later of its newest ReplicaSet or ReplicationController's creation and the
 * commit's oldest pod there (the live list lists ReplicaSets but watches only pods). An earlier one was the previous
 * commit's. A warning about a resource no commit holds is left out: there is nowhere to show it. The result does not
 * depend on the order of `commits`.
 */
export function linkWarningsToCommits(
  warnings: readonly OpenShiftWarning[],
  commits: ReadonlyMap<string, OpenShiftCommitData>,
  controllers: readonly OpenShiftControllerReference[] = [],
): Map<string, OpenShiftWarning[]> {
  const byResource = new Map<string, Held[]>();
  const workloadsByUid = new Map<string, Held[]>();
  /** The commits whose pods each ReplicaSet or ReplicationController runs. */
  const shasByController = new Map<string, Set<string>>();
  /** Each commit's oldest pod per namespace: its rollout there began no later (pods are watched, ReplicaSets not). */
  const oldestPod = new Map<string, string>();
  const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };
  for (const [sha, commit] of commits)
    for (const resource of resourcesOf(commit)) {
      if (resource.kind === "Pod") {
        if (resource.updatedAt) {
          const key = `${sha}\u0000${resource.namespace}`;
          const oldest = oldestPod.get(key);
          if (!oldest || resource.updatedAt < oldest) oldestPod.set(key, resource.updatedAt);
        }
        for (const owner of resource.ownerReferences ?? []) {
          const key = `${resource.namespace}\u0000${owner.uid}`;
          shasByController.set(key, (shasByController.get(key) ?? new Set()).add(sha));
        }
      }
      push(byResource, resourceKey(resource.namespace, resource.kind, resource.name), { sha, resource });
      if (resource.uid && isWorkload(resource.kind))
        push(workloadsByUid, `${resource.namespace}\u0000${resource.uid}`, { sha, resource });
    }
  const rolloutBegan = (sha: string, namespace: string) => oldestPod.get(`${sha}\u0000${namespace}`) ?? "";
  /** The one commit a workload runs: the one it names; without a name, the one whose rollout began last. */
  const runningCommit = (held: readonly Held[]): Held | undefined => {
    const named = held.find(entry => entry.resource.commitSha);
    if (named) return held.find(entry => entry.sha === named.resource.commitSha?.toLowerCase());
    return [...held].sort(
      (a, b) =>
        rolloutBegan(b.sha, b.resource.namespace).localeCompare(rolloutBegan(a.sha, a.resource.namespace)) ||
        b.sha.localeCompare(a.sha),
    )[0];
  };
  /** When each workload's newest rollout began: its newest controller's creation. */
  const rolloutStart = new Map<string, string>();
  const workloadOfController = new Map<string, string>();
  for (const controller of controllers)
    for (const owner of controller.ownerReferences) {
      const key = `${controller.namespace}\u0000${owner.uid}`;
      workloadOfController.set(`${controller.namespace}\u0000${controller.uid}`, key);
      if (controller.createdAt && controller.createdAt > (rolloutStart.get(key) ?? ""))
        rolloutStart.set(key, controller.createdAt);
    }
  const shasOf = (entry: OpenShiftWarning): string[] => {
    const own = (byResource.get(resourceKey(entry.namespace, entry.kind, entry.name)) ?? []).filter(held =>
      sameObject(entry, held.resource),
    );
    if (own.length > 0 && isWorkload(entry.kind)) {
      const running = runningCommit(own);
      if (!running) return [];
      const starts = [
        running.resource.uid ? rolloutStart.get(`${entry.namespace}\u0000${running.resource.uid}`) : undefined,
        oldestPod.get(`${running.sha}\u0000${entry.namespace}`),
      ].filter((time): time is string => !!time);
      const began = starts.sort().at(-1);
      return began && entry.lastSeen && entry.lastSeen < began ? [] : [running.sha];
    }
    if (own.length > 0) return [...new Set(own.map(held => held.sha))];
    if (!entry.uid) return [];
    const controllerKey = `${entry.namespace}\u0000${entry.uid}`;
    const byPods = shasByController.get(controllerKey);
    if (byPods) return [...byPods];
    const workload = workloadOfController.get(controllerKey);
    const running = workload ? runningCommit(workloadsByUid.get(workload) ?? []) : undefined;
    return running ? [running.sha] : [];
  };
  const linked = new Map<string, OpenShiftWarning[]>();
  for (const entry of warnings) for (const sha of shasOf(entry)) push(linked, sha, entry);
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
  "ReplicaSet",
  "ReplicationController",
]);

/**
 * The resource a warning is about, to open: the commit's own, or one with only its name and uid when the commit no
 * longer has it (a pod that was replaced, a ReplicaSet, which no commit holds): the uid keeps a pod recreated under the
 * name out of its events. Null for a kind codepulse doesn't know.
 */
export function resourceOfWarning(
  warning: OpenShiftWarning,
  commit: OpenShiftCommitData | null,
): OpenShiftResource | null {
  if (!RESOURCE_KINDS.has(warning.kind)) return null;
  const own = heldResourceOf(warning, commit);
  if (own) return own;
  return {
    id: `${warning.namespace}/${warning.kind}/${warning.name}`,
    kind: warning.kind as OpenShiftResourceKind,
    namespace: warning.namespace,
    name: warning.name,
    ...(warning.uid ? { uid: warning.uid } : {}),
    status: "unknown",
    imageRefs: [],
  };
}

/**
 * The commit's own resource a warning is about (same name and uid), also one shown only from the cache (a pruned
 * Build): what the resource dialog can open, log and object included.
 */
export function heldResourceOf(
  warning: OpenShiftWarning,
  commit: OpenShiftCommitData | null | undefined,
): OpenShiftResource | undefined {
  return commit ? resourcesOf(commit).find(resource => sameObject(warning, resource)) : undefined;
}

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
  // One shown only from the cache (a Build OpenShift pruned) is no longer in the cluster either.
  return commit ? resourcesOf(commit).some(resource => !resource.cacheOnly && sameObject(warning, resource)) : false;
}

export function warningsAbout(resource: OpenShiftResource, warnings: readonly OpenShiftWarning[]): OpenShiftWarning[] {
  return warnings.filter(entry => sameObject(entry, resource));
}
