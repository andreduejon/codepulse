/**
 * A commit's failures: what the status of each of its failing resources says is wrong, as OpenShift reports it
 * (a container waiting on CrashLoopBackOff, one that ended with an error, a rollout past its deadline, a failed
 * Build). They are the red rows of the Events tab and the red count of the graph's Events column: `✗` comes from a
 * resource's own status, so its failures do too. A failed Build's pod (`<build>-build`, owned by the Build) says
 * which step failed. Not events: nothing keeps them once the resource is fine or gone.
 */
import { openShiftStatusRows } from "./resources";
import type { OpenShiftCommitData, OpenShiftResource, OpenShiftStatusRow } from "./types";
import type { OpenShiftWarning } from "./warnings";

/** One failure, in a warning's shape so the Events tab lists it the same way. */
export interface OpenShiftFailure extends OpenShiftWarning {
  /** Which part of the status says it: `waiting`, `last run`, `ended docker-build`, `Progressing False`. */
  status: string;
}

/**
 * A row that says something is wrong: a step that ended well (`Completed · exit 0`) is not one, nor a finished pod's
 * `Ready False` (`PodCompleted`).
 */
export const isStatusProblem = (row: OpenShiftStatusRow) => !!row.reason && !/^(Pod)?Completed\b/.test(row.reason);
/** A condition row (`Ready False`): for a Pod, only a symptom of what its containers say. */
const isCondition = (row: OpenShiftStatusRow) => row.status.endsWith(" False");

/** What a failing resource's status says is wrong. */
function rowsOf(resource: OpenShiftResource): OpenShiftStatusRow[] {
  if (resource.status !== "fail") return [];
  const rows = (
    resource.kind === "Build" ? openShiftStatusRows("Build", resource.object) : (resource.statusRows ?? [])
  ).filter(isStatusProblem);
  if (resource.kind !== "Pod") return rows;
  // A Pod's conditions only when its containers say nothing (an evicted pod says it in its own reason).
  const direct = rows.filter(row => !isCondition(row));
  return direct.length > 0 ? direct : rows;
}

function failuresOf(resource: OpenShiftResource): OpenShiftFailure[] {
  return rowsOf(resource).map(row => ({
    id: `status:${resource.namespace}:${resource.kind}:${resource.name}:${row.status}:${row.reason}`,
    namespace: resource.namespace,
    kind: resource.kind,
    name: resource.name,
    ...(resource.uid ? { uid: resource.uid } : {}),
    // `Error · exit 1 · 61 restarts` is an Error: the rest varies, the reason groups.
    reason: row.reason.split(" · ")[0] ?? row.reason,
    message: row.message || row.reason,
    count: 1,
    firstSeen: null,
    lastSeen: null,
    status: row.status,
  }));
}

/** The pod a Build ran in: owned by it, or labeled with its name. */
export function buildPodOf(
  build: OpenShiftResource,
  pods: readonly OpenShiftResource[],
): OpenShiftResource | undefined {
  return pods.find(
    pod =>
      pod.kind === "Pod" &&
      pod.namespace === build.namespace &&
      ((!!build.uid && (pod.ownerReferences ?? []).some(owner => owner.kind === "Build" && owner.uid === build.uid)) ||
        pod.labels?.["openshift.io/build.name"] === build.name),
  );
}

/** Every failure of a commit's resources, and of its failed Builds' pods (from the live list: no commit holds them). */
export function commitFailures(
  commit: OpenShiftCommitData,
  buildPods: readonly OpenShiftResource[] = [],
): OpenShiftFailure[] {
  return commit.namespaces.flatMap(ns =>
    [...ns.builds, ...ns.deployments, ...ns.deploymentConfigs, ...ns.pods].flatMap(resource => {
      const own = failuresOf(resource);
      if (resource.kind !== "Build" || resource.status !== "fail") return own;
      const pod = buildPodOf(resource, buildPods);
      return pod ? [...own, ...failuresOf(pod)] : own;
    }),
  );
}
