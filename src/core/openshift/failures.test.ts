import { describe, expect, test } from "bun:test";
import { commitFailures } from "./failures";
import { extractBuild, extractPod, extractWorkload } from "./resources";
import type { OpenShiftCommitData, OpenShiftResource } from "./types";

const SHA = "a".repeat(40);

const commit = (resources: OpenShiftResource[]): OpenShiftCommitData => ({
  sha: SHA,
  liveFetched: true,
  namespaces: [
    {
      namespace: "shop-test",
      builds: resources.filter(r => r.kind === "Build"),
      imageStreamTags: [],
      deployments: resources.filter(r => r.kind === "Deployment"),
      deploymentConfigs: [],
      pods: resources.filter(r => r.kind === "Pod"),
    },
  ],
});

const crashingPod = extractPod("shop-test", {
  metadata: { name: "shop-api-7d9f8-x2k4q", uid: "pod-uid" },
  status: {
    phase: "Running",
    containerStatuses: [
      {
        name: "api",
        restartCount: 61,
        state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s restarting failed container" } },
        lastState: { terminated: { reason: "Error", exitCode: 1 } },
      },
    ],
    conditions: [{ type: "Ready", status: "False", reason: "ContainersNotReady" }],
  },
});

const failedBuild = {
  ...(extractBuild(
    "shop-test",
    {
      metadata: { name: "shop-api-41", uid: "build-uid", labels: { "dev/commit-sha": SHA } },
      status: { phase: "Failed", reason: "GenericBuildFailed", message: "Generic Build failure - check logs" },
    },
    "dev/commit-sha",
  ) as OpenShiftResource),
};

/** The pod OpenShift ran the build in: owned by the Build, not by any commit. */
const buildPod = extractPod("shop-test", {
  metadata: {
    name: "shop-api-41-build",
    uid: "build-pod-uid",
    labels: { "openshift.io/build.name": "shop-api-41" },
    ownerReferences: [{ kind: "Build", uid: "build-uid" }],
  },
  status: {
    phase: "Failed",
    initContainerStatuses: [{ name: "git-clone", state: { terminated: { reason: "Completed", exitCode: 0 } } }],
    containerStatuses: [{ name: "docker-build", state: { terminated: { reason: "Error", exitCode: 1 } } }],
  },
});

describe("a commit's failures", () => {
  test("what a failing resource's status says, by reason; its conditions only when nothing else says why", () => {
    const failures = commitFailures(commit([crashingPod]));
    expect(failures.map(entry => [entry.kind, entry.name, entry.reason, entry.status])).toEqual([
      ["Pod", "shop-api-7d9f8-x2k4q", "CrashLoopBackOff", "waiting"],
      ["Pod", "shop-api-7d9f8-x2k4q", "Error", "last run"],
    ]);
    expect(failures[1]?.message).toBe("Error · exit 1 · 61 restarts");
    expect(failures[0]?.uid).toBe("pod-uid");
  });

  test("a healthy resource has none, and a Deployment's failing condition is one", () => {
    const healthy = extractPod("shop-test", {
      metadata: { name: "ok", uid: "ok" },
      status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
    });
    const stuck = extractWorkload(
      "Deployment",
      "shop-test",
      {
        metadata: { name: "shop-api", uid: "deploy-uid" },
        spec: { replicas: 1 },
        status: {
          conditions: [
            {
              type: "Progressing",
              status: "False",
              reason: "ProgressDeadlineExceeded",
              message: 'ReplicaSet "shop-api-7d9f8" has timed out progressing.',
            },
          ],
        },
      },
      "dev/commit-sha",
    );
    expect(commitFailures(commit([healthy]))).toEqual([]);
    expect(commitFailures(commit([stuck])).map(entry => [entry.name, entry.reason])).toEqual([
      ["shop-api", "ProgressDeadlineExceeded"],
    ]);
  });

  test("a failed build says why, and so does the pod it ran in: the step that failed, not the ones that passed", () => {
    const failures = commitFailures(commit([failedBuild]), [buildPod]);
    expect(failures.map(entry => [entry.kind, entry.name, entry.reason, entry.status])).toEqual([
      ["Build", "shop-api-41", "GenericBuildFailed", "Failed"],
      ["Pod", "shop-api-41-build", "Error", "ended docker-build"],
    ]);
    // Each failure has its own id.
    expect(new Set(failures.map(entry => entry.id)).size).toBe(failures.length);
  });

  test("a failed build without a reason still says it failed: its phase, with its message", () => {
    const build = extractBuild(
      "shop-test",
      {
        metadata: { name: "shop-api-42", uid: "build-42", labels: { "dev/commit-sha": SHA } },
        status: { phase: "Failed", message: "Build failed" },
      },
      "dev/commit-sha",
    ) as OpenShiftResource;
    expect(commitFailures(commit([build])).map(entry => [entry.reason, entry.status, entry.message])).toEqual([
      ["Failed", "Failed", "Build failed"],
    ]);
  });
});
