import { BANNER, debugError } from "../../debug/banner";
import type { GraphBadge, GraphStatusCounts } from "../provider";
import { fetchWithRetry, isAbortError } from "../shared/http";
import type {
  OpenShiftCommitData,
  OpenShiftControllerReference,
  OpenShiftInventoryFailure,
  OpenShiftInventoryKind,
  OpenShiftInventoryResult,
  OpenShiftOwnerReference,
  OpenShiftResource,
  OpenShiftStatus,
} from "./types";
import { isCachedOpenShiftResource, OPENSHIFT_TERMINAL_PHASES, OPENSHIFT_WATCH_KINDS } from "./types";
import { isValidOpenShiftNamespace } from "./validation";
import { isOpenShiftWatchGone, parseOpenShiftWatchBuffer, type OpenShiftWatchEvent } from "./watch";

export type OpenShiftInventoryMode = "full" | "builds" | "seeds" | "live";

const FETCH_OPTS = { timeoutMs: 15000, attempts: 2, retryDelayMs: 500, timeoutMessage: BANNER.openshift.timeout };

type AnyObj = Record<string, unknown>;

export function getOpenShiftToken(envVar: string): string | null {
  const token = process.env[envVar];
  return token?.trim() ? token : null;
}

export function isTerminalBuildStatus(status: OpenShiftStatus): boolean {
  return status === "pass" || status === "fail";
}

export function isTerminalBuildPhase(phase: string | undefined): boolean {
  return phase !== undefined && OPENSHIFT_TERMINAL_PHASES.has(phase);
}

