/** OpenShift resources read from the cluster's objects: their status, commit and images, the commit map and the graph's badges. */
import type { GraphBadge, GraphStatusCounts, NamespaceMarker } from "../provider-model";
import {
  OPENSHIFT_WATCH_KINDS,
  type OpenShiftCommitData,
  type OpenShiftControllerReference,
  type OpenShiftInventoryKind,
  type OpenShiftListedInventory,
  type OpenShiftOwnerReference,
  type OpenShiftResource,
  type OpenShiftResourceKind,
  type OpenShiftStatus,
  type OpenShiftStatusRow,
} from "./types";
import type { OpenShiftWarning } from "./warnings";
import { isOpenShiftWatchGone, type OpenShiftWatchEvent } from "./watch";

type AnyObj = Record<string, unknown>;

export function isTerminalBuildStatus(status: OpenShiftStatus): boolean {
  return status === "pass" || status === "fail" || status === "cancelled";
}

export function normalizeOpenShiftServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function openShiftApiUrl(serverUrl: string, path: string): string {
  return `${normalizeOpenShiftServerUrl(serverUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function obj(value: unknown): AnyObj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as AnyObj) : null;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function metadata(item: unknown): AnyObj {
  return obj(obj(item)?.metadata) ?? {};
}

function ownerReferences(item: unknown): OpenShiftOwnerReference[] {
  return arr(metadata(item).ownerReferences).flatMap(value => {
    const reference = obj(value);
    const kind = str(reference?.kind);
    const uid = str(reference?.uid);
    return kind && uid ? [{ kind, uid }] : [];
  });
}

function annotations(item: unknown): AnyObj {
  return obj(metadata(item).annotations) ?? {};
}

export function annotation(item: unknown, key: string): string | undefined {
  return str(annotations(item)[key]);
}

function labels(item: unknown): AnyObj {
  return obj(metadata(item).labels) ?? {};
}

export function labelValue(item: unknown, key: string): string | undefined {
  return str(labels(item)[key]);
}

function annotationBag(value: unknown): AnyObj {
  const parsed = obj(value);
  return obj(parsed?.annotations) ?? obj(obj(parsed?.metadata)?.annotations) ?? {};
}

/** Label first, then metadata / tag / nested image annotations. */
export function commitShaFromItem(item: unknown, key: string): string | undefined {
  return (
    labelValue(item, key) ??
    str(annotationBag(item)[key]) ??
    str(annotationBag(obj(item)?.tag)[key]) ??
    str(annotationBag(obj(item)?.image)[key])
  );
}

export function commitLabelSelector(key: string, shas: readonly string[]): string | null {
  const values = [...new Set(shas.map(sha => sha.toLowerCase()).filter(sha => /^[0-9a-f]{40,64}$/i.test(sha)))];
  if (values.length === 0) return null;
  return `labelSelector=${encodeURIComponent(`${key} in (${values.join(",")})`)}`;
}

export function matchLabelsSelector(matchLabels: Record<string, string>): string | null {
  const parts = Object.entries(matchLabels).filter(([name, value]) => name && value);
  if (parts.length === 0) return null;
  return `labelSelector=${encodeURIComponent(parts.map(([name, value]) => `${name}=${value}`).join(","))}`;
}

function podSelectorFrom(item: unknown): Record<string, string> | undefined {
  const matchLabels = obj(obj(obj(item)?.spec)?.selector)?.matchLabels;
  const parsed = obj(matchLabels);
  if (!parsed) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function imageTokens(ref: string | undefined): string[] {
  if (!ref) return [];
  const out = new Set<string>([ref]);
  const digest = ref.match(/sha256:[a-fA-F0-9]+/)?.[0];
  if (digest) out.add(digest);
  const tail = ref.split("/").at(-1);
  if (tail) out.add(tail);
  return [...out];
}

/** Replicas a Deployment or DeploymentConfig asks for: 1 when unset, 0 for a DeploymentConfig in test mode. */
function desiredReplicas(spec: Record<string, unknown>): number {
  return spec.test === true ? 0 : typeof spec.replicas === "number" ? spec.replicas : 1;
}

function workloadStatus(item: unknown): OpenShiftStatus {
  const md = metadata(item);
  const spec = obj(obj(item)?.spec) ?? {};
  const status = obj(obj(item)?.status) ?? {};
  const conditions = arr(status.conditions).map(condition => obj(condition) ?? {});
  const generation = typeof md.generation === "number" ? md.generation : null;
  const observedGeneration = typeof status.observedGeneration === "number" ? status.observedGeneration : null;
  const paused = spec.paused === true;
  if (generation !== null && observedGeneration !== null && observedGeneration < generation)
    return paused ? "unknown" : "running";

  const hasCondition = (types: string[], expectedStatus: string, reasons?: string[]) =>
    conditions.some(condition => {
      if (!types.includes(String(condition.type)) || condition.status !== expectedStatus) return false;
      return !reasons || reasons.includes(String(condition.reason));
    });
  if (hasCondition(["Failed", "Degraded", "ReplicaFailure"], "True") || hasCondition(["Progressing"], "False"))
    return "fail";

  const replicaFields = ["replicas", "updatedReplicas", "availableReplicas", "unavailableReplicas"] as const;
  const hasReplicaStatus = replicaFields.some(field => typeof status[field] === "number");
  const desired = desiredReplicas(spec);
  if (desired === 0) {
    const replicas = typeof status.replicas === "number" ? status.replicas : 0;
    const updated = typeof status.updatedReplicas === "number" ? status.updatedReplicas : 0;
    const available = typeof status.availableReplicas === "number" ? status.availableReplicas : 0;
    const unavailable = typeof status.unavailableReplicas === "number" ? status.unavailableReplicas : 0;
    return replicas === 0 && updated === 0 && available === 0 && unavailable === 0 ? "pass" : "running";
  }
  if (hasReplicaStatus) {
    const replicas = typeof status.replicas === "number" ? status.replicas : 0;
    const updated = typeof status.updatedReplicas === "number" ? status.updatedReplicas : 0;
    const available = typeof status.availableReplicas === "number" ? status.availableReplicas : 0;
    const unavailable =
      typeof status.unavailableReplicas === "number" ? status.unavailableReplicas : Math.max(desired - available, 0);
    return replicas === desired && updated === desired && available === desired && unavailable === 0
      ? "pass"
      : "running";
  }

  if (hasCondition(["Available", "Complete", "Completed"], "True")) return "pass";
  if (hasCondition(["Progressing", "Pending"], "True") || hasCondition(["Available"], "False")) return "running";
  return "unknown";
}

const FATAL_WAITING_REASONS = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerError",
  "CreateContainerConfigError",
  "InvalidImageName",
  "RunContainerError",
]);

/** A container that makes its Pod fail: waiting on a fatal reason, or ended with a non-zero exit code. */
function isFatalContainer(container: unknown): boolean {
  const state = obj(obj(container)?.state) ?? {};
  const waitingReason = str(obj(state.waiting)?.reason);
  const terminated = obj(state.terminated);
  return (
    (waitingReason !== undefined && FATAL_WAITING_REASONS.has(waitingReason)) ||
    (terminated?.reason !== "Completed" && typeof terminated?.exitCode === "number" && terminated.exitCode !== 0)
  );
}

function podContainerStatuses(pod: unknown): unknown[] {
  const status = obj(obj(pod)?.status) ?? {};
  return [...arr(status.initContainerStatuses), ...arr(status.containerStatuses)];
}

function podStatus(pod: unknown): OpenShiftStatus {
  const phase = str(obj(pod)?.status && obj(obj(pod)?.status)?.phase);
  if (str(metadata(pod).deletionTimestamp)) return "unknown";
  const status = obj(obj(pod)?.status) ?? {};
  if (podContainerStatuses(pod).some(isFatalContainer)) return "fail";
  if (phase === "Failed") return "fail";
  if (phase === "Succeeded") return "pass";
  if (phase === "Pending") return "running";
  if (phase === "Running") {
    const ready = arr(status.conditions).find(condition => obj(condition)?.type === "Ready");
    return obj(ready)?.status === "True" ? "pass" : "running";
  }
  return "unknown";
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One thing a resource's status says is wrong: `waiting  CrashLoopBackOff  back-off 5m0s restarting…`. */
export type { OpenShiftStatusRow } from "./types";

/** Workload conditions in the state that says something is wrong; the healthy ones are left out. */
const PROBLEM_CONDITIONS: Record<string, string> = {
  Available: "False",
  Progressing: "False",
  ReplicaFailure: "True",
  Failed: "True",
  Degraded: "True",
};

/** `OOMKilled · exit 137`, `Error · exit 1`: how a container run ended. */
function endedText(terminated: AnyObj): string {
  const code = typeof terminated.exitCode === "number" ? ` · exit ${terminated.exitCode}` : "";
  return `${str(terminated.reason) ?? "Error"}${code}`;
}

/**
 * Why a resource is unhealthy, from its status, which outlives its events (3 hours): what a Pod's containers wait on
 * or how they ended, its conditions that are False, a workload's failing conditions, a Build's failure.
 */
export function openShiftStatusRows(kind: OpenShiftResourceKind, object: unknown): OpenShiftStatusRow[] {
  const status = obj(obj(object)?.status);
  if (!status) return [];
  const row = (label: string, reason: string | undefined, message: unknown): OpenShiftStatusRow => ({
    status: label,
    reason: reason ?? "",
    message: str(message) ?? "",
  });
  if (kind === "Pod") {
    const rows: OpenShiftStatusRow[] = [];
    const podReason = str(status.reason);
    if (podReason) rows.push(row(str(status.phase) ?? "Pod", podReason, status.message));
    const containers = [...arr(status.initContainerStatuses), ...arr(status.containerStatuses)].map(
      container => obj(container) ?? {},
    );
    // With several containers each row names its own.
    const label = (text: string, container: AnyObj) =>
      containers.length > 1 && str(container.name) ? `${text} ${container.name}` : text;
    for (const container of containers) {
      const state = obj(container.state) ?? {};
      const waiting = obj(state.waiting);
      if (waiting) rows.push(row(label("waiting", container), str(waiting.reason), waiting.message));
      const ended = obj(state.terminated);
      if (ended) rows.push(row(label("ended", container), endedText(ended), ended.message));
      const lastRun = obj(obj(container.lastState)?.terminated);
      const restarts = typeof container.restartCount === "number" ? container.restartCount : 0;
      if (lastRun)
        rows.push(
          row(
            label("last run", container),
            [endedText(lastRun), restarts > 0 ? plural(restarts, "restart") : ""].filter(Boolean).join(" · "),
            lastRun.message,
          ),
        );
    }
    for (const condition of arr(status.conditions).map(value => obj(value) ?? {}))
      if (condition.status === "False")
        rows.push(row(`${condition.type} False`, str(condition.reason), condition.message));
    return rows;
  }
  if (kind === "Deployment" || kind === "DeploymentConfig")
    return arr(status.conditions)
      .map(value => obj(value) ?? {})
      .filter(condition => PROBLEM_CONDITIONS[String(condition.type)] === condition.status)
      .map(condition => row(`${condition.type} ${condition.status}`, str(condition.reason), condition.message));
  if (kind === "Build" && buildStatus(object) === "fail")
    return [row(str(status.phase) ?? "Failed", str(status.reason), status.message)];
  return [];
}

/** A Build's status from its object's phase. */
export function buildStatus(build: unknown): OpenShiftStatus {
  const phase = str(obj(build)?.status && obj(obj(build)?.status)?.phase);
  switch (phase) {
    case "Complete":
      return "pass";
    case "Running":
    case "Pending":
    case "New":
      return "running";
    case "Failed":
    case "Error":
      return "fail";
    case "Cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function baseResource(
  kind: OpenShiftResource["kind"],
  namespace: string,
  item: unknown,
): Omit<OpenShiftResource, "status" | "imageRefs"> {
  const md = metadata(item);
  const name = str(md.name) ?? "unknown";
  return {
    id: `${kind}:${namespace}:${name}`,
    kind,
    namespace,
    name,
    uid: str(md.uid),
    ownerReferences: ownerReferences(item),
    terminating: str(md.deletionTimestamp) !== undefined,
    updatedAt: str(md.creationTimestamp) ?? null,
    labels: stringLabels(item),
  };
}

function stringLabels(item: unknown): Record<string, string> | undefined {
  const raw = labels(item);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" && value) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function matchesPodSelector(
  podLabels: Record<string, string> | undefined,
  selector: Record<string, string> | undefined,
): boolean {
  if (!selector || Object.keys(selector).length === 0) return false;
  const present = podLabels ?? {};
  return Object.entries(selector).every(([name, value]) => present[name] === value);
}

export function extractBuild(namespace: string, item: unknown, annotationKey: string): OpenShiftResource | null {
  const commitSha = commitShaFromItem(item, annotationKey);
  if (!commitSha) return null;
  const status = obj(item)?.status;
  const output = obj(obj(obj(item)?.spec)?.output);
  const ref = str(obj(status)?.outputDockerImageReference) ?? str(obj(output?.to)?.name);
  return {
    ...baseResource("Build", namespace, item),
    status: buildStatus(item),
    imageRefs: imageTokens(ref),
    commitSha,
    object: item,
  };
}

export function extractImageStreamTag(
  namespace: string,
  item: unknown,
  annotationKey: string,
): OpenShiftResource | null {
  const commitSha = commitShaFromItem(item, annotationKey);
  if (!commitSha) return null;
  const image = obj(item)?.image;
  const ref = str(obj(image)?.dockerImageReference);
  const digest = str(obj(image)?.metadata && obj(obj(image)?.metadata)?.name) ?? str(obj(image)?.dockerImageReference);
  return {
    ...baseResource("ImageStreamTag", namespace, item),
    status: digest?.includes("sha256:") ? "pass" : "unknown",
    imageRefs: imageTokens(ref),
    commitSha,
  };
}

function containerImages(spec: unknown): string[] {
  return arr(
    obj(obj(spec)?.template)?.spec ? obj(obj(obj(spec)?.template)?.spec)?.containers : obj(spec)?.containers,
  ).flatMap(c => imageTokens(str(obj(c)?.image)));
}

export function extractWorkload(
  kind: "Deployment" | "DeploymentConfig",
  namespace: string,
  item: unknown,
  annotationKey: string,
): OpenShiftResource {
  const status = workloadStatus(item);
  return {
    ...baseResource(kind, namespace, item),
    status,
    ...failingRows(status, kind, item),
    scaledToZero: desiredReplicas(obj(obj(item)?.spec) ?? {}) === 0 || undefined,
    imageRefs: containerImages(obj(item)?.spec),
    commitSha: commitShaFromItem(item, annotationKey),
    podSelector: podSelectorFrom(item),
  };
}

export function extractPod(namespace: string, item: unknown): OpenShiftResource {
  const statuses = arr(obj(obj(item)?.status)?.containerStatuses);
  const imageRefs = statuses.flatMap(s => [...imageTokens(str(obj(s)?.image)), ...imageTokens(str(obj(s)?.imageID))]);
  const status = podStatus(item);
  return {
    ...baseResource("Pod", namespace, item),
    status,
    imageRefs,
    ...failingRows(status, "Pod", item),
  };
}

/** A failing resource's status rows, kept without its object. */
function failingRows(status: OpenShiftStatus, kind: OpenShiftResourceKind, item: unknown): Partial<OpenShiftResource> {
  if (status !== "fail") return {};
  const rows = openShiftStatusRows(kind, item);
  return rows.length > 0 ? { statusRows: rows } : {};
}

export function resourceFromWatchObject(object: unknown, annotationKey: string): OpenShiftResource | null {
  const kind = str(obj(object)?.kind);
  const namespace = str(metadata(object).namespace);
  if (!kind || !namespace) return null;
  if (kind === "Deployment" || kind === "DeploymentConfig")
    return extractWorkload(kind, namespace, object, annotationKey);
  if (kind === "Pod") return extractPod(namespace, object);
  return null;
}

export function applyOpenShiftWatchEvent(
  listed: OpenShiftListedInventory,
  event: OpenShiftWatchEvent,
  annotationKey: string,
): "gone" | "applied" | "ignored" {
  if (isOpenShiftWatchGone(event)) return "gone";
  if (event.type === "BOOKMARK" || event.type === "ERROR") return "ignored";
  const resource = resourceFromWatchObject(event.object, annotationKey);
  if (!resource || !(OPENSHIFT_WATCH_KINDS as readonly string[]).includes(resource.kind)) return "ignored";
  if (event.type === "DELETED") {
    listed.resources = listed.resources.filter(item => item.id !== resource.id);
    return "applied";
  }
  if (event.type !== "ADDED" && event.type !== "MODIFIED") return "ignored";
  const index = listed.resources.findIndex(item => item.id === resource.id);
  if (index >= 0) listed.resources[index] = resource;
  else listed.resources.push(resource);
  return "applied";
}

export function openShiftKindPath(namespace: string, kind: OpenShiftInventoryKind): string {
  return buildPath(encodeURIComponent(namespace), kind);
}

export function extractController(
  kind: OpenShiftControllerReference["kind"],
  namespace: string,
  item: unknown,
): OpenShiftControllerReference | null {
  const uid = str(metadata(item).uid);
  if (!uid) return null;
  const createdAt = str(metadata(item).creationTimestamp);
  return { kind, namespace, uid, ...(createdAt ? { createdAt } : {}), ownerReferences: ownerReferences(item) };
}

export function openShiftBuildLogUrl(serverUrl: string, namespace: string, buildName: string, follow = false): string {
  const path = `/apis/build.openshift.io/v1/namespaces/${encodeURIComponent(namespace)}/builds/${encodeURIComponent(buildName)}/log`;
  return openShiftApiUrl(serverUrl, follow ? `${path}?follow=true` : path);
}

export function openShiftPodLogUrl(
  serverUrl: string,
  namespace: string,
  podName: string,
  container?: string,
  follow = false,
): string {
  const params = new URLSearchParams();
  if (container) params.set("container", container);
  if (follow) params.set("follow", "true");
  const query = params.toString();
  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log`;
  return openShiftApiUrl(serverUrl, query ? `${path}?${query}` : path);
}

