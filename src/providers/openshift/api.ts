import type { GraphBadge } from "../provider";
import { fetchWithRetry } from "../shared/http";
import type {
  OpenShiftCommitData,
  OpenShiftDetailGroup,
  OpenShiftDetailLine,
  OpenShiftInventoryFailure,
  OpenShiftInventoryResult,
  OpenShiftResource,
  OpenShiftResourceDetailResult,
  OpenShiftStatus,
} from "./types";

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

function statusFromConditions(item: unknown): OpenShiftStatus {
  const conditions = arr(obj(item)?.status && obj(obj(item)?.status)?.conditions);
  if (conditions.some(c => ["Failed", "Degraded"].includes(String(obj(c)?.type)) && obj(c)?.status === "True"))
    return "fail";
  if (conditions.some(c => ["Progressing", "Pending"].includes(String(obj(c)?.type)) && obj(c)?.status === "True"))
    return "running";
  if (
    conditions.some(
      c => ["Available", "Complete", "Completed"].includes(String(obj(c)?.type)) && obj(c)?.status === "True",
    )
  )
    return "pass";
  const specReplicas = obj(obj(item)?.spec)?.replicas;
  const availableReplicas = obj(obj(item)?.status)?.availableReplicas;
  if (typeof specReplicas === "number" && typeof availableReplicas === "number" && availableReplicas >= specReplicas)
    return "pass";
  return "unknown";
}

function podStatus(pod: unknown): OpenShiftStatus {
  const phase = str(obj(pod)?.status && obj(obj(pod)?.status)?.phase);
  const statuses = arr(obj(obj(pod)?.status)?.containerStatuses);
  const waitingReasons = statuses.flatMap(s => str(obj(obj(obj(s)?.state)?.waiting)?.reason) ?? []);
  if (
    waitingReasons.some(reason =>
      ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerError"].includes(reason),
    )
  )
    return "fail";
  if (waitingReasons.some(reason => ["ContainerCreating", "PodInitializing", "Pending"].includes(reason)))
    return "running";
  if (phase === "Failed") return "fail";
  if (phase === "Succeeded") return "pass";
  if (phase === "Running") return "pass";
  if (phase === "Pending") return "running";
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
      return statusFromConditions(build);
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
  return { ...baseResource("ImageStreamTag", namespace, item), status: "pass", imageRefs: imageTokens(ref), commitSha };
}

function containerImages(spec: unknown): string[] {
  return arr(
    obj(obj(spec)?.template)?.spec ? obj(obj(obj(spec)?.template)?.spec)?.containers : obj(spec)?.containers,
  ).flatMap(c => imageTokens(str(obj(c)?.image)));
}

function extractWorkload(kind: "Deployment" | "DeploymentConfig", namespace: string, item: unknown): OpenShiftResource {
  return {
    ...baseResource(kind, namespace, item),
    status: statusFromConditions(item),
    imageRefs: containerImages(obj(item)?.spec),
    raw: item,
  };
}

function extractPod(namespace: string, item: unknown): OpenShiftResource {
  const statuses = arr(obj(obj(item)?.status)?.containerStatuses);
  const imageRefs = statuses.flatMap(s => [...imageTokens(str(obj(s)?.image)), ...imageTokens(str(obj(s)?.imageID))]);
  return { ...baseResource("Pod", namespace, item), status: podStatus(item), imageRefs, raw: item };
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

async function fetchItem(serverUrl: string, token: string, path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, path),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return res.json();
}

async function fetchText(serverUrl: string, token: string, path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, path),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return res.text();
}

