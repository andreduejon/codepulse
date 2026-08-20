import { describe, expect, test } from "bun:test";
import { buildOpenShiftCommitMap, buildOpenShiftGraphBadges, fetchOpenShiftInventory } from "./api";
import type { OpenShiftResource } from "./types";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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
      expect(result.error).toContain("Build");
      expect(result.error).toContain("DeploymentConfig");
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
      expect(result.error).toContain("Invalid OpenShift namespace");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("correlates unannotated resources only through immutable image digests", () => {
    const resource = (kind: OpenShiftResource["kind"], name: string, imageRefs: string[], commitSha?: string) =>
      ({ id: name, kind, name, namespace: "ns", status: "pass", imageRefs, commitSha, raw: {} }) as OpenShiftResource;
    const map = buildOpenShiftCommitMap([
      resource("ImageStreamTag", "app:latest", ["registry/ns/app:latest", "sha256:abc123"], SHA),
      resource("Deployment", "tag-only", ["registry/ns/app:latest"]),
      resource("Pod", "digest", ["registry/ns/app@sha256:abc123"]),
    ]);

    expect(map.get(SHA)?.namespaces[0].imageStreamTags).toHaveLength(1);
    expect(map.get(SHA)?.namespaces[0].deployments).toHaveLength(0);
    expect(map.get(SHA)?.namespaces[0].pods.map(p => p.name)).toEqual(["digest"]);
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
        raw: {},
      },
      {
        id: "deployment",
        uid: "deployment-uid",
        kind: "Deployment",
        name: "app",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app:latest"],
        raw: {},
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
        raw: {},
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
        raw: {},
      },
      {
        id: "dc",
        uid: "dc-uid",
        kind: "DeploymentConfig",
        name: "app",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app:latest"],
        raw: {},
      },
      {
        id: "pod",
        kind: "Pod",
        name: "app-pod",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app@sha256:def456"],
        ownerReferences: [{ kind: "ReplicationController", uid: "rc-uid" }],
        raw: {},
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
        raw: {},
      },
      {
        id: "deployment",
        uid: "deployment-uid",
        kind: "Deployment",
        name: "app",
        namespace: "ns",
        status: "pass",
        imageRefs: ["app:latest"],
        raw: {},
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
        raw: {},
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
});

describe("buildOpenShiftGraphBadges", () => {
  const resource = (name: string, status: OpenShiftResource["status"]): OpenShiftResource => ({
    id: name,
    kind: "Pod",
    namespace: "ns",
    name,
    status,
    imageRefs: [],
    raw: {},
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
});
