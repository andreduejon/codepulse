import { isAbortError } from "../../core/abort";
import { BANNER, debugError } from "../../core/banner";
import {
  arr,
  buildOpenShiftCommitMap,
  buildPath,
  commitLabelSelector,
  extractBuild,
  extractController,
  extractImageStreamTag,
  extractPod,
  extractWorkload,
  matchLabelsSelector,
  metadata,
  obj,
  openShiftApiUrl,
  str,
} from "../../core/openshift/resources";
import type {
  OpenShiftClusterConfig,
  OpenShiftControllerReference,
  OpenShiftEvent,
  OpenShiftFetchOptions,
  OpenShiftInventoryFailure,
  OpenShiftInventoryKind,
  OpenShiftInventoryMode,
  OpenShiftInventoryResult,
  OpenShiftListedInventory,
  OpenShiftResource,
  OpenShiftWatchResult,
} from "../../core/openshift/types";
import { isValidOpenShiftNamespace } from "../../core/openshift/validation";
import { isOpenShiftWatchGone, type OpenShiftWatchEvent, parseOpenShiftWatchBuffer } from "../../core/openshift/watch";
import { failureOf, ProviderAuthError, type ProviderFailure } from "../../core/provider-failure";
import { fetchWithRetry } from "../http";

const FETCH_OPTS = { timeoutMs: 15000, attempts: 2, retryDelayMs: 500, timeoutMessage: BANNER.openshift.timeout };
export const MAX_LIST_PAGES = 100;
export const MAX_LIST_ITEMS = 50_000;

class OpenShiftListError extends Error {
  readonly items: unknown[];
  /** The kind of the failure it wraps (an expired token), for failureOf. */
  readonly failure?: ProviderFailure;

  constructor(message: string, items: unknown[], failure?: ProviderFailure) {
    super(message);
    this.name = "OpenShiftListError";
    this.items = items;
    this.failure = failure;
  }
}