function add(nsMap: Map<string, OpenShiftCommitData>, sha: string, resource: OpenShiftResource) {
  sha = sha.toLowerCase();
  const data = nsMap.get(sha) ?? { sha, namespaces: [], liveFetched: false };
  let ns = data.namespaces.find(n => n.namespace === resource.namespace);
  if (!ns) {
    ns = {
      namespace: resource.namespace,
      builds: [],
      imageStreamTags: [],
      deployments: [],
      deploymentConfigs: [],
      pods: [],
    };
    data.namespaces.push(ns);
  }
  const target =
    resource.kind === "Build"
      ? ns.builds
      : resource.kind === "ImageStreamTag"
        ? ns.imageStreamTags
        : resource.kind === "Deployment"
          ? ns.deployments
          : resource.kind === "DeploymentConfig"
            ? ns.deploymentConfigs
            : ns.pods;
  if (!target.some(existing => existing.id === resource.id)) target.push(resource);
  nsMap.set(sha, data);
}

function inventoryKey(namespace: string, kind: string, uid: string): string {
  return `${namespace}:${kind}:${uid}`;
}

export function buildOpenShiftCommitMap(
  resources: OpenShiftResource[],
  controllers: OpenShiftControllerReference[] = [],
): Map<string, OpenShiftCommitData> {
  const map = new Map<string, OpenShiftCommitData>();
  const tokensBySha = new Map<string, Set<string>>();
  const matchedPods: { sha: string; pod: OpenShiftResource }[] = [];
  const controllerByUid = new Map(
    controllers.map(controller => [inventoryKey(controller.namespace, controller.kind, controller.uid), controller]),
  );
  const workloadByUid = new Map(
    resources.flatMap(resource =>
      resource.uid && (resource.kind === "Deployment" || resource.kind === "DeploymentConfig")
        ? [[inventoryKey(resource.namespace, resource.kind, resource.uid), resource] as const]
        : [],
    ),
  );
  for (const r of resources.filter(r => r.commitSha)) {
    const sha = r.commitSha;
    if (!sha) continue;
    add(map, sha, r);
    const set = tokensBySha.get(sha) ?? new Set<string>();
    for (const token of r.imageRefs.flatMap(imageDigests)) set.add(token);
    tokensBySha.set(sha, set);
  }
  for (const r of resources.filter(r => !r.commitSha)) {
    if (r.kind === "Pod" && r.terminating) continue;
    // The commits its image is from: during a rollout an old pod still matches the Deployment's selector, but runs
    // the previous commit's image, so a known image wins over the selector.
    const digests = r.imageRefs.flatMap(imageDigests);
    const byImage = new Set(
      [...tokensBySha].filter(([, tokens]) => digests.some(ref => tokens.has(ref))).map(([sha]) => sha),
    );
    if (r.kind === "Pod") {
      for (const deploy of resources) {
        if (deploy.kind !== "Deployment" && deploy.kind !== "DeploymentConfig") continue;
        if (!deploy.commitSha || deploy.namespace !== r.namespace) continue;
        if (!matchesPodSelector(r.labels, deploy.podSelector)) continue;
        if (byImage.size > 0 && !byImage.has(deploy.commitSha)) continue;
        add(map, deploy.commitSha, { ...r, commitSha: deploy.commitSha });
        matchedPods.push({ sha: deploy.commitSha, pod: r });
      }
    }
    for (const sha of byImage) {
      add(map, sha, r);
      if (r.kind === "Pod") matchedPods.push({ sha, pod: r });
    }
  }
  for (const { sha, pod } of matchedPods) {
    for (const podOwner of pod.ownerReferences ?? []) {
      const expected =
        podOwner.kind === "ReplicaSet"
          ? { controllerKind: "ReplicaSet" as const, workloadKind: "Deployment" as const }
          : podOwner.kind === "ReplicationController"
            ? { controllerKind: "ReplicationController" as const, workloadKind: "DeploymentConfig" as const }
            : null;
      if (!expected) continue;
      const controller = controllerByUid.get(inventoryKey(pod.namespace, expected.controllerKind, podOwner.uid));
      if (!controller) continue;
      for (const workloadOwner of controller.ownerReferences) {
        if (workloadOwner.kind !== expected.workloadKind) continue;
        const workload = workloadByUid.get(inventoryKey(pod.namespace, expected.workloadKind, workloadOwner.uid));
        if (workload) add(map, sha, workload);
      }
    }
  }
  return map;
}

