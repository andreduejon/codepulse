import { describe, expect, test } from "bun:test";
import type { OpenShiftCommitData, OpenShiftControllerReference, OpenShiftResource } from "./types";
import {
  isAboutPresentResource,
  linkWarningsToCommits,
  mergeWarnings,
  type OpenShiftWarning,
  resourceOfWarning,
  warningsAbout,
} from "./warnings";

const warning = (overrides: Partial<OpenShiftWarning> = {}): OpenShiftWarning => ({
  id: "event-1",
  namespace: "shop-dev",
  kind: "Pod",
  name: "shop-api-7d9f8-pull9",
  reason: "BackOff",
  message: "Back-off restarting failed container",
  count: 1,
  firstSeen: "2026-03-02T09:16:00Z",
  lastSeen: "2026-03-02T09:16:00Z",
  ...overrides,
});

const resource = (overrides: Partial<OpenShiftResource>): OpenShiftResource => ({
  id: `${overrides.namespace ?? "shop-dev"}/${overrides.kind}/${overrides.name}`,
  kind: "Pod",
  namespace: "shop-dev",
  name: "shop-api-7d9f8-pull9",
  status: "fail",
  imageRefs: [],
  ...overrides,
});

const commit = (sha: string, resources: OpenShiftResource[]): OpenShiftCommitData => ({
  sha,
  liveFetched: true,
  namespaces: [
    {
      namespace: "shop-dev",
      builds: resources.filter(r => r.kind === "Build"),
      imageStreamTags: [],
      deployments: resources.filter(r => r.kind === "Deployment"),
      deploymentConfigs: resources.filter(r => r.kind === "DeploymentConfig"),
      pods: resources.filter(r => r.kind === "Pod"),
    },
  ],
});

