import { describe, expect, test } from "bun:test";
import { buildOpenShiftCommitMap, fetchOpenShiftInventory } from "./api";
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
      expect(new Set(urls)).toHaveLength(5);
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
      expect(result.failures).toHaveLength(5);
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
        ["unknown", "unknown"],
      ]);
      expect(ns?.pods.map(resource => [resource.name, resource.status])).toEqual([
        ["starting", "running"],
        ["crashing", "fail"],
        ["unknown", "unknown"],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