function imageDigests(ref: string): string[] {
  return ref.match(/(?:sha256:)[a-fA-F0-9]+/g) ?? [];
}

function statusCounts(resources: readonly OpenShiftResource[]): GraphStatusCounts {
  return {
    failCount: resources.filter(r => r.status === "fail").length,
    runningCount: resources.filter(r => r.status === "running").length,
    passCount: resources.filter(r => r.status === "pass").length,
    // Neutral, as CI counts its cancelled runs: a grey chip.
    unknownCount: resources.filter(r => r.status === "unknown" || r.status === "cancelled").length,
  };
}

function worstStatus(counts: GraphStatusCounts): GraphBadge["badge"] {
  if (counts.failCount > 0) return "fail";
  if (counts.runningCount > 0) return "running";
  if (counts.unknownCount > 0) return "unknown";
  return "pass";
}

const MARKER_RANK: Record<NamespaceMarker["state"], number> = { live: 0, rolling: 1, fail: 2 };

/**
 * The namespaces each commit runs in now, from the listed Deployments and DeploymentConfigs (every one in the
 * namespace, not only the fetch window): ready is `live`, a rollout in progress `rolling`, a failing one `fail`.
 * One marker per namespace and commit, the most telling state winning; in the configured namespace order.
 */
export function buildOpenShiftNamespaceMarkers(
  resources: readonly OpenShiftResource[],
  namespaces: readonly string[],
): Map<string, NamespaceMarker[]> {
  const byCommit = new Map<string, Map<string, NamespaceMarker["state"]>>();
  for (const resource of resources) {
    if (resource.kind !== "Deployment" && resource.kind !== "DeploymentConfig") continue;
    // Scaled to 0, it runs nothing: no badge (the detail panel still lists it, `0 replicas`).
    if (!resource.commitSha || resource.terminating || resource.scaledToZero) continue;
    const state = resource.status === "pass" ? "live" : resource.status === "running" ? "rolling" : resource.status;
    // Only a Build is ever cancelled; a workload's unknown state marks nothing.
    if (state === "unknown" || state === "cancelled") continue;
    const sha = resource.commitSha.toLowerCase();
    const states = byCommit.get(sha) ?? new Map<string, NamespaceMarker["state"]>();
    const previous = states.get(resource.namespace);
    if (!previous || MARKER_RANK[state] > MARKER_RANK[previous]) states.set(resource.namespace, state);
    byCommit.set(sha, states);
  }
  const order = (namespace: string) => {
    const index = namespaces.indexOf(namespace);
    return index < 0 ? namespaces.length : index;
  };
  return new Map(
    [...byCommit].map(([sha, states]) => [
      sha,
      [...states]
        .map(([namespace, state]) => ({ namespace, state }))
        .sort((a, b) => order(a.namespace) - order(b.namespace) || a.namespace.localeCompare(b.namespace)),
    ]),
  );
}