function resourcePath(resource: Pick<OpenShiftResource, "kind" | "namespace" | "name">): string {
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

function logPath(resource: Pick<OpenShiftResource, "kind" | "namespace" | "name">, container?: string): string | null {
  const ns = encodeURIComponent(resource.namespace);
  const name = encodeURIComponent(resource.name);
  const params = new URLSearchParams({ tailLines: "40" });
  if (container) params.set("container", container);
  if (resource.kind === "Build") return `/apis/build.openshift.io/v1/namespaces/${ns}/builds/${name}/log?${params}`;
  if (resource.kind === "Pod") return `/api/v1/namespaces/${ns}/pods/${name}/log?${params}`;
  return null;
}

function conditionStatus(condition: unknown): OpenShiftStatus {
  const c = obj(condition);
  const type = str(c?.type);
  const status = str(c?.status);
  if (["Failed", "Degraded"].includes(type ?? "") && status === "True") return "fail";
  if (["Progressing", "Pending"].includes(type ?? "") && status === "True") return "running";
  if (["Available", "Complete", "Completed"].includes(type ?? "") && status === "True") return "pass";
  return "unknown";
}

function conditionsGroup(detail: unknown): OpenShiftDetailGroup | null {
  const conditions = arr(obj(obj(detail)?.status)?.conditions);
  if (conditions.length === 0) return null;
  const lines = conditions.map((condition, idx): OpenShiftDetailLine => {
    const c = obj(condition);
    const type = str(c?.type) ?? "condition";
    const status = str(c?.status) ?? "unknown";
    const reason = str(c?.reason);
    return {
      id: `condition:${type}:${idx}`,
      text: `${type}: ${status}${reason ? ` (${reason})` : ""}`,
      status: conditionStatus(condition),
    };
  });
  const fail = lines.some(line => line.status === "fail");
  const running = lines.some(line => line.status === "running");
  const pass = lines.some(line => line.status === "pass");
  return {
    id: "conditions",
    name: "Conditions",
    status: fail ? "fail" : running ? "running" : pass ? "pass" : "unknown",
    lines,
  };
}

function imagesGroup(resource: OpenShiftResource): OpenShiftDetailGroup | null {
  const refs = [...new Set(resource.imageRefs)].filter(Boolean);
  if (refs.length === 0) return null;
  return {
    id: "images",
    name: "Images",
    status: "unknown",
    lines: refs.slice(0, 20).map((ref, idx) => ({ id: `image:${idx}`, text: ref, status: "unknown" })),
  };
}

function containerLines(pod: unknown): OpenShiftDetailLine[] {
  return arr(obj(obj(pod)?.status)?.containerStatuses).map((status, idx) => {
    const s = obj(status);
    const name = str(s?.name) ?? `container-${idx + 1}`;
    const restarts = typeof s?.restartCount === "number" ? s.restartCount : 0;
    const state = obj(s?.state);
    const waiting = obj(state?.waiting);
    const terminated = obj(state?.terminated);
    const ready = s?.ready === true;
    const reason = str(waiting?.reason) ?? str(terminated?.reason) ?? (ready ? "ready" : "not ready");
    const waitingReason = str(waiting?.reason);
    const statusValue: OpenShiftStatus = waitingReason
      ? ["ContainerCreating", "PodInitializing", "Pending"].includes(waitingReason)
        ? "running"
        : "fail"
      : terminated
        ? str(terminated.reason) === "Completed"
          ? "pass"
          : "fail"
        : ready
          ? "pass"
          : "unknown";
    return { id: `container:${name}:${idx}`, text: `${name}: ${reason} (restarts ${restarts})`, status: statusValue };
  });
}

function containersGroup(pod: unknown): OpenShiftDetailGroup | null {
  const lines = containerLines(pod);
  if (lines.length === 0) return null;
  const fail = lines.some(line => line.status === "fail");
  const pass = lines.some(line => line.status === "pass");
  return { id: "containers", name: "Containers", status: fail ? "fail" : pass ? "pass" : "unknown", lines };
}

function selectorParams(detail: unknown): string | null {
  const spec = obj(obj(detail)?.spec);
  const selector = obj(spec?.selector);
  const labels = obj(selector?.matchLabels) ?? selector;
  if (!labels) return null;
  const pairs = Object.entries(labels).flatMap(([key, value]) =>
    typeof value === "string" && value.trim() ? [`${key}=${value}`] : [],
  );
  if (pairs.length === 0) return null;
  return new URLSearchParams({ labelSelector: pairs.join(",") }).toString();
}

async function podsGroupForWorkload(
  serverUrl: string,
  token: string,
  detail: unknown,
  namespace: string,
  signal?: AbortSignal,
): Promise<OpenShiftDetailGroup | null> {
  const params = selectorParams(detail);
  if (!params) return null;
  const pods = await fetchItems(
    serverUrl,
    token,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?${params}`,
    signal,
  );
  if (pods.length === 0) return null;
  const lines = pods.slice(0, 20).map((pod, idx): OpenShiftDetailLine => {
    const name = str(metadata(pod).name) ?? `pod-${idx + 1}`;
    const phase = str(obj(obj(pod)?.status)?.phase) ?? "unknown";
    return { id: `pod:${name}:${idx}`, text: `${name}: ${phase}`, status: podStatus(pod) };
  });
  const fail = lines.some(line => line.status === "fail");
  const running = lines.some(line => line.status === "running");
  const pass = lines.some(line => line.status === "pass");
  return { id: "pods", name: "Pods", status: fail ? "fail" : running ? "running" : pass ? "pass" : "unknown", lines };
}

async function logsGroup(
  serverUrl: string,
  token: string,
  resource: OpenShiftResource,
  detail: unknown,
  signal?: AbortSignal,
): Promise<OpenShiftDetailGroup | null> {
  const container =
    resource.kind === "Pod" ? str(obj(arr(obj(obj(detail)?.status)?.containerStatuses)[0])?.name) : undefined;
  const path = logPath(resource, container);
  if (!path) return null;
  const log = await fetchText(serverUrl, token, path, signal);
  const lines = log.split("\n").filter(Boolean).slice(-40);
  if (lines.length === 0) return null;
  return {
    id: "logs",
    name: "Logs",
    status: "unknown",
    lines: lines.map((line, idx) => ({ id: `log:${idx}`, text: line, status: "unknown" })),
  };
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
  if (resource.kind === "Build") ns.builds.push(resource);
  else if (resource.kind === "ImageStreamTag") ns.imageStreamTags.push(resource);
  else if (resource.kind === "Deployment") ns.deployments.push(resource);
  else if (resource.kind === "DeploymentConfig") ns.deploymentConfigs.push(resource);
  else ns.pods.push(resource);
  nsMap.set(sha, data);
}

export function buildOpenShiftCommitMap(resources: OpenShiftResource[]): Map<string, OpenShiftCommitData> {
  const map = new Map<string, OpenShiftCommitData>();
  const tokensBySha = new Map<string, Set<string>>();
  for (const r of resources.filter(r => r.commitSha)) {
    const sha = r.commitSha;
    if (!sha) continue;
    add(map, sha, r);
    const set = tokensBySha.get(sha) ?? new Set<string>();
    for (const token of r.imageRefs.flatMap(imageDigests)) set.add(token);
    tokensBySha.set(sha, set);
  }
  for (const r of resources.filter(r => !r.commitSha)) {
    for (const [sha, tokens] of tokensBySha) {
      if (r.imageRefs.flatMap(imageDigests).some(ref => tokens.has(ref))) add(map, sha, r);
    }
  }
  return map;
}

function imageDigests(ref: string): string[] {
  return ref.match(/(?:sha256:)[a-fA-F0-9]+/g) ?? [];
}

const OPENSHIFT_NAMESPACE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export async function fetchOpenShiftInventory(
  config: { serverUrl: string; namespaces: string[]; commitShaAnnotation: string },
  token: string,
  signal?: AbortSignal,
): Promise<OpenShiftInventoryResult> {
  const resources: OpenShiftResource[] = [];
  const failures: OpenShiftInventoryFailure[] = [];
  for (const ns of config.namespaces) {
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
        kind: "DeploymentConfig" as const,
        path: `/apis/apps.openshift.io/v1/namespaces/${encodedNamespace}/deploymentconfigs`,
        extract: (items: unknown[]) => items.map(item => extractWorkload("DeploymentConfig", ns, item)),
      },
      {
        kind: "Pod" as const,
        path: `/api/v1/namespaces/${encodedNamespace}/pods`,
        extract: (items: unknown[]) => items.map(item => extractPod(ns, item)),
      },
    ];
    if (!OPENSHIFT_NAMESPACE.test(ns)) {
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
    results.forEach((result, index) => {
      const request = requests[index];
      if (result.status === "fulfilled") resources.push(...request.extract(result.value));
      else
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
  return { data: buildOpenShiftCommitMap(resources), error, failures };
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
    const badge = failCount ? "fail" : runningCount ? "running" : passCount ? "pass" : "unknown";
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

export async function fetchOpenShiftResourceDetails(
  config: { serverUrl: string },
  token: string,
  resource: OpenShiftResource,
  signal?: AbortSignal,
): Promise<OpenShiftResourceDetailResult> {
  const groups: OpenShiftDetailGroup[] = [];
  let firstError: string | null = null;
  try {
    const detail = await fetchItem(config.serverUrl, token, resourcePath(resource), signal);
    const conditions = conditionsGroup(detail);
    if (conditions) groups.push(conditions);
    const containers = resource.kind === "Pod" ? containersGroup(detail) : null;
    if (containers) groups.push(containers);
    const images = imagesGroup(resource);
    if (images) groups.push(images);
    if (resource.kind === "Deployment" || resource.kind === "DeploymentConfig") {
      try {
        const pods = await podsGroupForWorkload(config.serverUrl, token, detail, resource.namespace, signal);
        if (pods) groups.push(pods);
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : String(err);
      }
    }
    if (resource.kind === "Pod" || resource.kind === "Build") {
      try {
        const logs = await logsGroup(config.serverUrl, token, resource, detail, signal);
        if (logs) groups.push(logs);
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : String(err);
      }
    }
  } catch (err) {
    firstError ??= err instanceof Error ? err.message : String(err);
  }
  return { groups, error: firstError };
}
