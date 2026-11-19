import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearDebugEvents, getDebugEvents } from "../../core/debug-events";
import { OPENSHIFT_BANNER } from "../../core/openshift/banner";
import {
  buildOpenShiftCommitMap,
  buildOpenShiftGraphBadges,
  buildOpenShiftNamespaceMarkers,
  commitLabelSelector,
  commitShaFromItem,
  resourceFromWatchObject,
} from "../../core/openshift/resources";
import type { OpenShiftCommitData, OpenShiftResource } from "../../core/openshift/types";
import { linkWarningsToCommits } from "../../core/openshift/warnings";
import {
  fetchOpenShiftEvents,
  fetchOpenShiftInventory,
  fetchOpenShiftResources,
  fetchOpenShiftWarnings,
  MAX_LIST_ITEMS,
  MAX_LIST_PAGES,
} from "./api";

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
        // Stopped, not failed: neutral, as GitHub's cancelled runs and Jenkins' aborted builds.
        ["Cancelled", "cancelled"],
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
      expect(result.error).toBe(OPENSHIFT_BANNER.inventoryPartial);
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
      expect(result.error).toBe(OPENSHIFT_BANNER.inventoryPartial);
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
      expect(result.error).toBe(OPENSHIFT_BANNER.inventoryPartial);
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
      expect(result.error).toBe(OPENSHIFT_BANNER.inventoryPartial);
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
      expect(result.error).toBe(OPENSHIFT_BANNER.inventoryPartial);
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
      expect(result.error).toBe(OPENSHIFT_BANNER.invalidNamespace);
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

  test("during a rollout an old pod stays with the commit its image is from, and so does its ReplicaSet's warning", () => {
    const OLD = "a".repeat(40);
    const NEW = "b".repeat(40);
    const pod = (name: string, digest: string, owner: string): OpenShiftResource => ({
      id: `Pod:ns:${name}`,
      kind: "Pod",
      name,
      namespace: "ns",
      status: "running",
      imageRefs: [`app@sha256:${digest}`],
      labels: { app: "svc" },
      ownerReferences: [{ kind: "ReplicaSet", uid: owner }],
    });
    const tag = (sha: string, digest: string): OpenShiftResource => ({
      id: `ImageStreamTag:ns:app:${sha.slice(0, 1)}`,
      kind: "ImageStreamTag",
      name: `app:${sha.slice(0, 1)}`,
      namespace: "ns",
      status: "pass",
      imageRefs: [`sha256:${digest}`],
      commitSha: sha,
    });
    const deployment: OpenShiftResource = {
      id: "Deployment:ns:app",
      uid: "deploy-uid",
      kind: "Deployment",
      name: "app",
      namespace: "ns",
      status: "running",
      imageRefs: [],
      commitSha: NEW,
      // The selector is the same for every rollout: the old pods match it too.
      podSelector: { app: "svc" },
    };
    const controllers = [
      {
        kind: "ReplicaSet" as const,
        namespace: "ns",
        uid: "old-rs",
        createdAt: "2026-03-02T08:00:00Z",
        ownerReferences: [{ kind: "Deployment", uid: "deploy-uid" }],
      },
      {
        kind: "ReplicaSet" as const,
        namespace: "ns",
        uid: "new-rs",
        createdAt: "2026-03-02T10:00:00Z",
        ownerReferences: [{ kind: "Deployment", uid: "deploy-uid" }],
      },
    ];
    const map = buildOpenShiftCommitMap(
      [
        tag(OLD, "aaa111"),
        tag(NEW, "bbb222"),
        deployment,
        pod("app-old", "aaa111", "old-rs"),
        pod("app-new", "bbb222", "new-rs"),
      ],
      controllers,
    );
    expect(map.get(OLD)?.namespaces[0]?.pods.map(item => item.name)).toEqual(["app-old"]);
    expect(map.get(NEW)?.namespaces[0]?.pods.map(item => item.name)).toEqual(["app-new"]);
    const linked = linkWarningsToCommits(
      [
        {
          id: "event-old-rs",
          namespace: "ns",
          kind: "ReplicaSet",
          name: "app-old",
          uid: "old-rs",
          reason: "FailedCreate",
          message: "Error creating: pods is forbidden",
          count: 1,
          firstSeen: "2026-03-02T08:30:00Z",
          lastSeen: "2026-03-02T08:30:00Z",
        },
      ],
      map,
      controllers,
    );
    expect([...linked.keys()]).toEqual([OLD]);
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

  test.each<[string, OpenShiftResource["status"][], "pass" | "fail" | "running" | "unknown"]>([
    ["fail when any matched resource fails", ["pass", "running", "fail"], "fail"],
    ["running when no resource fails and one is running", ["pass", "running"], "running"],
    ["unknown before pass", ["pass", "unknown"], "unknown"],
  ])("uses %s", (_label, statuses, expected) => {
    expect(badgeFor(...statuses)?.badge).toBe(expected);
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

  test("a cancelled Build is neutral: a grey chip, not a failure", () => {
    const data = buildOpenShiftCommitMap([
      { ...resource("build-1", "cancelled"), kind: "Build", commitSha: SHA },
      { ...resource("build-2", "pass"), kind: "Build", commitSha: SHA },
    ]);
    const badge = buildOpenShiftGraphBadges(data).get(SHA);
    expect(badge?.lanes?.live).toEqual({ passCount: 1, failCount: 0, runningCount: 0, unknownCount: 1 });
    expect(badge?.badge).toBe("unknown");
  });

  test("Resources counts what the cluster lists now, finished builds too; what only the cache has apart", () => {
    const data = buildOpenShiftCommitMap([
      { ...resource("pod-1", "pass"), kind: "Pod", commitSha: SHA },
      { ...resource("build-1", "fail"), kind: "Build", commitSha: SHA },
      { ...resource("build-2", "running"), kind: "Build", commitSha: SHA },
      { ...resource("build-0", "pass"), kind: "Build", commitSha: SHA, cacheOnly: true },
    ]);
    const badge = buildOpenShiftGraphBadges(data).get(SHA);
    expect(badge?.lanes?.live).toEqual({ passCount: 1, failCount: 1, runningCount: 1, unknownCount: 0 });
    expect(badge?.cachedCount).toBe(1);
  });

  test("Events counts the warnings the cluster still reports; the rest apart, also when only they are left", () => {
    const warning = {
      id: "event-1",
      namespace: "ns",
      kind: "Pod",
      name: "gone-pod",
      reason: "BackOff",
      message: "Back-off restarting failed container",
      count: 3,
      firstSeen: null,
      lastSeen: null,
    };
    const withResources = buildOpenShiftCommitMap([{ ...resource("pod-1", "pass"), commitSha: SHA }]);
    const quiet = buildOpenShiftGraphBadges(withResources).get(SHA);
    expect(quiet?.warningCount).toBeUndefined();
    expect(quiet?.cachedEventCount).toBeUndefined();
    const commit = withResources.get(SHA) as OpenShiftCommitData;
    const three = [warning, { ...warning, id: "event-2", count: 40 }, { ...warning, id: "event-3" }];
    const cachedOnes = (_sha: string, entry: { id: string }) => entry.id === "event-3";
    const warned = buildOpenShiftGraphBadges(new Map([[SHA, { ...commit, warnings: three }]]), cachedOnes).get(SHA);
    expect(warned).toMatchObject({ warningCount: 2, cachedEventCount: 1 });
    // The pod is gone; its warnings stay with the commit, only in the cache.
    const onlyWarnings = new Map([[SHA, { sha: SHA, namespaces: [], liveFetched: true, warnings: [warning] }]]);
    expect(buildOpenShiftGraphBadges(onlyWarnings, () => true).get(SHA)).toMatchObject({
      cachedEventCount: 1,
      resourceCount: 0,
    });
    // Normal events the cluster lists now: green while their resource is there; about a gone one, with the cached.
    const normal = [
      { ...warning, id: "pulled", reason: "Pulled" },
      { ...warning, id: "started", reason: "Started" },
      { ...warning, id: "killing", reason: "Killing" },
    ];
    const live = buildOpenShiftGraphBadges(
      new Map([[SHA, { ...commit, normalEvents: normal }]]),
      () => false,
      (_sha, entry) => entry.id === "killing",
    ).get(SHA);
    expect(live).toMatchObject({ normalEventCount: 2, cachedEventCount: 1 });
    expect(live?.warningCount).toBeUndefined();
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
      expect(result.error).toBe(OPENSHIFT_BANNER.tokenExpired);
      expect(result.successfulRequests).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("failing status", () => {
  const pod = (status: Record<string, unknown>) => ({
    kind: "Pod",
    metadata: { name: "api-7f9c", namespace: "dev" },
    status,
  });
  const statusOf = (object: unknown) => resourceFromWatchObject(object, "dev/commit-sha")?.status;

  test("a Pod fails on a crash loop, a bad exit, a failed image pull or an eviction", () => {
    expect(
      statusOf(
        pod({
          phase: "Running",
          containerStatuses: [
            {
              restartCount: 14,
              state: { waiting: { reason: "CrashLoopBackOff" } },
              lastState: { terminated: { reason: "Error", exitCode: 1 } },
            },
          ],
        }),
      ),
    ).toBe("fail");
    expect(
      statusOf(
        pod({
          phase: "Running",
          containerStatuses: [{ restartCount: 0, state: { terminated: { reason: "OOMKilled", exitCode: 137 } } }],
        }),
      ),
    ).toBe("fail");
    expect(
      statusOf(pod({ phase: "Pending", containerStatuses: [{ state: { waiting: { reason: "ImagePullBackOff" } } }] })),
    ).toBe("fail");
    expect(statusOf(pod({ phase: "Failed", reason: "Evicted" }))).toBe("fail");
  });

  test("a Deployment fails past its progress deadline or when it cannot create replicas", () => {
    const deployment = (status: Record<string, unknown>, replicas = 3) => ({
      kind: "Deployment",
      metadata: { name: "api", namespace: "dev", generation: 2 },
      spec: { replicas },
      status: { observedGeneration: 2, ...status },
    });
    expect(
      statusOf(
        deployment({
          readyReplicas: 1,
          conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" }],
        }),
      ),
    ).toBe("fail");
    expect(
      statusOf(deployment({ conditions: [{ type: "ReplicaFailure", status: "True", reason: "FailedCreate" }] }, 2)),
    ).toBe("fail");
  });

  test("a ready Pod passes and a starting one is in progress", () => {
    expect(statusOf(pod({ phase: "Running", conditions: [{ type: "Ready", status: "True" }] }))).toBe("pass");
    expect(
      statusOf(pod({ phase: "Pending", containerStatuses: [{ state: { waiting: { reason: "ContainerCreating" } } }] })),
    ).toBe("running");
  });
});

describe("fetchOpenShiftEvents", () => {
  const pod: OpenShiftResource = {
    id: "Pod:dev:api-7f9c",
    kind: "Pod",
    namespace: "dev",
    name: "api-7f9c",
    status: "fail",
    imageRefs: [],
  };
  const withFetch = async (response: Response, run: (url: () => string) => Promise<void>) => {
    const originalFetch = globalThis.fetch;
    let url = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      url = String(input);
      return response;
    }) as typeof fetch;
    try {
      await run(() => url);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  test("lists the events about the resource, by kind and name, newest first", async () => {
    const items = [
      {
        type: "Normal",
        reason: "Scheduled",
        message: "Successfully assigned",
        count: 1,
        lastTimestamp: "2026-01-01T00:00:00Z",
      },
      {
        metadata: { uid: "event-backoff" },
        type: "Warning",
        reason: "BackOff",
        message: "Back-off restarting",
        count: 31,
        lastTimestamp: "2026-01-01T00:10:00Z",
      },
      {
        type: "Warning",
        reason: "Unhealthy",
        message: "Readiness probe failed",
        series: { count: 6, lastObservedTime: "2026-01-01T00:05:00Z" },
        eventTime: "2026-01-01T00:01:00Z",
      },
    ];
    await withFetch(new Response(JSON.stringify({ items }), { status: 200 }), async url => {
      const events = await fetchOpenShiftEvents("https://api.example.com:6443", "token", pod);
      expect(url()).toBe(
        `https://api.example.com:6443/api/v1/namespaces/dev/events?fieldSelector=${encodeURIComponent(
          "involvedObject.kind=Pod,involvedObject.name=api-7f9c",
        )}`,
      );
      // The uid: the resource dialog leaves out a cached warning the cluster still lists.
      expect(events[0]?.id).toBe("event-backoff");
      expect(events.map(event => [event.reason, event.count, event.lastSeen])).toEqual([
        ["BackOff", 31, "2026-01-01T00:10:00Z"],
        ["Unhealthy", 6, "2026-01-01T00:05:00Z"],
        ["Scheduled", 1, "2026-01-01T00:00:00Z"],
      ]);
    });
  });

  test("a resource with a uid asks for its own events: not those of one recreated under its name", async () => {
    await withFetch(new Response(JSON.stringify({ items: [] }), { status: 200 }), async url => {
      await fetchOpenShiftEvents("https://api.example.com:6443", "token", { ...pod, uid: "pod-uid" });
      expect(url()).toBe(
        `https://api.example.com:6443/api/v1/namespaces/dev/events?fieldSelector=${encodeURIComponent(
          "involvedObject.kind=Pod,involvedObject.name=api-7f9c,involvedObject.uid=pod-uid",
        )}`,
      );
    });
  });

  test("a missing events permission says which permission", async () => {
    await withFetch(new Response("forbidden", { status: 403 }), async () => {
      await expect(fetchOpenShiftEvents("https://api.example.com:6443", "token", pod)).rejects.toThrow(
        "No permission to list events",
      );
    });
  });
});

describe("fetchOpenShiftWarnings", () => {
  const config = { serverUrl: "https://api.example.com:6443", namespaces: ["dev", "prod"], commitShaAnnotation: "x" };
  const withFetch = async (answer: (url: URL) => Response, run: (urls: string[]) => Promise<void>) => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return answer(new URL(String(input)));
    }) as typeof fetch;
    try {
      await run(urls);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  test("lists each namespace's warnings: what they are about, how often and when", async () => {
    const items = [
      {
        metadata: { uid: "event-1", creationTimestamp: "2026-01-01T00:00:00Z" },
        type: "Warning",
        reason: "BackOff",
        message: "Back-off restarting\n failed container",
        count: 31,
        firstTimestamp: "2026-01-01T00:01:00Z",
        lastTimestamp: "2026-01-01T00:10:00Z",
        involvedObject: { kind: "Pod", name: "api-7f9c", uid: "pod-uid", namespace: "dev" },
      },
      {
        metadata: { uid: "event-2" },
        type: "Warning",
        reason: "FailedCreate",
        note: "Error creating: pods is forbidden",
        series: { count: 6, lastObservedTime: "2026-01-01T00:05:00Z" },
        eventTime: "2026-01-01T00:02:00Z",
        regarding: { kind: "ReplicaSet", name: "api-7f9c", uid: "rs-uid" },
      },
      {
        metadata: { uid: "event-3" },
        type: "Normal",
        reason: "Pulled",
        message: "Container image already present on machine",
        count: 2,
        lastTimestamp: "2026-01-01T00:09:00Z",
        involvedObject: { kind: "Pod", name: "api-7f9c", uid: "pod-uid", namespace: "dev" },
      },
    ];
    await withFetch(
      url => new Response(JSON.stringify({ items: url.pathname.includes("/dev/") ? items : [] }), { status: 200 }),
      async urls => {
        const result = await fetchOpenShiftWarnings(config, "token");
        expect(urls.map(url => decodeURIComponent(url))).toEqual([
          "https://api.example.com:6443/api/v1/namespaces/dev/events",
          "https://api.example.com:6443/api/v1/namespaces/prod/events",
        ]);
        expect(result.denied).toEqual([]);
        // A Normal event is shown while the cluster lists it, apart from the warnings, which are kept.
        expect(result.normal?.map(event => [event.id, event.reason, event.name])).toEqual([
          ["event-3", "Pulled", "api-7f9c"],
        ]);
        expect(result.warnings).toEqual([
          {
            id: "event-1",
            namespace: "dev",
            kind: "Pod",
            name: "api-7f9c",
            uid: "pod-uid",
            reason: "BackOff",
            message: "Back-off restarting failed container",
            count: 31,
            firstSeen: "2026-01-01T00:01:00Z",
            lastSeen: "2026-01-01T00:10:00Z",
          },
          {
            id: "event-2",
            namespace: "dev",
            kind: "ReplicaSet",
            name: "api-7f9c",
            uid: "rs-uid",
            reason: "FailedCreate",
            message: "Error creating: pods is forbidden",
            count: 6,
            firstSeen: "2026-01-01T00:02:00Z",
            lastSeen: "2026-01-01T00:05:00Z",
          },
        ]);
      },
    );
  });

  test("a namespace whose events the token may not list is named, the others still answer", async () => {
    await withFetch(
      url =>
        url.pathname.includes("/prod/")
          ? new Response("forbidden", { status: 403 })
          : new Response(JSON.stringify({ items: [] }), { status: 200 }),
      async () => {
        const result = await fetchOpenShiftWarnings(config, "token");
        expect(result).toEqual({ warnings: [], normal: [], denied: ["prod"], failed: [] });
      },
    );
  });

  test("an expired token stops at the first namespace", async () => {
    await withFetch(
      () => new Response("unauthorized", { status: 401 }),
      async urls => {
        const result = await fetchOpenShiftWarnings(config, "token");
        expect(result.failure).toBe("auth");
        expect(urls).toHaveLength(1);
      },
    );
  });
});

describe("buildOpenShiftNamespaceMarkers", () => {
  const workload = (
    kind: "Deployment" | "DeploymentConfig",
    namespace: string,
    name: string,
    commitSha: string | undefined,
    status: OpenShiftResource["status"],
  ): OpenShiftResource => ({
    id: `${kind}:${namespace}:${name}`,
    kind,
    namespace,
    name,
    status,
    imageRefs: [],
    commitSha,
  });

  test("each namespace marks the commits its workloads run, in the configured namespace order", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const markers = buildOpenShiftNamespaceMarkers(
      [
        workload("Deployment", "test", "api", a, "running"),
        workload("Deployment", "dev", "api", a, "pass"),
        workload("DeploymentConfig", "dev", "worker", a, "pass"),
        workload("Deployment", "prod", "api", b.toUpperCase(), "pass"),
        workload("Deployment", "dev", "web", undefined, "pass"),
        // A Pod says nothing about what a namespace was deployed with.
        {
          id: "Pod:dev:api-1",
          kind: "Pod",
          namespace: "dev",
          name: "api-1",
          status: "fail",
          imageRefs: [],
          commitSha: b,
        },
      ],
      ["dev", "test", "prod"],
    );
    expect(markers.get(a)).toEqual([
      { namespace: "dev", state: "live" },
      { namespace: "test", state: "rolling" },
    ]);
    expect(markers.get(b)).toEqual([{ namespace: "prod", state: "live" }]);
  });

  test("a failing workload wins over a rolling one, which wins over a live one, per namespace", () => {
    const a = "a".repeat(40);
    const markers = buildOpenShiftNamespaceMarkers(
      [
        workload("Deployment", "dev", "api", a, "pass"),
        workload("Deployment", "dev", "worker", a, "running"),
        workload("Deployment", "test", "api", a, "running"),
        workload("Deployment", "test", "worker", a, "fail"),
      ],
      ["dev", "test"],
    );
    expect(markers.get(a)).toEqual([
      { namespace: "dev", state: "rolling" },
      { namespace: "test", state: "fail" },
    ]);
  });

  test("a Deployment scaled to 0 runs nothing, so it marks no namespace", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const markers = buildOpenShiftNamespaceMarkers(
      [
        { ...workload("Deployment", "test", "batch", a, "pass"), scaledToZero: true },
        { ...workload("DeploymentConfig", "test", "worker", b, "running"), scaledToZero: true },
        workload("Deployment", "dev", "batch", a, "pass"),
      ],
      ["dev", "test"],
    );
    expect(markers.get(a)).toEqual([{ namespace: "dev", state: "live" }]);
    expect(markers.has(b)).toBe(false);
  });

  test("Deployments and DeploymentConfigs with 0 replicas are scaled to 0", () => {
    const workloadObject = (kind: string, spec: Record<string, unknown>) =>
      resourceFromWatchObject(
        { kind, metadata: { name: "batch", namespace: "test" }, spec, status: { observedGeneration: 1 } },
        "dev/commit-sha",
      );
    expect(workloadObject("Deployment", { replicas: 0 })?.scaledToZero).toBe(true);
    expect(workloadObject("DeploymentConfig", { replicas: 0 })?.scaledToZero).toBe(true);
    expect(workloadObject("Deployment", { replicas: 2 })?.scaledToZero).toBeUndefined();
    // No replicas field means 1.
    expect(workloadObject("Deployment", {})?.scaledToZero).toBeUndefined();
  });
});