/**
 * A commit's badges: the status counts of what the cluster lists now, and how many resources only the cache has;
 * the warnings the cluster still reports, and how many only the cache has (`isCachedWarning`; by default none).
 */
/** OpenShift's own counts on a graph badge (`GraphBadge.counts`), each only above zero. */
export interface OpenShiftBadgeCounts {
  /** Its resources only the cache has: the cluster no longer lists them (Resources, muted). */
  cached?: number;
  /** What its failing resources' status says is wrong (Events, red). */
  failures?: number;
  /** The warnings the cluster still reports (Events, the warning color). */
  warnings?: number;
  /** The Normal events the cluster lists now (Events, green). */
  normal?: number;
  /** Its events shown from the cache: a warning OpenShift deleted, or one about a resource that is gone (Events, muted). */
  cachedEvents?: number;
}

/** A badge's OpenShift counts. */
export const openShiftBadgeCounts = (badge: GraphBadge | undefined): OpenShiftBadgeCounts => badge?.counts ?? {};

function badgeCounts(counts: Required<OpenShiftBadgeCounts>): Pick<GraphBadge, "counts"> {
  const above = Object.entries(counts).filter(([, count]) => count > 0);
  return above.length > 0 ? { counts: Object.fromEntries(above) } : {};
}

export function buildOpenShiftGraphBadges(
  data: Map<string, OpenShiftCommitData>,
  isCachedWarning: (sha: string, warning: OpenShiftWarning) => boolean = () => false,
  /** A Normal event or a failure: cached only when what it is about is gone. */
  isAboutGoneResource: (sha: string, event: OpenShiftWarning) => boolean = () => false,
): Map<string, GraphBadge> {
  const badges = new Map<string, GraphBadge>();
  for (const [sha, entry] of data) {
    const resources = entry.namespaces.flatMap(ns => [
      ...ns.pods,
      ...ns.deployments,
      ...ns.deploymentConfigs,
      ...ns.builds,
      ...ns.imageStreamTags,
    ]);
    const warnings = entry.warnings ?? [];
    const normal = entry.normalEvents ?? [];
    const cachedWarnings = warnings.filter(warning => isCachedWarning(sha, warning)).length;
    const warningCount = warnings.length - cachedWarnings;
    const goneNormal = normal.filter(event => isAboutGoneResource(sha, event)).length;
    const normalEventCount = normal.length - goneNormal;
    // A failure is the status of what it is about: shown from the cache once that is gone (a pruned Build).
    const failures = entry.failures ?? [];
    const goneFailures = failures.filter(failure => isAboutGoneResource(sha, failure)).length;
    const failureCount = failures.length - goneFailures;
    const cachedEventCount = cachedWarnings + goneNormal + goneFailures;
    if (resources.length === 0 && warnings.length === 0 && normal.length === 0) continue;
    const listed = resources.filter(resource => !resource.cacheOnly);
    const cachedCount = resources.length - listed.length;
    const totals = statusCounts(resources);
    const badge = worstStatus(totals);
    badges.set(sha, {
      sha,
      badge,
      ...totals,
      resourceCount: resources.length,
      lanes: { live: statusCounts(listed) },
      latestRunAt: "",
      latestStatus: badge,
      ...badgeCounts({
        cached: cachedCount,
        failures: failureCount,
        warnings: warningCount,
        normal: normalEventCount,
        cachedEvents: cachedEventCount,
      }),
    });
  }
  return badges;
}

/** A namespace's list path for a kind of resource. */
export function buildPath(encoded: string, kind: OpenShiftInventoryKind): string {
  switch (kind) {
    case "Build":
      return `/apis/build.openshift.io/v1/namespaces/${encoded}/builds`;
    case "ImageStreamTag":
      return `/apis/image.openshift.io/v1/namespaces/${encoded}/imagestreamtags`;
    case "Deployment":
      return `/apis/apps/v1/namespaces/${encoded}/deployments`;
    case "ReplicaSet":
      return `/apis/apps/v1/namespaces/${encoded}/replicasets`;
    case "DeploymentConfig":
      return `/apis/apps.openshift.io/v1/namespaces/${encoded}/deploymentconfigs`;
    case "ReplicationController":
      return `/api/v1/namespaces/${encoded}/replicationcontrollers`;
    case "Pod":
      return `/api/v1/namespaces/${encoded}/pods`;
  }
}