export function normalizeOpenShiftServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function openShiftApiUrl(serverUrl: string, path: string): string {
  return `${normalizeOpenShiftServerUrl(serverUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function obj(value: unknown): AnyObj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as AnyObj) : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadata(item: unknown): AnyObj {
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
  const values = [
    ...new Set(shas.map(sha => sha.toLowerCase()).filter(sha => /^[0-9a-f]{40,64}$/i.test(sha))),
  ];
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
  const desired = spec.test === true ? 0 : typeof spec.replicas === "number" ? spec.replicas : 1;
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

function podStatus(pod: unknown): OpenShiftStatus {
  const phase = str(obj(pod)?.status && obj(obj(pod)?.status)?.phase);
  if (str(metadata(pod).deletionTimestamp)) return "unknown";
  const status = obj(obj(pod)?.status) ?? {};
  const statuses = [...arr(status.initContainerStatuses), ...arr(status.containerStatuses)];
  const fatalReasons = new Set([
    "CrashLoopBackOff",
    "ImagePullBackOff",
    "ErrImagePull",
    "CreateContainerError",
    "CreateContainerConfigError",
    "InvalidImageName",
    "RunContainerError",
  ]);
  const hasFatalContainer = statuses.some(container => {
    const state = obj(obj(container)?.state) ?? {};
    const waitingReason = str(obj(state.waiting)?.reason);
    const terminated = obj(state.terminated);
    return (
      (waitingReason !== undefined && fatalReasons.has(waitingReason)) ||
      (terminated?.reason !== "Completed" && typeof terminated?.exitCode === "number" && terminated.exitCode !== 0)
    );
  });
  if (hasFatalContainer) return "fail";
  if (phase === "Failed") return "fail";
  if (phase === "Succeeded") return "pass";
  if (phase === "Pending") return "running";
  if (phase === "Running") {
    const ready = arr(status.conditions).find(condition => obj(condition)?.type === "Ready");
    return obj(ready)?.status === "True" ? "pass" : "running";
  }
  return "unknown";
}

function buildStatus(build: unknown): OpenShiftStatus {
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
    case "Cancelled":
      return "fail";
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

function extractBuild(namespace: string, item: unknown, annotationKey: string): OpenShiftResource | null {
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
  };
}

function extractImageStreamTag(namespace: string, item: unknown, annotationKey: string): OpenShiftResource | null {
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

function extractWorkload(
  kind: "Deployment" | "DeploymentConfig",
  namespace: string,
  item: unknown,
  annotationKey: string,
): OpenShiftResource {
  return {
    ...baseResource(kind, namespace, item),
    status: workloadStatus(item),
    imageRefs: containerImages(obj(item)?.spec),
    commitSha: commitShaFromItem(item, annotationKey),
    podSelector: podSelectorFrom(item),
  };
}

function extractPod(namespace: string, item: unknown): OpenShiftResource {
  const statuses = arr(obj(obj(item)?.status)?.containerStatuses);
  const imageRefs = statuses.flatMap(s => [...imageTokens(str(obj(s)?.image)), ...imageTokens(str(obj(s)?.imageID))]);
  return { ...baseResource("Pod", namespace, item), status: podStatus(item), imageRefs };
}

export function resourceFromWatchObject(object: unknown, annotationKey: string): OpenShiftResource | null {
  const kind = str(obj(object)?.kind);
  const namespace = str(metadata(object).namespace);
  if (!kind || !namespace) return null;
  if (kind === "Deployment" || kind === "DeploymentConfig") return extractWorkload(kind, namespace, object, annotationKey);
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

function extractController(
  kind: OpenShiftControllerReference["kind"],
  namespace: string,
  item: unknown,
): OpenShiftControllerReference | null {
  const uid = str(metadata(item).uid);
  if (!uid) return null;
  return { kind, namespace, uid, ownerReferences: ownerReferences(item) };
}

function openshiftInventoryBanner(failures: OpenShiftInventoryFailure[], successfulRequests: number): string | null {
  if (failures.length === 0) return null;
  if (failures.every(failure => failure.error.startsWith("Invalid OpenShift namespace"))) {
    return BANNER.openshift.invalidNamespace;
  }
  return successfulRequests === 0 ? BANNER.openshift.inventoryFailed : BANNER.openshift.inventoryPartial;
}

export function isOpenShiftAuthStatus(status: number): boolean {
  return status === 401;
}

async function fetchList(
  serverUrl: string,
  token: string,
  path: string,
  signal?: AbortSignal,
  query?: string | null,
): Promise<{ items: unknown[]; resourceVersion: string }> {
  const suffix = query ? (path.includes("?") ? `&${query}` : `?${query}`) : "";
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, `${path}${suffix}`),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (isOpenShiftAuthStatus(res.status)) throw new Error(BANNER.openshift.tokenExpired);
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  const body = obj(await res.json());
  return { items: arr(body?.items), resourceVersion: str(obj(body?.metadata)?.resourceVersion) ?? "0" };
}

async function fetchItems(
  serverUrl: string,
  token: string,
  path: string,
  signal?: AbortSignal,
  query?: string | null,
): Promise<unknown[]> {
  return (await fetchList(serverUrl, token, path, signal, query)).items;
}

export async function fetchOpenShiftBuildLog(
  serverUrl: string,
  token: string,
  namespace: string,
  buildName: string,
  signal?: AbortSignal,
): Promise<string> {
  const path = `/apis/build.openshift.io/v1/namespaces/${encodeURIComponent(namespace)}/builds/${encodeURIComponent(buildName)}/log`;
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, path),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "text/plain, */*" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (isOpenShiftAuthStatus(res.status)) throw new Error(BANNER.openshift.tokenExpired);
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return await res.text();
}

export async function fetchOpenShiftPodLog(
  serverUrl: string,
  token: string,
  namespace: string,
  podName: string,
  container?: string,
  signal?: AbortSignal,
): Promise<string> {
  const query = container ? `?container=${encodeURIComponent(container)}` : "";
  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log${query}`;
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, path),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "text/plain, */*" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (isOpenShiftAuthStatus(res.status)) throw new Error(BANNER.openshift.tokenExpired);
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return await res.text();
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

export type OpenShiftWatchResult = "gone" | "end" | "forbidden" | "auth";

