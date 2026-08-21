import type { GraphBadge } from "../provider";
import { fetchWithRetry } from "../shared/http";
import type {
  OpenShiftCommitData,
  OpenShiftControllerReference,
  OpenShiftInventoryFailure,
  OpenShiftInventoryResult,
  OpenShiftOwnerReference,
  OpenShiftResource,
  OpenShiftStatus,
} from "./types";
import { isValidOpenShiftNamespace } from "./validation";

const FETCH_OPTS = { timeoutMs: 15000, attempts: 2, retryDelayMs: 500, timeoutMessage: "OpenShift request timed out" };

type AnyObj = Record<string, unknown>;

export function getOpenShiftToken(envVar: string): string | null {
  const token = process.env[envVar];
  return token?.trim() ? token : null;
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
    raw: item,
  };
}

function extractBuild(namespace: string, item: unknown, annotationKey: string): OpenShiftResource | null {
  const commitSha = annotation(item, annotationKey);
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
  const commitSha = annotation(item, annotationKey) ?? annotation(obj(item)?.image, annotationKey);
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

function extractWorkload(kind: "Deployment" | "DeploymentConfig", namespace: string, item: unknown): OpenShiftResource {
  return {
    ...baseResource(kind, namespace, item),
    status: workloadStatus(item),
    imageRefs: containerImages(obj(item)?.spec),
    raw: item,
  };
}

function extractPod(namespace: string, item: unknown): OpenShiftResource {
  const statuses = arr(obj(obj(item)?.status)?.containerStatuses);
  const imageRefs = statuses.flatMap(s => [...imageTokens(str(obj(s)?.image)), ...imageTokens(str(obj(s)?.imageID))]);
  return { ...baseResource("Pod", namespace, item), status: podStatus(item), imageRefs, raw: item };
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

async function fetchItems(serverUrl: string, token: string, path: string, signal?: AbortSignal): Promise<unknown[]> {
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, path),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return arr(obj(await res.json())?.items);
}

function add(nsMap: Map<string, OpenShiftCommitData>, sha: string, resource: OpenShiftResource) {
  const data = nsMap.get(sha) ?? { sha, namespaces: [], resolved: true };
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
  const identity = resource.uid ?? resource.id;
  if (!target.some(existing => (existing.uid ?? existing.id) === identity)) target.push(resource);
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

export async function fetchOpenShiftInventory(
  config: { serverUrl: string; namespaces: string[]; commitShaAnnotation: string },
  token: string,
  signal?: AbortSignal,
): Promise<OpenShiftInventoryResult> {
  const resources: OpenShiftResource[] = [];
  const controllers: OpenShiftControllerReference[] = [];
  const failures: OpenShiftInventoryFailure[] = [];
  let successfulRequests = 0;
  for (const ns of config.namespaces) {
    signal?.throwIfAborted();
    const encodedNamespace = encodeURIComponent(ns);
    const requests = [
      {
        kind: "Build" as const,
        path: `/apis/build.openshift.io/v1/namespaces/${encodedNamespace}/builds`,
        extract: (items: unknown[]) => items.flatMap(item => extractBuild(ns, item, config.commitShaAnnotation) ?? []),
      },
      {
        kind: "ImageStreamTag" as const,
        path: `/apis/image.openshift.io/v1/namespaces/${encodedNamespace}/imagestreamtags`,
        extract: (items: unknown[]) =>
          items.flatMap(item => extractImageStreamTag(ns, item, config.commitShaAnnotation) ?? []),
      },
      {
        kind: "Deployment" as const,
        path: `/apis/apps/v1/namespaces/${encodedNamespace}/deployments`,
        extract: (items: unknown[]) => items.map(item => extractWorkload("Deployment", ns, item)),
      },
      {
        kind: "ReplicaSet" as const,
        path: `/apis/apps/v1/namespaces/${encodedNamespace}/replicasets`,
        extract: (items: unknown[]) => items.flatMap(item => extractController("ReplicaSet", ns, item) ?? []),
      },
      {
        kind: "DeploymentConfig" as const,
        path: `/apis/apps.openshift.io/v1/namespaces/${encodedNamespace}/deploymentconfigs`,
        extract: (items: unknown[]) => items.map(item => extractWorkload("DeploymentConfig", ns, item)),
      },
      {
        kind: "ReplicationController" as const,
        path: `/api/v1/namespaces/${encodedNamespace}/replicationcontrollers`,
        extract: (items: unknown[]) =>
          items.flatMap(item => extractController("ReplicationController", ns, item) ?? []),
      },
      {
        kind: "Pod" as const,
        path: `/api/v1/namespaces/${encodedNamespace}/pods`,
        extract: (items: unknown[]) => items.map(item => extractPod(ns, item)),
      },
    ];
    if (!isValidOpenShiftNamespace(ns)) {
      for (const request of requests)
        failures.push({
          namespace: ns,
          kind: request.kind,
          path: request.path,
          error: `Invalid OpenShift namespace: ${ns}`,
        });
      continue;
    }
    const results = await Promise.allSettled(
      requests.map(request => fetchItems(config.serverUrl, token, request.path, signal)),
    );
    signal?.throwIfAborted();
    results.forEach((result, index) => {
      const request = requests[index];
      if (result.status === "fulfilled") {
        successfulRequests++;
        const extracted = request.extract(result.value);
        if (request.kind === "ReplicaSet" || request.kind === "ReplicationController")
          controllers.push(...(extracted as OpenShiftControllerReference[]));
        else resources.push(...(extracted as OpenShiftResource[]));
      } else
        failures.push({
          namespace: ns,
          kind: request.kind,
          path: request.path,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
    });
  }
  const error = failures.length
    ? `OpenShift inventory partially failed: ${failures.map(f => `${f.namespace}/${f.kind}: ${f.error}`).join("; ")}`
    : null;
  return { data: buildOpenShiftCommitMap(resources, controllers), error, failures, successfulRequests };
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
    const failCount = resources.filter(r => r.status === "fail").length;
    const runningCount = resources.filter(r => r.status === "running").length;
    const passCount = resources.filter(r => r.status === "pass").length;
    const unknownCount = resources.filter(r => r.status === "unknown").length;
    const badge = failCount ? "fail" : runningCount ? "running" : unknownCount ? "unknown" : "pass";
    badges.set(sha, {
      sha,
      badge,
      passCount,
      failCount,
      runningCount,
      unknownCount,
      resourceCount: resources.length,
      latestRunAt: "",
      latestStatus: badge,
    });
  }
  return badges;
}