export function getOpenShiftToken(envVar: string): string | null {
  const token = process.env[envVar];
  return token?.trim() ? token : null;
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
  const items: unknown[] = [];
  const seenTokens = new Set<string>();
  let continueToken: string | null = null;
  let resourceVersion = "0";

  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    try {
      signal?.throwIfAborted();
      const params = new URLSearchParams(query ?? "");
      if (continueToken) params.set("continue", continueToken);
      const pageQuery = params.toString();
      const suffix = pageQuery ? (path.includes("?") ? `&${pageQuery}` : `?${pageQuery}`) : "";
      const res = await fetchWithRetry(
        openShiftApiUrl(serverUrl, `${path}${suffix}`),
        { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
        FETCH_OPTS,
        "OpenShift",
      );
      if (isOpenShiftAuthStatus(res.status)) throw new ProviderAuthError(BANNER.openshift.tokenExpired);
      if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
      const body = obj(await res.json());
      const pageItems = arr(body?.items);
      const remaining = MAX_LIST_ITEMS - items.length;
      items.push(...pageItems.slice(0, Math.max(0, remaining)));
      const metadata = obj(body?.metadata);
      resourceVersion = str(metadata?.resourceVersion) ?? resourceVersion;
      const nextToken = str(metadata?.continue)?.trim() || null;

      if (pageItems.length > remaining) {
        throw new OpenShiftListError(`OpenShift ${path} inventory truncated after ${MAX_LIST_ITEMS} items`, items);
      }
      if (!nextToken) return { items, resourceVersion };
      if (items.length >= MAX_LIST_ITEMS) {
        throw new OpenShiftListError(`OpenShift ${path} inventory truncated after ${MAX_LIST_ITEMS} items`, items);
      }
      if (seenTokens.has(nextToken)) {
        throw new OpenShiftListError(`OpenShift ${path} pagination token repeated after ${page} pages`, items);
      }
      if (page === MAX_LIST_PAGES) {
        throw new OpenShiftListError(`OpenShift ${path} inventory truncated after ${MAX_LIST_PAGES} pages`, items);
      }
      seenTokens.add(nextToken);
      continueToken = nextToken;
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      if (err instanceof OpenShiftListError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new OpenShiftListError(message, items, failureOf(err));
    }
  }

  throw new OpenShiftListError(`OpenShift ${path} inventory truncated after ${MAX_LIST_PAGES} pages`, items);
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
  if (isOpenShiftAuthStatus(res.status)) throw new ProviderAuthError(BANNER.openshift.tokenExpired);
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
  if (isOpenShiftAuthStatus(res.status)) throw new ProviderAuthError(BANNER.openshift.tokenExpired);
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return await res.text();
}

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
  if (isOpenShiftAuthStatus(res.status)) throw new ProviderAuthError(BANNER.openshift.tokenExpired);
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

type InventoryConfig = OpenShiftClusterConfig;

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

function recordFailure(
  acc: ListAcc,
  ns: string,
  kind: OpenShiftInventoryKind,
  path: string,
  error: string,
  reason?: unknown,
): void {
  acc.failures.push({ namespace: ns, kind, path, error });
  if (failureOf(reason) === "auth") acc.authFailed = true;
}

function absorb(
  acc: ListAcc,
  kind: OpenShiftInventoryKind,
  extracted: InventoryRequest["extract"] extends (i: unknown[]) => infer R ? R : never,
  countSuccess = true,
): void {
  if (countSuccess) acc.successfulRequests++;
  if (kind === "ReplicaSet" || kind === "ReplicationController")
    acc.controllers.push(...(extracted as OpenShiftControllerReference[]));
  else acc.resources.push(...(extracted as OpenShiftResource[]));
}

function absorbPartialList(acc: ListAcc, request: InventoryRequest, reason: unknown): void {
  if (!(reason instanceof OpenShiftListError) || reason.items.length === 0) return;
  absorb(acc, request.kind, request.extract(reason.items), false);
}

async function runRequests(ctx: NsCtx, requests: InventoryRequest[], acc: ListAcc): Promise<void> {
  const results = await Promise.allSettled(
    requests.map(request => fetchList(ctx.config.serverUrl, ctx.token, request.path, ctx.signal, request.query)),
  );
  ctx.signal?.throwIfAborted();
  results.forEach((result, index) => {
    const request = requests[index];
    if (result.status === "fulfilled") {
      if (result.value.resourceVersion)
        acc.resourceVersions.set(`${ctx.ns}:${request.kind}`, result.value.resourceVersion);
      absorb(acc, request.kind, request.extract(result.value.items));
      return;
    }
    absorbPartialList(acc, request, result.reason);
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    recordFailure(acc, ctx.ns, request.kind, request.path, error, result.reason);
  });
}

async function fetchUnlabeledBuilds(ctx: NsCtx, acc: ListAcc): Promise<void> {
  const path = buildPath(ctx.encoded, "Build");
  try {
    const { items, resourceVersion } = await fetchList(ctx.config.serverUrl, ctx.token, path, ctx.signal);
    if (resourceVersion) acc.resourceVersions.set(`${ctx.ns}:Build`, resourceVersion);
    absorb(
      acc,
      "Build",
      items.flatMap(item => extractBuild(ctx.ns, item, ctx.key) ?? []),
    );
  } catch (reason) {
    if (isAbortError(reason, ctx.signal)) throw reason;
    if (reason instanceof OpenShiftListError && reason.items.length > 0) {
      absorb(
        acc,
        "Build",
        reason.items.flatMap(item => extractBuild(ctx.ns, item, ctx.key) ?? []),
        false,
      );
    }
    const error = reason instanceof Error ? reason.message : String(reason);
    recordFailure(acc, ctx.ns, "Build", path, error, reason);
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
      const { items, resourceVersion } = await fetchList(ctx.config.serverUrl, ctx.token, path, ctx.signal, query);
      if (resourceVersion) acc.resourceVersions.set(`${ctx.ns}:Pod`, resourceVersion);
      absorb(
        acc,
        "Pod",
        items.map(item => ({ ...extractPod(ctx.ns, item), commitSha: deploy.commitSha })),
      );
    } catch (reason) {
      if (isAbortError(reason, ctx.signal)) throw reason;
      if (reason instanceof OpenShiftListError && reason.items.length > 0) {
        absorb(
          acc,
          "Pod",
          reason.items.map(item => ({ ...extractPod(ctx.ns, item), commitSha: deploy.commitSha })),
          false,
        );
      }
      const error = reason instanceof Error ? reason.message : String(reason);
      recordFailure(acc, ctx.ns, "Pod", path, error, reason);
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
  if (isOpenShiftAuthStatus(res.status)) throw new ProviderAuthError(BANNER.openshift.tokenExpired);
  if (!res.ok) throw new Error(`OpenShift ${path} failed: ${res.status}`);
  return await res.json();
}

function parseOpenShiftEvent(item: unknown): OpenShiftEvent {
  const event = obj(item) ?? {};
  const series = obj(event.series);
  const count = typeof series?.count === "number" ? series.count : typeof event.count === "number" ? event.count : 1;
  return {
    type: str(event.type) ?? "Normal",
    reason: str(event.reason) ?? "",
    message: (str(event.note) ?? str(event.message) ?? "").replace(/\s*\n\s*/g, " ").trim(),
    count,
    lastSeen:
      str(series?.lastObservedTime) ??
      str(event.lastTimestamp) ??
      str(event.eventTime) ??
      str(event.firstTimestamp) ??
      str(metadata(item).creationTimestamp) ??
      null,
  };
}

/** The events about one resource (by kind and name in its namespace), newest first. */
export async function fetchOpenShiftEvents(
  serverUrl: string,
  token: string,
  resource: OpenShiftResource,
  signal?: AbortSignal,
): Promise<OpenShiftEvent[]> {
  const selector = `involvedObject.kind=${resource.kind},involvedObject.name=${resource.name}`;
  const path = `/api/v1/namespaces/${encodeURIComponent(resource.namespace)}/events?fieldSelector=${encodeURIComponent(selector)}`;
  const res = await fetchWithRetry(
    openShiftApiUrl(serverUrl, path),
    { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    FETCH_OPTS,
    "OpenShift",
  );
  if (isOpenShiftAuthStatus(res.status)) throw new ProviderAuthError(BANNER.openshift.tokenExpired);
  if (res.status === 403)
    throw new Error(`No permission to list events in ${resource.namespace}. The token needs list on events.`);
  if (!res.ok) throw new Error(`OpenShift events failed: ${res.status}`);
  const events = arr(obj(await res.json())?.items).map(parseOpenShiftEvent);
  return events.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
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
              : [
                  "Build",
                  "ImageStreamTag",
                  "Deployment",
                  "ReplicaSet",
                  "DeploymentConfig",
                  "ReplicationController",
                  "Pod",
                ].map(kind => kindRequest(ctx, kind as OpenShiftInventoryKind));
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
  const error = acc.authFailed
    ? BANNER.openshift.tokenExpired
    : openshiftInventoryBanner(acc.failures, acc.successfulRequests);
  return {
    resources: acc.resources,
    controllers: acc.controllers,
    error,
    ...(acc.authFailed ? { failure: "auth" as const } : {}),
    failures: acc.failures,
    successfulRequests: acc.successfulRequests,
    resourceVersions: acc.resourceVersions,
  };
}

export async function fetchOpenShiftInventory(
  config: OpenShiftClusterConfig,
  token: string,
  signal?: AbortSignal,
  mode: OpenShiftInventoryMode = "full",
  options: OpenShiftFetchOptions = {},
): Promise<OpenShiftInventoryResult> {
  const listed = await fetchOpenShiftResources(config, token, signal, mode, options);
  return {
    data: buildOpenShiftCommitMap(listed.resources, listed.controllers),
    error: listed.error,
    failure: listed.failure,
    failures: listed.failures,
    successfulRequests: listed.successfulRequests,
  };
}
