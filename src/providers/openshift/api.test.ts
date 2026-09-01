import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BANNER } from "../../debug/banner";
import { clearDebugEvents, getDebugEvents } from "../../debug/events";
import {
  buildOpenShiftCommitMap,
  buildOpenShiftGraphBadges,
  commitLabelSelector,
  commitShaFromItem,
  fetchOpenShiftInventory,
  fetchOpenShiftResources,
  MAX_LIST_ITEMS,
  MAX_LIST_PAGES,
} from "./api";
import type { OpenShiftCommitData, OpenShiftResource } from "./types";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeEach(clearDebugEvents);
afterEach(clearDebugEvents);

describe("fetchOpenShiftInventory", () => {
  test("maps OpenShift Build phase Complete to pass", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/builds")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                metadata: {
                  name: "build-1",
                  annotations: { "dev/commit-sha": SHA },
                },
                status: {
                  phase: "Complete",
                  outputDockerImageReference: "image-registry/ns/app@sha256:abc123",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      expect(result.error).toBeNull();
      expect(result.data.get(SHA)?.namespaces[0].builds[0].status).toBe("pass");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps official Build phases and unresolved ImageStreamTags conservatively", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/builds")) {
        return Response.json({
          items: [
            ...["New", "Pending", "Running"].map(phase => ({
              metadata: { name: phase, annotations: { "dev/commit-sha": SHA } },
              status: { phase },
            })),
            ...["Failed", "Error", "Cancelled"].map(phase => ({
              metadata: { name: phase, annotations: { "dev/commit-sha": SHA } },
              status: { phase },
            })),
            { metadata: { name: "mystery", annotations: { "dev/commit-sha": SHA } }, status: { phase: "Mystery" } },
          ],
        });
      }
      if (url.includes("/imagestreamtags")) {
        return Response.json({
          items: [
            {
              metadata: { name: "resolved", annotations: { "dev/commit-sha": SHA } },
              image: { dockerImageReference: "app@sha256:abc" },
            },
            { metadata: { name: "unresolved", annotations: { "dev/commit-sha": SHA } }, image: {} },
          ],
        });
      }
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftInventory(
        { serverUrl: "https://example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      const ns = result.data.get(SHA)?.namespaces[0];
      expect(ns?.builds.map(resource => [resource.name, resource.status])).toEqual([
        ["New", "running"],
        ["Pending", "running"],
        ["Running", "running"],
        ["Failed", "fail"],
        ["Error", "fail"],
        ["Cancelled", "fail"],
        ["mystery", "unknown"],
      ]);
      expect(ns?.imageStreamTags.map(resource => [resource.name, resource.status])).toEqual([
        ["resolved", "pass"],
        ["unresolved", "unknown"],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retains successful kinds and reports each failed kind", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      urls.push(url);
      if (url.includes("/builds")) return new Response("forbidden", { status: 403 });
      if (url.includes("/deploymentconfigs")) return new Response("unavailable", { status: 503 });
      if (url.includes("/imagestreamtags")) {
        return Response.json({
          items: [{ metadata: { name: "app:latest", annotations: { "dev/commit-sha": SHA } }, image: {} }],
        });
      }
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["team-one"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      expect(new Set(urls)).toHaveLength(7);
      expect(urls.every(url => url.includes("/namespaces/team-one/"))).toBe(true);
      expect(result.data.get(SHA)?.namespaces[0].imageStreamTags).toHaveLength(1);
      expect(result.failures).toEqual([
        expect.objectContaining({ namespace: "team-one", kind: "Build", error: expect.stringContaining("403") }),
        expect.objectContaining({
          namespace: "team-one",
          kind: "DeploymentConfig",
          error: expect.stringContaining("503"),
        }),
      ]);
      expect(result.error).toBe(BANNER.openshift.inventoryPartial);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches every list page and keeps final resource version", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      urls.push(url);
      if (!url.includes("/pods")) return Response.json({ items: [], metadata: { resourceVersion: "1" } });
      const token = new URL(url).searchParams.get("continue");
      if (!token) {
        return Response.json({
          items: [{ metadata: { name: "pod-1" }, status: {} }],
          metadata: { continue: "token/one+two=", resourceVersion: "10" },
        });
      }
      return Response.json({
        items: [{ metadata: { name: "pod-2" }, status: {} }],
        metadata: { resourceVersion: "11" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftResources(
        { serverUrl: "https://openshift.example.com", namespaces: ["team-one"], commitShaAnnotation: "dev/commit-sha" },
        "token",
        undefined,
        "full",
      );
      const podUrls = urls.filter(url => url.includes("/pods"));
      expect(podUrls).toHaveLength(2);
      expect(podUrls[1]).toContain("continue=token%2Fone%2Btwo%3D");
      expect(result.resources.filter(resource => resource.kind === "Pod").map(resource => resource.name)).toEqual([
        "pod-1",
        "pod-2",
      ]);
      expect(result.resourceVersions.get("team-one:Pod")).toBe("11");
      expect(result.error).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retains pages and warns when continuation token repeats", async () => {
    const originalFetch = globalThis.fetch;
    let podRequests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (!url.includes("/pods")) return Response.json({ items: [] });
      podRequests++;
      return Response.json({
        items: [{ metadata: { name: `pod-${podRequests}` }, status: {} }],
        metadata: { continue: "same-token", resourceVersion: String(podRequests) },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftResources(
        { serverUrl: "https://openshift.example.com", namespaces: ["team-one"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      expect(podRequests).toBe(2);
      expect(result.resources.filter(resource => resource.kind === "Pod")).toHaveLength(2);
      expect(result.error).toBe(BANNER.openshift.inventoryPartial);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ kind: "Pod", error: expect.stringContaining("pagination token repeated") }),
      );
      expect(getDebugEvents()).toContainEqual(
        expect.objectContaining({ source: "OpenShift", message: expect.stringContaining("pagination token repeated") }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stops at page safety limit and preserves fetched pages", async () => {
    const originalFetch = globalThis.fetch;
    let podRequests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (!url.includes("/pods")) return Response.json({ items: [] });
      podRequests++;
      return Response.json({
        items: [{ metadata: { name: `pod-${podRequests}` }, status: {} }],
        metadata: { continue: `token-${podRequests}`, resourceVersion: String(podRequests) },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftResources(
        { serverUrl: "https://openshift.example.com", namespaces: ["team-one"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      expect(podRequests).toBe(MAX_LIST_PAGES);
      expect(result.resources.filter(resource => resource.kind === "Pod")).toHaveLength(MAX_LIST_PAGES);
      expect(result.error).toBe(BANNER.openshift.inventoryPartial);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ kind: "Pod", error: expect.stringContaining(`${MAX_LIST_PAGES} pages`) }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stops at item safety limit and preserves capped items", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (!url.includes("/pods")) return Response.json({ items: [] });
      return Response.json({
        items: Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) => ({
          metadata: { name: `pod-${index}` },
          status: {},
        })),
        metadata: { continue: "more", resourceVersion: "1" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftResources(
        { serverUrl: "https://openshift.example.com", namespaces: ["team-one"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      expect(result.resources.filter(resource => resource.kind === "Pod")).toHaveLength(MAX_LIST_ITEMS);
      expect(result.error).toBe(BANNER.openshift.inventoryPartial);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ kind: "Pod", error: expect.stringContaining(`${MAX_LIST_ITEMS} items`) }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves prior pages when a later page fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (!url.includes("/pods")) return Response.json({ items: [] });
      if (new URL(url).searchParams.has("continue")) return new Response("unavailable", { status: 400 });
      return Response.json({
        items: [{ metadata: { name: "pod-1" }, status: {} }],
        metadata: { continue: "next", resourceVersion: "1" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchOpenShiftResources(
        { serverUrl: "https://openshift.example.com", namespaces: ["team-one"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      expect(result.resources.filter(resource => resource.kind === "Pod").map(resource => resource.name)).toEqual([
        "pod-1",
      ]);
      expect(result.error).toBe(BANNER.openshift.inventoryPartial);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ kind: "Pod", error: expect.stringContaining("400") }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("aborts pagination without reporting a partial inventory", async () => {
    const originalFetch = globalThis.fetch;
    const ctrl = new AbortController();
    let podRequests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (!url.includes("/pods")) return Response.json({ items: [] });
      podRequests++;
      if (podRequests === 1) {
        return Response.json({
          items: [{ metadata: { name: "pod-1" }, status: {} }],
          metadata: { continue: "next", resourceVersion: "1" },
        });
      }
      ctrl.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as typeof fetch;

    try {
      await expect(
        fetchOpenShiftResources(
          {
            serverUrl: "https://openshift.example.com",
            namespaces: ["team-one"],
            commitShaAnnotation: "dev/commit-sha",
          },
          "token",
          ctrl.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(getDebugEvents().every(event => event.status !== "error")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not request invalid namespace path segments", async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    try {
      const result = await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["../admin"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      expect(requests).toBe(0);
      expect(result.failures).toHaveLength(7);
      expect(result.error).toBe(BANNER.openshift.invalidNamespace);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("correlates unannotated resources only through immutable image digests", () => {
    const resource = (kind: OpenShiftResource["kind"], name: string, imageRefs: string[], commitSha?: string) =>
      ({ id: name, kind, name, namespace: "ns", status: "pass", imageRefs, commitSha }) as OpenShiftResource;
    const map = buildOpenShiftCommitMap([
      resource("ImageStreamTag", "app:latest", ["registry/ns/app:latest", "sha256:abc123"], SHA),
      resource("Deployment", "tag-only", ["registry/ns/app:latest"]),
      resource("Pod", "digest", ["registry/ns/app@sha256:abc123"]),
    ]);

    expect(map.get(SHA)?.namespaces[0].imageStreamTags).toHaveLength(1);
    expect(map.get(SHA)?.namespaces[0].deployments).toHaveLength(0);
    expect(map.get(SHA)?.namespaces[0].pods.map(p => p.name)).toEqual(["digest"]);
  });

  test("associates unlabeled pods through a labeled Deployment selector", () => {
    const map = buildOpenShiftCommitMap([
      {
        id: "Deployment:ns:app",
        kind: "Deployment",
        name: "app",
        namespace: "ns",
        status: "running",
        imageRefs: [],
        commitSha: SHA,
        podSelector: { app: "svc" },
      },
      {
        id: "Pod:ns:app-1",
        kind: "Pod",
        name: "app-1",
        namespace: "ns",
        status: "running",
        imageRefs: [],
        labels: { app: "svc" },
      },
    ]);
    expect(map.get(SHA)?.namespaces[0].pods.map(item => item.name)).toEqual(["app-1"]);
  });

  test("keeps every ImageStreamTag when they share an ImageStream uid", () => {
    const tag = (name: string): OpenShiftResource => ({
      id: `ImageStreamTag:ns:${name}`,
      kind: "ImageStreamTag",
      name,
      namespace: "ns",
      status: "pass",
      imageRefs: ["sha256:abc"],
      commitSha: SHA,
      uid: "shared-imagestream-uid",
    });
    const map = buildOpenShiftCommitMap([tag("app:develop-internal"), tag("app:develop-external")]);
    expect(map.get(SHA)?.namespaces[0].imageStreamTags.map(item => item.name)).toEqual([
      "app:develop-internal",
      "app:develop-external",
    ]);
  });

  test("associates digest-matched Pods to owning Deployments through ReplicaSets", () => {
    const resources: OpenShiftResource[] = [
      {
        id: "istag",
        kind: "ImageStreamTag",
        name: "app:latest",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app@sha256:abc123"],
        commitSha: SHA,
      },
      {
        id: "deployment",
        uid: "deployment-uid",
        kind: "Deployment",
        name: "app",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app:latest"],
      },
      {
        id: "pod",
        uid: "pod-uid",
        kind: "Pod",
        name: "app-pod",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app@sha256:abc123"],
        ownerReferences: [{ kind: "ReplicaSet", uid: "replicaset-uid" }],
      },
    ];
    const map = buildOpenShiftCommitMap(resources, [
      {
        kind: "ReplicaSet",
        namespace: "ns",
        uid: "replicaset-uid",
        ownerReferences: [{ kind: "Deployment", uid: "deployment-uid" }],
      },
    ]);

    expect(map.get(SHA)?.namespaces[0].pods.map(resource => resource.name)).toEqual(["app-pod"]);
    expect(map.get(SHA)?.namespaces[0].deployments.map(resource => resource.name)).toEqual(["app"]);
  });

  test("associates digest-matched Pods to owning DeploymentConfigs through ReplicationControllers", () => {
    const resources: OpenShiftResource[] = [
      {
        id: "build",
        kind: "Build",
        name: "build-1",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app@sha256:def456"],
        commitSha: SHA,
      },
      {
        id: "dc",
        uid: "dc-uid",
        kind: "DeploymentConfig",
        name: "app",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app:latest"],
      },
      {
        id: "pod",
        kind: "Pod",
        name: "app-pod",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app@sha256:def456"],
        ownerReferences: [{ kind: "ReplicationController", uid: "rc-uid" }],
      },
    ];
    const map = buildOpenShiftCommitMap(resources, [
      {
        kind: "ReplicationController",
        namespace: "ns",
        uid: "rc-uid",
        ownerReferences: [{ kind: "DeploymentConfig", uid: "dc-uid" }],
      },
    ]);

    expect(map.get(SHA)?.namespaces[0].deploymentConfigs.map(resource => resource.name)).toEqual(["app"]);
  });

  test("does not infer workloads from terminating Pods or owner names", () => {
    const resources: OpenShiftResource[] = [
      {
        id: "istag",
        kind: "ImageStreamTag",
        name: "app:latest",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app@sha256:abc123"],
        commitSha: SHA,
      },
      {
        id: "deployment",
        uid: "deployment-uid",
        kind: "Deployment",
        name: "app",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app:latest"],
      },
      {
        id: "pod",
        kind: "Pod",
        name: "app-pod",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app@sha256:abc123"],
        terminating: true,
        ownerReferences: [{ kind: "ReplicaSet", uid: "missing" }],
      },
    ];
    const map = buildOpenShiftCommitMap(resources);

    expect(map.get(SHA)?.namespaces[0].pods).toHaveLength(0);
    expect(map.get(SHA)?.namespaces[0].deployments).toHaveLength(0);
  });

  test("maps workload and pod health states with correct precedence", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/imagestreamtags")) {
        return Response.json({
          items: [
            {
              metadata: { name: "app:latest", annotations: { "dev/commit-sha": SHA } },
              image: { dockerImageReference: "app@sha256:abc" },
            },
          ],
        });
      }
      if (url.includes("/deployments")) {
        return Response.json({
          items: [
            {
              metadata: { name: "degraded" },
              spec: { template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: {
                conditions: [
                  { type: "Available", status: "True" },
                  { type: "Degraded", status: "True" },
                ],
              },
            },
            {
              metadata: { name: "progressing" },
              spec: { template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: { conditions: [{ type: "Progressing", status: "True" }] },
            },
            {
              metadata: { name: "available", generation: 3 },
              spec: { replicas: 2, template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: {
                observedGeneration: 3,
                replicas: 2,
                updatedReplicas: 2,
                availableReplicas: 2,
                unavailableReplicas: 0,
                conditions: [
                  { type: "Available", status: "True" },
                  { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" },
                ],
              },
            },
            {
              metadata: { name: "stale", generation: 4 },
              spec: { replicas: 2, template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: {
                observedGeneration: 3,
                replicas: 2,
                updatedReplicas: 2,
                availableReplicas: 2,
                conditions: [{ type: "Available", status: "True" }],
              },
            },
            {
              metadata: { name: "deadline", generation: 3 },
              spec: { replicas: 2, template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: {
                observedGeneration: 3,
                replicas: 2,
                updatedReplicas: 1,
                availableReplicas: 1,
                conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" }],
              },
            },
            {
              metadata: { name: "scaled-zero", generation: 3 },
              spec: { replicas: 0, template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: { observedGeneration: 3 },
            },
            {
              metadata: { name: "paused-stale", generation: 4 },
              spec: { paused: true, replicas: 2, template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: { observedGeneration: 3, replicas: 2, updatedReplicas: 2, availableReplicas: 2 },
            },
            {
              metadata: { name: "unknown" },
              spec: { template: { spec: { containers: [{ image: "app@sha256:abc" }] } } },
              status: {},
            },
          ],
        });
      }
      if (url.includes("/pods")) {
        return Response.json({
          items: [
            {
              metadata: { name: "starting" },
              status: {
                phase: "Pending",
                containerStatuses: [{ imageID: "app@sha256:abc", state: { waiting: { reason: "ContainerCreating" } } }],
              },
            },
            {
              metadata: { name: "crashing" },
              status: {
                phase: "Running",
                containerStatuses: [{ imageID: "app@sha256:abc", state: { waiting: { reason: "CrashLoopBackOff" } } }],
              },
            },
            {
              metadata: { name: "ready" },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ imageID: "app@sha256:abc", state: { running: {} } }],
              },
            },
            {
              metadata: { name: "not-ready" },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "False" }],
                containerStatuses: [{ imageID: "app@sha256:abc", state: { running: {} } }],
              },
            },
            {
              metadata: { name: "init-failed" },
              status: {
                phase: "Pending",
                initContainerStatuses: [
                  { imageID: "app@sha256:abc", state: { terminated: { reason: "Error", exitCode: 1 } } },
                ],
                containerStatuses: [{ imageID: "app@sha256:abc" }],
              },
            },
            {
              metadata: { name: "terminating", deletionTimestamp: "2026-01-01T00:00:00Z" },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ imageID: "app@sha256:abc", state: { running: {} } }],
              },
            },
            {
              metadata: { name: "unknown" },
              status: { phase: "Unexpected", containerStatuses: [{ imageID: "app@sha256:abc" }] },
            },
          ],
        });
      }
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    try {
      const result = await fetchOpenShiftInventory(
        { serverUrl: "https://example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
      );
      const ns = result.data.get(SHA)?.namespaces[0];
      expect(ns?.deployments.map(resource => [resource.name, resource.status])).toEqual([
        ["degraded", "fail"],
        ["progressing", "running"],
        ["available", "pass"],
        ["stale", "running"],
        ["deadline", "fail"],
        ["scaled-zero", "pass"],
        ["paused-stale", "unknown"],
        ["unknown", "unknown"],
      ]);
      expect(ns?.pods.map(resource => [resource.name, resource.status])).toEqual([
        ["starting", "running"],
        ["crashing", "fail"],
        ["ready", "pass"],
        ["not-ready", "running"],
        ["init-failed", "fail"],
        ["unknown", "unknown"],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stops remaining namespaces after abort", async () => {
    const originalFetch = globalThis.fetch;
    const ctrl = new AbortController();
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      seen.push(url);
      if (url.includes("/namespaces/first/")) ctrl.abort();
      if (ctrl.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;

    try {
      await expect(
        fetchOpenShiftInventory(
          {
            serverUrl: "https://openshift.example.com",
            namespaces: ["first", "second"],
            commitShaAnnotation: "dev/commit-sha",
          },
          "token",
          ctrl.signal,
        ),
      ).rejects.toThrow();
      expect(seen.some(url => url.includes("/namespaces/second/"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("buildOpenShiftGraphBadges", () => {
  const resource = (name: string, status: OpenShiftResource["status"]): OpenShiftResource => ({
    id: name,
    kind: "Pod",
    namespace: "ns",
    name,
    status,
    imageRefs: [],
  });

  const badgeFor = (...statuses: OpenShiftResource["status"][]) => {
    const data = buildOpenShiftCommitMap(
      statuses.map((status, index) => ({
        ...resource(`resource-${index}`, status),
        commitSha: SHA,
      })),
    );
    return buildOpenShiftGraphBadges(data).get(SHA);
  };

  test("uses fail when any matched resource fails", () => {
    expect(badgeFor("pass", "running", "fail")?.badge).toBe("fail");
  });

  test("uses running when no resource fails and one is running", () => {
    expect(badgeFor("pass", "running")?.badge).toBe("running");
  });

  test("uses unknown before pass", () => {
    expect(badgeFor("pass", "unknown")?.badge).toBe("unknown");
  });

  test("uses pass only when every resource passes", () => {
    const badge = badgeFor("pass", "pass");
    expect(badge?.badge).toBe("pass");
    expect(badge?.resourceCount).toBe(2);
  });

  test("does not treat an empty commit as pass", () => {
    const data = new Map<string, OpenShiftCommitData>([[SHA, { sha: SHA, namespaces: [], liveFetched: true }]]);
    expect(buildOpenShiftGraphBadges(data).has(SHA)).toBe(false);
  });

  test("puts terminal Builds in cacheCounts and Pods in liveCounts", () => {
    const data = buildOpenShiftCommitMap([
      { ...resource("pod-1", "pass"), kind: "Pod", commitSha: SHA },
      { ...resource("build-1", "fail"), kind: "Build", commitSha: SHA },
      { ...resource("build-2", "running"), kind: "Build", commitSha: SHA },
    ]);
    const badge = buildOpenShiftGraphBadges(data).get(SHA);
    expect(badge?.lanes?.live).toEqual({ passCount: 1, failCount: 0, runningCount: 1, unknownCount: 0 });
    expect(badge?.lanes?.cache).toEqual({ passCount: 0, failCount: 1, runningCount: 0, unknownCount: 0 });
  });
});

describe("commit identity", () => {
  test("prefers label over annotation", () => {
    expect(
      commitShaFromItem(
        {
          metadata: {
            labels: { "dev/commit-sha": "b".repeat(40) },
            annotations: { "dev/commit-sha": "a".repeat(40) },
          },
        },
        "dev/commit-sha",
      ),
    ).toBe("b".repeat(40));
  });

  test("falls back to annotation when the label is missing", () => {
    expect(commitShaFromItem({ metadata: { annotations: { "dev/commit-sha": SHA } } }, "dev/commit-sha")).toBe(SHA);
  });

  test("reads oc annotate istag from tag.annotations", () => {
    expect(
      commitShaFromItem(
        {
          metadata: { name: "app:stage-internal" },
          tag: { annotations: { "dev/commit-sha": SHA } },
          image: { dockerImageReference: "app@sha256:abc" },
        },
        "dev/commit-sha",
      ),
    ).toBe(SHA);
  });

  test("builds an in-set label selector", () => {
    expect(commitLabelSelector("dev/commit-sha", [SHA, SHA.toUpperCase()])).toBe(
      `labelSelector=${encodeURIComponent(`dev/commit-sha in (${SHA})`)}`,
    );
    expect(commitLabelSelector("dev/commit-sha", [])).toBeNull();
  });
});

describe("fetchOpenShiftInventory modes", () => {
  test("builds mode lists only builds", async () => {
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(input.toString());
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    try {
      await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
        undefined,
        "builds",
      );
      expect(requested.every(url => url.includes("/builds"))).toBe(true);
      expect(requested.some(url => url.includes("/pods"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("seeds mode lists Builds and ImageStreamTags only", async () => {
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(input.toString());
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    try {
      await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
        undefined,
        "seeds",
      );
      expect(requested.some(url => url.includes("/builds"))).toBe(true);
      expect(requested.some(url => url.includes("/imagestreamtags"))).toBe(true);
      expect(requested.some(url => url.includes("/pods"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("live mode lists workloads but not Builds or ImageStreamTags", async () => {
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(input.toString());
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    try {
      await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
        undefined,
        "live",
      );
      expect(requested.some(url => url.includes("/pods"))).toBe(true);
      expect(requested.some(url => url.includes("/builds"))).toBe(false);
      expect(requested.some(url => url.includes("/imagestreamtags"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("seeds with commit SHAs query Builds by label and fall back when empty", async () => {
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(input.toString());
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    try {
      await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
        undefined,
        "seeds",
        { commitShas: [SHA] },
      );
      const buildUrls = requested.filter(url => url.includes("/builds"));
      expect(buildUrls.some(url => url.includes("labelSelector="))).toBe(true);
      expect(buildUrls.some(url => !url.includes("labelSelector="))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("live with labeled Deployments lists only matching Pods", async () => {
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      requested.push(url);
      if (url.includes("/deployments") && url.includes("labelSelector=")) {
        return Response.json({
          items: [
            {
              metadata: {
                name: "app",
                labels: { "dev/commit-sha": SHA },
              },
              spec: {
                selector: { matchLabels: { app: "e-scrap" } },
                template: { spec: { containers: [{ image: "app@sha256:abc" }] } },
              },
              status: { replicas: 1, updatedReplicas: 1, availableReplicas: 1, unavailableReplicas: 0 },
            },
          ],
        });
      }
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    try {
      await fetchOpenShiftInventory(
        { serverUrl: "https://openshift.example.com", namespaces: ["ns"], commitShaAnnotation: "dev/commit-sha" },
        "token",
        undefined,
        "live",
        { commitShas: [SHA] },
      );
      expect(requested.some(url => url.includes("/deployments") && url.includes("labelSelector="))).toBe(true);
      expect(requested.some(url => url.includes("/pods") && url.includes("labelSelector="))).toBe(true);
      expect(requested.some(url => url.includes("/replicasets"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stops after an expired token and keeps the auth banner", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    try {
      const result = await fetchOpenShiftInventory(
        {
          serverUrl: "https://openshift.example.com",
          namespaces: ["one", "two"],
          commitShaAnnotation: "dev/commit-sha",
        },
        "token",
      );
      expect(result.error).toBe(BANNER.openshift.tokenExpired);
      expect(result.successfulRequests).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
