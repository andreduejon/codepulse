import { expect, test } from "bun:test";
import { formatOpenShiftStatus } from "./events";

const texts = (kind: Parameters<typeof formatOpenShiftStatus>[0], object: unknown) =>
  formatOpenShiftStatus(kind, object).map(line => line.text.trimEnd());

test("a crash-looping Pod says why: what it waits on, how its last run ended, its restarts, and its False conditions", () => {
  const lines = formatOpenShiftStatus("Pod", {
    status: {
      phase: "Running",
      conditions: [
        { type: "PodScheduled", status: "True" },
        {
          type: "Ready",
          status: "False",
          reason: "ContainersNotReady",
          message: "containers with unready status: [api]",
        },
      ],
      containerStatuses: [
        {
          name: "api",
          restartCount: 61,
          state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s restarting failed container" } },
          lastState: { terminated: { reason: "Error", exitCode: 1 } },
        },
      ],
    },
  });
  expect(lines.map(line => line.kind)).toEqual(["header", "warning", "warning", "warning"]);
  const [header, waiting, lastRun, ready] = lines.map(line => line.text.trimEnd());
  expect(header).toMatch(/^STATUS\s+REASON\s+MESSAGE$/);
  expect(waiting).toMatch(/^waiting\s+CrashLoopBackOff\s+back-off 5m0s restarting failed container$/);
  expect(lastRun).toMatch(/^last run\s+Error · exit 1 · 61 restarts$/);
  expect(ready).toMatch(/^Ready False\s+ContainersNotReady\s+containers with unready status: \[api\]$/);
  // Aligned columns, like the events below them.
  expect(waiting.indexOf("CrashLoopBackOff")).toBe(header.indexOf("REASON"));
  expect(ready.indexOf("containers")).toBe(header.indexOf("MESSAGE"));
});

test("an evicted or OOM-killed Pod says so; with several containers each row names its container", () => {
  expect(
    texts("Pod", { status: { phase: "Failed", reason: "Evicted", message: "The node was low on resource: memory." } }),
  ).toEqual([expect.stringMatching(/^STATUS/), expect.stringMatching(/^Failed\s+Evicted\s+The node was low/)]);
  const lines = texts("Pod", {
    status: {
      containerStatuses: [
        { name: "api", restartCount: 0, state: { terminated: { reason: "OOMKilled", exitCode: 137 } } },
        { name: "proxy", state: { waiting: { reason: "ContainerCreating" } } },
      ],
    },
  });
  expect(lines.slice(1)).toEqual([
    expect.stringMatching(/^ended api\s+OOMKilled · exit 137$/),
    expect.stringMatching(/^waiting proxy\s+ContainerCreating$/),
  ]);
});

test("a Deployment or DeploymentConfig lists only the conditions that say something is wrong", () => {
  for (const kind of ["Deployment", "DeploymentConfig"] as const) {
    const lines = texts(kind, {
      status: {
        conditions: [
          {
            type: "Available",
            status: "False",
            reason: "MinimumReplicasUnavailable",
            message: "Deployment does not have minimum availability.",
          },
          {
            type: "Progressing",
            status: "False",
            reason: "ProgressDeadlineExceeded",
            message: 'ReplicaSet "shop-api-7d9f8" has timed out progressing.',
          },
          { type: "ReplicaFailure", status: "True", reason: "FailedCreate", message: "pods are forbidden" },
          { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" },
        ],
      },
    });
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(/^Available False\s+MinimumReplicasUnavailable\s+Deployment does not have/),
      expect.stringMatching(/^Progressing False\s+ProgressDeadlineExceeded\s+ReplicaSet "shop-api-7d9f8" has timed/),
      expect.stringMatching(/^ReplicaFailure True\s+FailedCreate\s+pods are forbidden$/),
    ]);
  }
});

test("a failed Build gives its phase, reason and message", () => {
  expect(
    texts("Build", {
      status: { phase: "Failed", reason: "DockerBuildFailed", message: "Docker build strategy has failed." },
    }).slice(1),
  ).toEqual([expect.stringMatching(/^Failed\s+DockerBuildFailed\s+Docker build strategy has failed\.$/)]);
});

test("a healthy resource, or one without its object, has nothing to say", () => {
  expect(
    texts("Pod", {
      status: {
        phase: "Running",
        conditions: [{ type: "Ready", status: "True" }],
        containerStatuses: [{ name: "api", state: { running: {} } }],
      },
    }),
  ).toEqual([]);
  expect(texts("Build", { status: { phase: "Complete" } })).toEqual([]);
  expect(texts("Deployment", null)).toEqual([]);
  expect(texts("ImageStreamTag", { status: {} })).toEqual([]);
});