export async function watchOpenShiftStream(
  serverUrl: string,
  token: string,
  path: string,
  resourceVersion: string,
  signal: AbortSignal,
  onEvent: (event: OpenShiftWatchEvent) => void,
): Promise<OpenShiftWatchResult> {
  const query = `watch=true&allowWatchBookmarks=true&resourceVersion=${encodeURIComponent(resourceVersion)}`;
  const url = openShiftApiUrl(serverUrl, `${path}?${query}`);
  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (err) {
    if (isAbortError(err, signal)) return "end";
    throw err;
  }
  if (res.status === 410) return "gone";
  if (isOpenShiftAuthStatus(res.status)) return "auth";
  if (res.status === 403) return "forbidden";
  if (!res.ok) throw new Error(`OpenShift ${path} watch failed: ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return "end";
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseOpenShiftWatchBuffer(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (isOpenShiftWatchGone(event)) return "gone";
        onEvent(event);
      }
    }
  } catch (err) {
    if (isAbortError(err, signal)) return "end";
    throw err;
  } finally {
    reader.releaseLock();
  }
  return "end";
}

export async function followOpenShiftLog(
  url: string,
  token: string,
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(url, {
    signal,
    headers: { Authorization: `Bearer ${token}`, Accept: "text/plain, */*" },
  });
  if (isOpenShiftAuthStatus(res.status)) throw new Error(BANNER.openshift.tokenExpired);
  if (!res.ok) throw new Error(`OpenShift log follow failed: ${res.status}`);
  onChunk("");
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) onChunk(text);
    }
  } catch (err) {
    if (isAbortError(err, signal)) return;
    throw err;
  } finally {
    reader.releaseLock();
  }
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
    if (r.kind === "Pod") {
      for (const deploy of resources) {
        if (deploy.kind !== "Deployment" && deploy.kind !== "DeploymentConfig") continue;
        if (!deploy.commitSha || deploy.namespace !== r.namespace) continue;
        if (!matchesPodSelector(r.labels, deploy.podSelector)) continue;
        add(map, deploy.commitSha, { ...r, commitSha: deploy.commitSha });
        matchedPods.push({ sha: deploy.commitSha, pod: r });
      }
    }
    for (const [sha, tokens] of tokensBySha) {
      if (!r.imageRefs.flatMap(imageDigests).some(ref => tokens.has(ref))) continue;
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

export interface OpenShiftListedInventory {
  resources: OpenShiftResource[];
  controllers: OpenShiftControllerReference[];
  failures: OpenShiftInventoryFailure[];
  successfulRequests: number;
  error: string | null;
  resourceVersions: Map<string, string>;
}

export interface OpenShiftFetchOptions {
  commitShas?: string[];
}

type InventoryConfig = { serverUrl: string; namespaces: string[]; commitShaAnnotation: string };

type InventoryRequest = {
  kind: OpenShiftInventoryKind;
  path: string;
  query?: string | null;
  extract: (items: unknown[]) => OpenShiftResource[] | OpenShiftControllerReference[];
};

type ListAcc = {
  resources: OpenShiftResource[];
  controllers: OpenShiftControllerReference[];
  failures: OpenShiftInventoryFailure[];
  successfulRequests: number;
  authFailed: boolean;
  resourceVersions: Map<string, string>;
};

type NsCtx = {
  config: InventoryConfig;
  token: string;
  signal?: AbortSignal;
  ns: string;
  encoded: string;
  key: string;
};

function emptyAcc(): ListAcc {
  return {
    resources: [],
    controllers: [],
    failures: [],
    successfulRequests: 0,
    authFailed: false,
    resourceVersions: new Map(),
  };
}

function buildPath(encoded: string, kind: OpenShiftInventoryKind): string {
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

function resourceObjectPath(resource: OpenShiftResource): string {
  const ns = encodeURIComponent(resource.namespace);
  const name = encodeURIComponent(resource.name);
  switch (resource.kind) {
    case "Build":
      return `/apis/build.openshift.io/v1/namespaces/${ns}/builds/${name}`;
    case "ImageStreamTag":
      return `/apis/image.openshift.io/v1/namespaces/${ns}/imagestreamtags/${name}`;
    case "Deployment":
      return `/apis/apps/v1/namespaces/${ns}/deployments/${name}`;
    case "DeploymentConfig":
      return `/apis/apps.openshift.io/v1/namespaces/${ns}/deploymentconfigs/${name}`;
    case "Pod":
      return `/api/v1/namespaces/${ns}/pods/${name}`;
  }
}

function kindRequest(ctx: NsCtx, kind: OpenShiftInventoryKind, query?: string | null): InventoryRequest {
  const path = buildPath(ctx.encoded, kind);
  const key = ctx.key;
  const ns = ctx.ns;
  const extract: InventoryRequest["extract"] =
    kind === "Build"
      ? items => items.flatMap(item => extractBuild(ns, item, key) ?? [])
      : kind === "ImageStreamTag"
        ? items => items.flatMap(item => extractImageStreamTag(ns, item, key) ?? [])
        : kind === "Deployment"
          ? items => items.map(item => extractWorkload("Deployment", ns, item, key))
          : kind === "DeploymentConfig"
            ? items => items.map(item => extractWorkload("DeploymentConfig", ns, item, key))
            : kind === "Pod"
              ? items => items.map(item => extractPod(ns, item))
              : kind === "ReplicaSet"
                ? items => items.flatMap(item => extractController("ReplicaSet", ns, item) ?? [])
                : items => items.flatMap(item => extractController("ReplicationController", ns, item) ?? []);
  return { kind, path, query, extract };
}

function recordFailure(acc: ListAcc, ns: string, kind: OpenShiftInventoryKind, path: string, error: string): void {
  acc.failures.push({ namespace: ns, kind, path, error });
  if (error === BANNER.openshift.tokenExpired) acc.authFailed = true;
}

function absorb(acc: ListAcc, kind: OpenShiftInventoryKind, extracted: InventoryRequest["extract"] extends (i: unknown[]) => infer R ? R : never): void {
  acc.successfulRequests++;
  if (kind === "ReplicaSet" || kind === "ReplicationController")
    acc.controllers.push(...(extracted as OpenShiftControllerReference[]));
  else acc.resources.push(...(extracted as OpenShiftResource[]));
}

async function runRequests(ctx: NsCtx, requests: InventoryRequest[], acc: ListAcc): Promise<void> {
  const results = await Promise.allSettled(
    requests.map(request => fetchList(ctx.config.serverUrl, ctx.token, request.path, ctx.signal, request.query)),
  );
  ctx.signal?.throwIfAborted();
  results.forEach((result, index) => {
    const request = requests[index];
    if (result.status === "fulfilled") {
      if (result.value.resourceVersion) acc.resourceVersions.set(`${ctx.ns}:${request.kind}`, result.value.resourceVersion);
      absorb(acc, request.kind, request.extract(result.value.items));
      return;
    }
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    recordFailure(acc, ctx.ns, request.kind, request.path, error);
  });
}

async function fetchUnlabeledBuilds(ctx: NsCtx, acc: ListAcc): Promise<void> {
  const path = buildPath(ctx.encoded, "Build");
  try {
    const items = await fetchItems(ctx.config.serverUrl, ctx.token, path, ctx.signal);
    absorb(acc, "Build", items.flatMap(item => extractBuild(ctx.ns, item, ctx.key) ?? []));
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : String(reason);
    recordFailure(acc, ctx.ns, "Build", path, error);
  }
}

async function fetchPodsForDeploys(ctx: NsCtx, deploys: OpenShiftResource[], acc: ListAcc): Promise<void> {
  const path = buildPath(ctx.encoded, "Pod");
  const seen = new Set<string>();
  for (const deploy of deploys) {
    const query = matchLabelsSelector(deploy.podSelector ?? {});
    if (!query || seen.has(query)) continue;
    seen.add(query);
    try {
      const items = await fetchItems(ctx.config.serverUrl, ctx.token, path, ctx.signal, query);
      absorb(
        acc,
        "Pod",
        items.map(item => ({ ...extractPod(ctx.ns, item), commitSha: deploy.commitSha })),
      );
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      recordFailure(acc, ctx.ns, "Pod", path, error);
      if (acc.authFailed) return;
    }
  }
}

function labeledDeploysIn(acc: ListAcc, ns: string): OpenShiftResource[] {
  return acc.resources.filter(
    resource =>
      resource.kind === "Deployment" &&
      resource.namespace === ns &&
      resource.commitSha &&
      resource.podSelector &&
      Object.keys(resource.podSelector).length > 0,
  );
}

async function fetchSeeds(ctx: NsCtx, acc: ListAcc, commitQuery: string | null, buildsOnly: boolean): Promise<void> {
  const requests = [
    kindRequest(ctx, "Build", commitQuery),
    ...(buildsOnly ? [] : [kindRequest(ctx, "ImageStreamTag")]),
  ];
  await runRequests(ctx, requests, acc);
  if (acc.authFailed) return;
  const labeledBuilds = acc.resources.filter(resource => resource.kind === "Build" && resource.namespace === ctx.ns);
  if (
    commitQuery &&
    labeledBuilds.length === 0 &&
    !acc.failures.some(failure => failure.namespace === ctx.ns && failure.kind === "Build")
  ) {
    await fetchUnlabeledBuilds(ctx, acc);
  }
}

async function fetchLabeledLive(ctx: NsCtx, acc: ListAcc, commitQuery: string): Promise<boolean> {
  await runRequests(ctx, [kindRequest(ctx, "Deployment", commitQuery)], acc);
  if (acc.authFailed) return true;
  const deploys = labeledDeploysIn(acc, ctx.ns);
  if (deploys.length === 0) return false;
  await fetchPodsForDeploys(ctx, deploys, acc);
  return true;
}

async function fetchDigestLive(ctx: NsCtx, acc: ListAcc): Promise<void> {
  const kinds: OpenShiftInventoryKind[] = [
    "Deployment",
    "ReplicaSet",
    "DeploymentConfig",
    "ReplicationController",
    "Pod",
  ];
  await runRequests(
    ctx,
    kinds.map(kind => kindRequest(ctx, kind)),
    acc,
  );
}

async function fetchFull(ctx: NsCtx, acc: ListAcc): Promise<void> {
  const kinds: OpenShiftInventoryKind[] = [
    "Build",
    "ImageStreamTag",
    "Deployment",
    "ReplicaSet",
    "DeploymentConfig",
    "ReplicationController",
    "Pod",
  ];
  await runRequests(
    ctx,
    kinds.map(kind => kindRequest(ctx, kind)),
    acc,
  );
}

export async function fetchOpenShiftObject(
  serverUrl: string,
  token: string,
  resource: OpenShiftResource,
  signal?: AbortSignal,
): Promise<unknown> {
  const path = resourceObjectPath(resource);
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, path),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (isOpenShiftAuthStatus(res.status)) throw new Error(BANNER.openshift.tokenExpired);
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return await res.json();
}

export async function fetchOpenShiftResources(
  config: InventoryConfig,
  token: string,
  signal?: AbortSignal,
  mode: OpenShiftInventoryMode = "full",
  options: OpenShiftFetchOptions = {},
): Promise<OpenShiftListedInventory> {
  const acc = emptyAcc();
  const commitQuery = commitLabelSelector(config.commitShaAnnotation, options.commitShas ?? []);
  for (const ns of config.namespaces) {
    signal?.throwIfAborted();
    const ctx: NsCtx = {
      config,
      token,
      signal,
      ns,
      encoded: encodeURIComponent(ns),
      key: config.commitShaAnnotation,
    };
    const planned =
      mode === "builds"
        ? [kindRequest(ctx, "Build", commitQuery)]
        : mode === "seeds"
          ? [kindRequest(ctx, "Build", commitQuery), kindRequest(ctx, "ImageStreamTag")]
          : mode === "live" && commitQuery
            ? [kindRequest(ctx, "Deployment", commitQuery)]
            : mode === "live"
              ? ["Deployment", "ReplicaSet", "DeploymentConfig", "ReplicationController", "Pod"].map(kind =>
                  kindRequest(ctx, kind as OpenShiftInventoryKind),
                )
              : ["Build", "ImageStreamTag", "Deployment", "ReplicaSet", "DeploymentConfig", "ReplicationController", "Pod"].map(
                  kind => kindRequest(ctx, kind as OpenShiftInventoryKind),
                );
    if (!isValidOpenShiftNamespace(ns)) {
      for (const request of planned)
        recordFailure(acc, ns, request.kind, request.path, `Invalid OpenShift namespace: ${ns}`);
      continue;
    }
    if (mode === "builds") await fetchSeeds(ctx, acc, commitQuery, true);
    else if (mode === "seeds") await fetchSeeds(ctx, acc, commitQuery, false);
    else if (mode === "live") {
      if (commitQuery) {
        const labeled = await fetchLabeledLive(ctx, acc, commitQuery);
        if (!labeled && !acc.authFailed) await fetchDigestLive(ctx, acc);
      } else await fetchDigestLive(ctx, acc);
    } else await fetchFull(ctx, acc);
    if (acc.authFailed) break;
  }
  for (const failure of acc.failures) {
    debugError("OpenShift", `${failure.namespace}/${failure.kind} ${failure.path} ${failure.error}`);
  }
  const authError = acc.failures.some(failure => failure.error === BANNER.openshift.tokenExpired);
  const error = authError ? BANNER.openshift.tokenExpired : openshiftInventoryBanner(acc.failures, acc.successfulRequests);
  return {
    resources: acc.resources,
    controllers: acc.controllers,
    error,
    failures: acc.failures,
    successfulRequests: acc.successfulRequests,
    resourceVersions: acc.resourceVersions,
  };
}

export async function fetchOpenShiftInventory(
  config: { serverUrl: string; namespaces: string[]; commitShaAnnotation: string },
  token: string,
  signal?: AbortSignal,
  mode: OpenShiftInventoryMode = "full",
  options: OpenShiftFetchOptions = {},
): Promise<OpenShiftInventoryResult> {
  const listed = await fetchOpenShiftResources(config, token, signal, mode, options);
  return {
    data: buildOpenShiftCommitMap(listed.resources, listed.controllers),
    error: listed.error,
    failures: listed.failures,
    successfulRequests: listed.successfulRequests,
  };
}

function statusCounts(resources: readonly OpenShiftResource[]): GraphStatusCounts {
  return {
    failCount: resources.filter(r => r.status === "fail").length,
    runningCount: resources.filter(r => r.status === "running").length,
    passCount: resources.filter(r => r.status === "pass").length,
    unknownCount: resources.filter(r => r.status === "unknown").length,
  };
}

function worstStatus(counts: GraphStatusCounts): GraphBadge["badge"] {
  if (counts.failCount > 0) return "fail";
  if (counts.runningCount > 0) return "running";
  if (counts.unknownCount > 0) return "unknown";
  return "pass";
}

export function buildOpenShiftGraphBadges(data: Map<string, OpenShiftCommitData>): Map<string, GraphBadge> {
  const badges = new Map<string, GraphBadge>();
  for (const [sha, entry] of data) {
    const resources = entry.namespaces.flatMap(ns => [
      ...ns.pods,
      ...ns.deployments,
      ...ns.deploymentConfigs,
      ...ns.builds,
      ...ns.imageStreamTags,
    ]);
    if (resources.length === 0) continue;
    const live = resources.filter(r => !isCachedOpenShiftResource(r));
    const cached = resources.filter(isCachedOpenShiftResource);
    const totals = statusCounts(resources);
    const badge = worstStatus(totals);
    badges.set(sha, {
      sha,
      badge,
      ...totals,
      resourceCount: resources.length,
      lanes: {
        live: statusCounts(live),
        cache: statusCounts(cached),
      },
      latestRunAt: "",
      latestStatus: badge,
    });
  }
  return badges;
}