describe("OpenShift warnings", () => {
  test("the same warning read again is one entry with its newest count and times, newest first", () => {
    const merged = mergeWarnings(
      [warning({ count: 3, lastSeen: "2026-03-02T09:20:00Z" }), warning({ id: "event-2", reason: "Unhealthy" })],
      [warning({ count: 12, lastSeen: "2026-03-02T09:30:00Z" })],
    );
    expect(merged.map(entry => [entry.id, entry.count, entry.lastSeen])).toEqual([
      ["event-1", 12, "2026-03-02T09:30:00Z"],
      ["event-2", 1, "2026-03-02T09:16:00Z"],
    ]);
    // An older read never undoes a newer one (a cache read after a live one).
    expect(mergeWarnings(merged, [warning({ count: 3, lastSeen: "2026-03-02T09:20:00Z" })])[0]?.count).toBe(12);
  });

  test("a warning goes to the commit whose resource it is about; one about a ReplicaSet to its Deployment's", () => {
    const deployment = resource({ kind: "Deployment", name: "shop-api", uid: "deploy-uid", status: "running" });
    const pod = resource({ kind: "Pod", name: "shop-api-7d9f8-pull9" });
    const commits = new Map([
      ["a".repeat(40), commit("a".repeat(40), [deployment, pod])],
      ["b".repeat(40), commit("b".repeat(40), [resource({ kind: "Pod", name: "other-pod", status: "pass" })])],
    ]);
    const controllers: OpenShiftControllerReference[] = [
      {
        kind: "ReplicaSet",
        namespace: "shop-dev",
        uid: "rs-uid",
        ownerReferences: [{ kind: "Deployment", uid: "deploy-uid" }],
      },
    ];
    const linked = linkWarningsToCommits(
      [
        warning(),
        warning({ id: "event-2", kind: "ReplicaSet", name: "shop-api-7d9f8", uid: "rs-uid", reason: "FailedCreate" }),
        // About a resource no commit has: kept out, there is nowhere to show it.
        warning({ id: "event-3", name: "unrelated-pod" }),
        // The same name in another namespace is another resource.
        warning({ id: "event-4", namespace: "shop-prod" }),
      ],
      commits,
      controllers,
    );
    expect([...linked.keys()]).toEqual(["a".repeat(40)]);
    expect(linked.get("a".repeat(40))?.map(entry => entry.id)).toEqual(["event-1", "event-2"]);
  });

  test("a resource's own warnings, for its mark in the Resources tab", () => {
    const warnings = [warning(), warning({ id: "event-2", name: "another-pod" })];
    expect(warningsAbout(resource({ name: "shop-api-7d9f8-pull9" }), warnings).map(entry => entry.id)).toEqual([
      "event-1",
    ]);
    expect(warningsAbout(resource({ name: "quiet-pod" }), warnings)).toEqual([]);
  });

  test("the resource a warning is about: the commit's own, or one by its name when it is gone", () => {
    const pod = resource({ kind: "Pod", name: "shop-api-7d9f8-pull9", status: "fail", uid: "pod-uid" });
    const data = commit("a".repeat(40), [pod]);
    expect(resourceOfWarning(warning(), data)).toBe(pod);
    expect(resourceOfWarning(warning({ name: "gone-pod" }), data)).toEqual({
      id: "shop-dev/Pod/gone-pod",
      kind: "Pod",
      namespace: "shop-dev",
      name: "gone-pod",
      status: "unknown",
      imageRefs: [],
    });
    // A kind codepulse doesn't show as a resource has none.
    expect(resourceOfWarning(warning({ kind: "ReplicaSet", name: "shop-api-7d9f8" }), data)).toBeNull();
  });

  test("a Deployment's warning from before its commit's rollout is not that commit's", () => {
    const deployment = resource({ kind: "Deployment", name: "shop-api", uid: "deploy-uid", status: "running" });
    const commits = new Map([["b".repeat(40), commit("b".repeat(40), [deployment])]]);
    // The commit's ReplicaSet was created at 10:00: its rollout started then.
    const controllers: OpenShiftControllerReference[] = [
      {
        kind: "ReplicaSet",
        namespace: "shop-dev",
        uid: "old-rs",
        createdAt: "2026-03-02T08:00:00Z",
        ownerReferences: [{ kind: "Deployment", uid: "deploy-uid" }],
      },
      {
        kind: "ReplicaSet",
        namespace: "shop-dev",
        uid: "new-rs",
        createdAt: "2026-03-02T10:00:00Z",
        ownerReferences: [{ kind: "Deployment", uid: "deploy-uid" }],
      },
    ];
    const about = { kind: "Deployment", name: "shop-api", reason: "ProgressDeadlineExceeded" };
    const linked = linkWarningsToCommits(
      [
        // The previous commit's rollout: not this one's.
        warning({ id: "old", ...about, lastSeen: "2026-03-02T09:20:00Z" }),
        warning({ id: "new", ...about, lastSeen: "2026-03-02T10:20:00Z" }),
      ],
      commits,
      controllers,
    );
    expect(linked.get("b".repeat(40))?.map(entry => entry.id)).toEqual(["new"]);
  });

  test("a warning is about a present resource when the commit has it with the same uid", () => {
    const pod = resource({ kind: "Pod", name: "shop-api-7d9f8-pull9", uid: "pod-uid" });
    const data = commit("a".repeat(40), [pod]);
    const controllers: OpenShiftControllerReference[] = [
      { kind: "ReplicaSet", namespace: "shop-dev", uid: "rs-uid", ownerReferences: [] },
    ];
    expect(isAboutPresentResource(warning({ uid: "pod-uid" }), data, controllers)).toBe(true);
    // The same name, another object: the pod was recreated.
    expect(isAboutPresentResource(warning({ uid: "older-pod-uid" }), data, controllers)).toBe(false);
    expect(isAboutPresentResource(warning({ name: "replaced-pod" }), data, controllers)).toBe(false);
    // A ReplicaSet: by its uid in the live list.
    const rs = { kind: "ReplicaSet", name: "shop-api-7d9f8" };
    expect(isAboutPresentResource(warning({ ...rs, uid: "rs-uid" }), data, controllers)).toBe(true);
    expect(isAboutPresentResource(warning({ ...rs, uid: "gone-rs" }), data, controllers)).toBe(false);
    // Its mark in Resources follows the same rule.
    expect(warningsAbout(pod, [warning({ uid: "older-pod-uid" })])).toEqual([]);
  });

  test("before the live list has its new ReplicaSet, the commit's oldest pod marks its rollout", () => {
    const deployment = resource({ kind: "Deployment", name: "shop-api", uid: "deploy-uid", status: "running" });
    const pod = resource({ kind: "Pod", name: "shop-api-5c6d7-a1b2", updatedAt: "2026-03-02T10:00:00Z" });
    const commits = new Map([["b".repeat(40), commit("b".repeat(40), [deployment, pod])]]);
    // Only the previous rollout's ReplicaSet is listed yet.
    const controllers: OpenShiftControllerReference[] = [
      {
        kind: "ReplicaSet",
        namespace: "shop-dev",
        uid: "old-rs",
        createdAt: "2026-03-02T08:00:00Z",
        ownerReferences: [{ kind: "Deployment", uid: "deploy-uid" }],
      },
    ];
    const about = { kind: "Deployment", name: "shop-api", reason: "ProgressDeadlineExceeded" };
    const linked = linkWarningsToCommits(
      [warning({ id: "old", ...about, lastSeen: "2026-03-02T09:20:00Z" })],
      commits,
      controllers,
    );
    expect(linked.size).toBe(0);
  });
});

