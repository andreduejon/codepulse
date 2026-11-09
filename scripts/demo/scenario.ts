/**
 * Made-up provider data for the demo repository (`bun run demo`): every v0.17 row, label and message has a commit
 * that shows it. Shared by the fake fetch (GitHub, Jenkins, OpenShift) and the fake Snyk CLI.
 */
import { readFileSync } from "node:fs";

export type DemoCommit =
  | "initial"
  | "cart"
  | "rounding"
  | "payments"
  | "readme"
  | "health"
  | "metrics"
  | "retry"
  | `lane${number}`;

export interface DemoState {
  repoPath: string;
  shas: Record<string, string>;
  /** Local branch names, the ones Jenkins reads first. */
  branches: string[];
  /** A commit no branch points at: OpenShift runs it, the graph does not show it. */
  unseenSha: string;
}

export const DEMO_STATE_ENV = "CODEPULSE_DEMO_STATE";
export const GITHUB_REPO = { owner: "demo", repo: "shop" };
export const JENKINS_ROOT = "https://jenkins.demo.invalid/job/shop";
export const OPENSHIFT_SERVER = "https://api.demo.invalid:6443";
export const OPENSHIFT_CONSOLE = "https://console.demo.invalid";
export const NAMESPACES = ["shop-dev", "shop-test", "shop-prod"] as const;
export const COMMIT_KEY = "dev/commit-sha";

export function loadDemoState(): DemoState {
  const path = process.env[DEMO_STATE_ENV];
  if (!path) throw new Error(`${DEMO_STATE_ENV} is not set. Start the demo with: bun run demo`);
  return JSON.parse(readFileSync(path, "utf8")) as DemoState;
}

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

// ── GitHub Actions ───────────────────────────────────────────────────────────

export interface FakeStep {
  name: string;
  conclusion: "success" | "failure" | "skipped" | null;
}
export interface FakeJob {
  id: number;
  name: string;
  attempt: number;
  status: "completed" | "in_progress";
  conclusion: "success" | "failure" | null;
  startedAgoMin: number;
  minutes: number;
  steps: FakeStep[];
  annotations?: { annotation_level: string; path: string; start_line: number; message: string }[];
  log?: string;
}
export interface FakeRun {
  id: number;
  sha: string;
  name: string;
  runNumber: number;
  status: "completed" | "in_progress";
  conclusion: "success" | "failure" | null;
  startedAgoMin: number;
  jobs: FakeJob[];
}

const setupSteps = (conclusion: FakeStep["conclusion"] = "success"): FakeStep[] => [
  { name: "Set up job", conclusion: "success" },
  { name: "Checkout", conclusion: "success" },
  { name: "Install dependencies", conclusion },
];

function testLog(lines: string[]): string {
  const stamp = "2026-11-09T08:14:03.1234567Z";
  return [
    ...[
      "##[group]Run bun test",
      "bun test v1.3.4",
      "src/cart/cart.test.ts:",
      "(pass) cart > adds an item [0.42ms]",
      "(pass) cart > rounds discounts to cents [0.31ms]",
    ],
    ...lines,
    ...Array.from({ length: 40 }, (_, i) => `(pass) payments > case ${i + 1} [0.${i}ms]`),
  ]
    .map(line => `${stamp} ${line}`)
    .join("\n");
}

const LONG_LINE =
  "error: request to https://payments.internal.example/v2/charge failed after 3 retries (attempt=3, backoff=4000ms, idempotency-key=7f3a9c1e-2b4d-4e8a-9c6f-1a2b3c4d5e6f): PaymentGateway timed out after 30000ms and refused the request";

export function githubRuns(state: DemoState): FakeRun[] {
  const s = state.shas;
  return [
    {
      // Re-run: attempt 2 failed again; attempt 1 is folded at the end of the run.
      id: 9001,
      sha: s.payments,
      name: "CI",
      runNumber: 812,
      status: "completed",
      conclusion: "failure",
      startedAgoMin: 180,
      jobs: [
        {
          id: 70011,
          name: "build",
          attempt: 1,
          status: "completed",
          conclusion: "success",
          startedAgoMin: 180,
          minutes: 2,
          steps: [...setupSteps(), { name: "Build", conclusion: "success" }],
        },
        {
          id: 70012,
          name: "test",
          attempt: 1,
          status: "completed",
          conclusion: "failure",
          startedAgoMin: 177,
          minutes: 4,
          steps: [...setupSteps(), { name: "Run tests", conclusion: "failure" }],
          annotations: [
            {
              annotation_level: "failure",
              path: "src/payments/retry.test.ts",
              start_line: 42,
              message: "Expected 200, received 401",
            },
          ],
          log: testLog([
            "src/payments/retry.test.ts:",
            "(fail) retry > charges once after a timeout [12.1ms]",
            "  error: expect(received).toBe(expected)",
            "  Expected 200, received 401",
          ]),
        },
        {
          id: 70021,
          name: "build",
          attempt: 2,
          status: "completed",
          conclusion: "success",
          startedAgoMin: 60,
          minutes: 2,
          steps: [...setupSteps(), { name: "Build", conclusion: "success" }],
        },
        {
          id: 70022,
          name: "test",
          attempt: 2,
          status: "completed",
          conclusion: "failure",
          startedAgoMin: 57,
          minutes: 5,
          steps: [
            ...setupSteps(),
            { name: "Run tests", conclusion: "failure" },
            { name: "Upload coverage", conclusion: "skipped" },
          ],
          annotations: [
            {
              annotation_level: "failure",
              path: "src/payments/retry.test.ts",
              start_line: 42,
              message: "Expected 200, received 401\n\n  at retry.test.ts:42:18\n  at processTicksAndRejections",
            },
            {
              annotation_level: "failure",
              path: "src/payments/gateway-client-with-a-long-file-name.test.ts",
              start_line: 118,
              message: "PaymentGateway timed out after 30000ms and refused the request",
            },
            {
              annotation_level: "warning",
              path: "src/payments/retry.ts",
              start_line: 17,
              message: "'delay' is assigned a value but never used",
            },
            {
              annotation_level: "notice",
              path: ".github",
              start_line: 0,
              message: "Node.js 18 actions are deprecated. This notice is left out of the run tree.",
            },
            {
              annotation_level: "failure",
              path: ".github",
              start_line: 0,
              message: "Process completed with exit code 1.",
            },
          ],
          log: testLog([
            "src/payments/retry.test.ts:",
            "(fail) retry > charges once after a timeout [12.1ms]",
            "  error: expect(received).toBe(expected)",
            "  Expected 200, received 401",
            "src/payments/gateway-client-with-a-long-file-name.test.ts:",
            "(fail) gateway > gives up after three retries [30012.4ms]",
            `  ${LONG_LINE}`,
            "src/payments/retry.ts:17:9 warning: 'delay' is assigned a value but never used",
          ]),
        },
      ],
    },
    {
      id: 9002,
      sha: s.readme,
      name: "CI",
      runNumber: 813,
      status: "completed",
      conclusion: "success",
      startedAgoMin: 40,
      jobs: [
        {
          id: 70031,
          name: "build",
          attempt: 1,
          status: "completed",
          conclusion: "success",
          startedAgoMin: 40,
          minutes: 2,
          steps: [...setupSteps(), { name: "Build", conclusion: "success" }],
        },
        {
          id: 70032,
          name: "test",
          attempt: 1,
          status: "completed",
          conclusion: "success",
          startedAgoMin: 38,
          minutes: 3,
          steps: [...setupSteps(), { name: "Run tests", conclusion: "success" }],
          log: testLog([]),
        },
      ],
    },
    {
      id: 9003,
      sha: s.readme,
      name: "Deploy to shop-prod with a long workflow name",
      runNumber: 77,
      status: "completed",
      conclusion: "success",
      startedAgoMin: 30,
      jobs: [
        {
          id: 70041,
          name: "deploy",
          attempt: 1,
          status: "completed",
          conclusion: "success",
          startedAgoMin: 30,
          minutes: 1,
          steps: [
            { name: "Set up job", conclusion: "success" },
            { name: "oc apply", conclusion: "success" },
          ],
        },
      ],
    },
    {
      id: 9004,
      sha: s.metrics,
      name: "CI",
      runNumber: 814,
      status: "in_progress",
      conclusion: null,
      startedAgoMin: 3,
      jobs: [
        {
          id: 70051,
          name: "test",
          attempt: 1,
          status: "in_progress",
          conclusion: null,
          startedAgoMin: 3,
          minutes: 0,
          steps: [...setupSteps(null), { name: "Run tests", conclusion: null }],
        },
      ],
    },
    {
      id: 9005,
      sha: s.retry,
      name: "CI",
      runNumber: 815,
      status: "completed",
      conclusion: "failure",
      startedAgoMin: 300,
      jobs: [
        {
          id: 70061,
          name: "lint and type check with a long job name",
          attempt: 1,
          status: "completed",
          conclusion: "failure",
          startedAgoMin: 300,
          minutes: 1,
          steps: [...setupSteps(), { name: "Lint", conclusion: "failure" }],
          annotations: [
            {
              annotation_level: "failure",
              path: "src/payments/retry-policy-with-exponential-backoff.ts",
              start_line: 7,
              message:
                "Type 'string' is not assignable to type 'number'. A long message that does not fit a narrow panel.",
            },
          ],
          log: testLog([
            "src/payments/retry-policy-with-exponential-backoff.ts(7,3): error TS2322: Type 'string' is not assignable to type 'number'. A long message that does not fit a narrow panel.",
          ]),
        },
      ],
    },
  ];
}

export function githubTimes(now: number, job: { startedAgoMin: number; minutes: number }) {
  const started = now - job.startedAgoMin * MIN;
  return { started: iso(started), completed: iso(started + job.minutes * MIN + 17_000) };
}

// ── Jenkins ──────────────────────────────────────────────────────────────────

export interface FakeBuild {
  branch: string;
  number: number;
  sha: string;
  result: "SUCCESS" | "FAILURE" | null;
  agoMin: number;
  stages: { name: string; status: "SUCCESS" | "FAILED" | "IN_PROGRESS" | "NOT_EXECUTED"; seconds: number }[];
  tests?: { pass: number; skip: number; failed: { className: string; name: string; details: string; stack: string }[] };
  console: string;
}

function pipelineConsole(stages: { name: string; lines: string[]; nested?: string[] }[]): string {
  const out = ["Started by an SCM change", "[Pipeline] Start of Pipeline", "[Pipeline] node", "[Pipeline] {"];
  for (const stage of stages) {
    out.push("[Pipeline] stage", `[Pipeline] { (${stage.name})`);
    if (stage.nested) {
      out.push("[Pipeline] parallel");
      for (const branch of stage.nested) {
        out.push(`[Pipeline] { (Branch: ${branch})`, "[Pipeline] stage", `[Pipeline] { (${branch})`);
        out.push(`+ ./gradlew ${branch.toLowerCase().replace(/\s+/g, "-")}`, `${branch}: done`);
        out.push("[Pipeline] }", "[Pipeline] // stage", "[Pipeline] }");
      }
      out.push("[Pipeline] // parallel");
    }
    out.push(...stage.lines, "[Pipeline] }", "[Pipeline] // stage");
  }
  out.push("[Pipeline] }", "[Pipeline] // node", "[Pipeline] End of Pipeline");
  return out.join("\n");
}

export function jenkinsBuilds(state: DemoState): FakeBuild[] {
  const s = state.shas;
  return [
    {
      branch: "main",
      number: 41,
      sha: s.payments,
      result: "FAILURE",
      agoMin: 170,
      stages: [
        { name: "Checkout", status: "SUCCESS", seconds: 4 },
        { name: "Build", status: "SUCCESS", seconds: 95 },
        { name: "Unit tests", status: "FAILED", seconds: 210 },
        { name: "Publish image to the internal registry", status: "NOT_EXECUTED", seconds: 0 },
      ],
      tests: {
        pass: 1204,
        skip: 12,
        failed: [
          {
            className: "com.demo.shop.payments.PaymentServiceTest",
            name: "refundsTwice",
            details: "expected: <200> but was: <401>",
            stack:
              "org.opentest4j.AssertionFailedError: expected: <200> but was: <401>\n\tat com.demo.shop.payments.PaymentServiceTest.refundsTwice(PaymentServiceTest.java:42)\n\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)",
          },
          {
            className: "com.demo.shop.payments.RetryPolicyTest",
            name: "givesUpAfterThreeRetriesWhenTheGatewayKeepsTimingOut",
            details: "PaymentGateway timed out after 30000ms",
            stack:
              "java.util.concurrent.TimeoutException: PaymentGateway timed out after 30000ms\n\tat com.demo.shop.payments.RetryPolicy.call(RetryPolicy.java:88)",
          },
          {
            className: "com.demo.shop.cart.CartTest",
            name: "roundsDiscountsToCents",
            details: "expected: <9.99> but was: <9.989999>",
            stack: "org.opentest4j.AssertionFailedError: expected: <9.99> but was: <9.989999>",
          },
        ],
      },
      console: pipelineConsole([
        { name: "Checkout", lines: ["+ git checkout -f payments", "HEAD is now at payments"] },
        { name: "Build", lines: ["+ ./gradlew assemble", "BUILD SUCCESSFUL in 1m 35s"] },
        {
          name: "Unit tests",
          lines: [
            "+ ./gradlew test",
            "PaymentServiceTest > refundsTwice() FAILED",
            "    org.opentest4j.AssertionFailedError: expected: <200> but was: <401>",
            "1207 tests completed, 3 failed, 12 skipped",
            "ERROR: script returned exit code 1",
          ],
        },
        { name: "Publish image to the internal registry", lines: ["Stage skipped due to earlier failure(s)"] },
      ]),
    },
    {
      branch: "main",
      number: 42,
      sha: s.readme,
      result: "SUCCESS",
      agoMin: 35,
      stages: [
        { name: "Checkout", status: "SUCCESS", seconds: 4 },
        { name: "Build", status: "SUCCESS", seconds: 90 },
        { name: "Checks", status: "SUCCESS", seconds: 180 },
        { name: "Publish image to the internal registry", status: "SUCCESS", seconds: 40 },
      ],
      tests: { pass: 1207, skip: 12, failed: [] },
      console: pipelineConsole([
        { name: "Checkout", lines: ["+ git checkout -f readme"] },
        { name: "Build", lines: ["+ ./gradlew assemble", "BUILD SUCCESSFUL in 1m 30s"] },
        { name: "Checks", lines: ["All checks passed"], nested: ["Unit tests", "Integration tests", "Lint"] },
        { name: "Publish image to the internal registry", lines: ["+ docker push registry/shop-api:42"] },
      ]),
    },
    {
      // No test report: the Tests row is left out and Debug stays quiet about the 404.
      branch: "main",
      number: 40,
      sha: s.rounding,
      result: "SUCCESS",
      agoMin: 60 * 26,
      stages: [
        { name: "Checkout", status: "SUCCESS", seconds: 3 },
        { name: "Build", status: "SUCCESS", seconds: 80 },
      ],
      console: pipelineConsole([
        { name: "Checkout", lines: ["+ git checkout -f rounding"] },
        { name: "Build", lines: ["+ ./gradlew assemble", "BUILD SUCCESSFUL in 1m 20s"] },
      ]),
    },
    {
      branch: "dev",
      number: 7,
      sha: s.metrics,
      result: null,
      agoMin: 2,
      stages: [
        { name: "Checkout", status: "SUCCESS", seconds: 3 },
        { name: "Build", status: "IN_PROGRESS", seconds: 60 },
      ],
      // Still running: the Build stage is not closed yet.
      console: [
        "Started by an SCM change",
        "[Pipeline] Start of Pipeline",
        "[Pipeline] node",
        "[Pipeline] {",
        "[Pipeline] stage",
        "[Pipeline] { (Checkout)",
        "+ git checkout -f metrics",
        "[Pipeline] }",
        "[Pipeline] // stage",
        "[Pipeline] stage",
        "[Pipeline] { (Build)",
        "+ ./gradlew assemble",
        "> Task :compileJava",
      ].join("\n"),
    },
  ];
}

/** Branch jobs Jenkins knows about besides the graph's: over the limit of 25, the graph's are read first. */
export const OLD_BRANCHES = Array.from({ length: 16 }, (_, i) => `old/feature-${String(i + 1).padStart(2, "0")}`);

// ── OpenShift ────────────────────────────────────────────────────────────────

export interface OpenShiftWorld {
  /** namespace -> kind -> items */
  lists: Map<string, Map<string, Record<string, unknown>[]>>;
  /** `${namespace}/${kind}/${name}` -> events */
  events: Map<string, Record<string, unknown>[]>;
  logs: Map<string, string>;
}

// Each commit's build makes its own image: codepulse links Deployments and Pods to a commit by image digest.
const digestOf = (sha: string) => `sha256:${sha}${sha.slice(0, 24)}`;
const imageOf = (sha: string) => `image-registry.openshift-image-registry.svc:5000/shop/shop-api@${digestOf(sha)}`;

export function openShiftWorld(state: DemoState, now: number): OpenShiftWorld {
  const s = state.shas;
  const lists = new Map<string, Map<string, Record<string, unknown>[]>>();
  const add = (ns: string, kind: string, item: Record<string, unknown>) => {
    const byKind = lists.get(ns) ?? new Map<string, Record<string, unknown>[]>();
    byKind.set(kind, [...(byKind.get(kind) ?? []), item]);
    lists.set(ns, byKind);
  };
  let uid = 0;
  const nextUid = () => `uid-${++uid}`;
  const created = (agoMin: number) => iso(now - agoMin * MIN);

  const deployment = (
    ns: string,
    name: string,
    sha: string,
    replicas: number,
    status: Record<string, unknown>,
    kind: "Deployment" | "DeploymentConfig" = "Deployment",
  ) => {
    const id = nextUid();
    const labels = { app: name, [COMMIT_KEY]: sha };
    add(ns, kind, {
      kind,
      apiVersion: kind === "Deployment" ? "apps/v1" : "apps.openshift.io/v1",
      metadata: { name, namespace: ns, uid: id, labels, creationTimestamp: created(90), generation: 2 },
      spec: {
        replicas,
        selector: kind === "Deployment" ? { matchLabels: { app: name } } : { app: name },
        template: { metadata: { labels: { app: name } }, spec: { containers: [{ name: "api", image: imageOf(sha) }] } },
      },
      status: { observedGeneration: 2, ...status },
    });
    const rs = nextUid();
    add(ns, kind === "Deployment" ? "ReplicaSet" : "ReplicationController", {
      metadata: { name: `${name}-7d9f8`, namespace: ns, uid: rs, ownerReferences: [{ kind, uid: id }] },
    });
    return rs;
  };

  const pod = (ns: string, name: string, owner: string, app: string, status: Record<string, unknown>) =>
    add(ns, "Pod", {
      kind: "Pod",
      apiVersion: "v1",
      metadata: {
        name,
        namespace: ns,
        uid: nextUid(),
        labels: { app },
        ownerReferences: [{ kind: "ReplicaSet", uid: owner }],
        creationTimestamp: created(45),
      },
      status,
    });
  const container = (sha: string, extra: Record<string, unknown>) => ({
    name: "api",
    image: imageOf(sha),
    imageID: imageOf(sha),
    ...extra,
  });
  const ready = { phase: "Running", conditions: [{ type: "Ready", status: "True" }] };
  const notReady = { phase: "Running", conditions: [{ type: "Ready", status: "False" }] };

  // shop-dev: rolling out `metrics`, one pod cannot pull its image. A failed and a finished Build, an image tag.
  const devRs = deployment("shop-dev", "shop-api", s.metrics, 2, {
    replicas: 2,
    updatedReplicas: 1,
    readyReplicas: 1,
    availableReplicas: 1,
    unavailableReplicas: 1,
    conditions: [{ type: "Progressing", status: "True", reason: "ReplicaSetUpdated" }],
  });
  pod("shop-dev", "shop-api-7d9f8-r2m4p", devRs, "shop-api", {
    ...ready,
    containerStatuses: [container(s.metrics, { ready: true, restartCount: 0, state: { running: {} } })],
  });
  pod("shop-dev", "shop-api-7d9f8-pull9", devRs, "shop-api", {
    phase: "Pending",
    containerStatuses: [
      container(s.metrics, {
        imageID: "",
        restartCount: 0,
        state: { waiting: { reason: "ImagePullBackOff", message: 'Back-off pulling image "shop-api:metrics"' } },
      }),
    ],
  });
  // OpenShift only matches commits that have a Build (or ImageStreamTag), so every deployed commit gets one.
  const completeBuild = (name: string, sha: string) =>
    add("shop-dev", "Build", {
      kind: "Build",
      metadata: { name, namespace: "shop-dev", uid: nextUid(), labels: { [COMMIT_KEY]: sha } },
      spec: { output: { to: { kind: "ImageStreamTag", name: `shop-api:${name.split("-").pop()}` } } },
      status: { phase: "Complete", outputDockerImageReference: imageOf(sha) },
    });
  completeBuild("shop-api-40", s.rounding);
  add("shop-dev", "Build", {
    kind: "Build",
    metadata: { name: "shop-api-41", namespace: "shop-dev", uid: nextUid(), labels: { [COMMIT_KEY]: s.payments } },
    spec: { output: { to: { kind: "ImageStreamTag", name: "shop-api:41" } } },
    status: { phase: "Failed", reason: "DockerBuildFailed", message: "Docker build strategy has failed." },
  });
  // 41 failed, its re-run 42 made the image shop-test runs.
  completeBuild("shop-api-42", s.payments);
  completeBuild("shop-api-43", s.readme);
  completeBuild("shop-api-44", s.metrics);
  add("shop-dev", "ImageStreamTag", {
    kind: "ImageStreamTag",
    metadata: { name: "shop-api:43", namespace: "shop-dev", uid: nextUid(), annotations: { [COMMIT_KEY]: s.readme } },
    image: { metadata: { name: digestOf(s.readme) }, dockerImageReference: imageOf(s.readme) },
  });

  // shop-test: `payments` fails (crash loop, OOM, eviction); a batch job scaled to 0 keeps `rounding` "live".
  const testRs = deployment("shop-test", "shop-api", s.payments, 3, {
    replicas: 3,
    updatedReplicas: 3,
    readyReplicas: 1,
    availableReplicas: 1,
    unavailableReplicas: 2,
    conditions: [
      { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" },
      { type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" },
    ],
  });
  pod("shop-test", "shop-api-7d9f8-x2k4q", testRs, "shop-api", {
    ...notReady,
    containerStatuses: [
      container(s.payments, {
        restartCount: 14,
        state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s restarting failed container" } },
        lastState: { terminated: { reason: "Error", exitCode: 1 } },
      }),
    ],
  });
  pod("shop-test", "shop-api-7d9f8-oom7k", testRs, "shop-api", {
    ...notReady,
    containerStatuses: [
      container(s.payments, { restartCount: 0, state: { terminated: { reason: "OOMKilled", exitCode: 137 } } }),
    ],
  });
  pod("shop-test", "shop-api-7d9f8-ev1ct", testRs, "shop-api", { phase: "Failed", reason: "Evicted" });
  pod("shop-test", "shop-api-7d9f8-ok3zz", testRs, "shop-api", {
    ...ready,
    containerStatuses: [container(s.payments, { ready: true, restartCount: 0, state: { running: {} } })],
  });
  deployment("shop-test", "shop-batch", s.rounding, 0, {});

  // shop-prod: `readme` is live; a worker runs a commit the graph does not show. Events are forbidden here.
  const prodRs = deployment("shop-prod", "shop-api", s.readme, 2, {
    replicas: 2,
    updatedReplicas: 2,
    readyReplicas: 2,
    availableReplicas: 2,
    conditions: [{ type: "Available", status: "True" }],
  });
  for (const name of ["shop-api-5c6b7-a1b2c", "shop-api-5c6b7-d3e4f"])
    pod("shop-prod", name, prodRs, "shop-api", {
      ...ready,
      containerStatuses: [container(s.readme, { ready: true, restartCount: 0, state: { running: {} } })],
    });
  deployment(
    "shop-prod",
    "shop-worker",
    state.unseenSha,
    1,
    { replicas: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, latestVersion: 3 },
    "DeploymentConfig",
  );

  const event = (type: string, reason: string, message: string, count: number, agoMin: number) => ({
    type,
    reason,
    message,
    count,
    lastTimestamp: iso(now - agoMin * MIN),
    metadata: { creationTimestamp: iso(now - (agoMin + 30) * MIN) },
  });
  const events = new Map<string, Record<string, unknown>[]>([
    [
      "shop-test/Pod/shop-api-7d9f8-x2k4q",
      [
        event("Normal", "Scheduled", "Successfully assigned shop-test/shop-api-7d9f8-x2k4q to worker-2", 1, 44),
        event(
          "Normal",
          "Pulled",
          `Container image "shop-api@${digestOf(s.payments).slice(0, 11)}…" already present on machine`,
          15,
          2,
        ),
        event("Normal", "Started", "Started container api", 15, 2),
        event(
          "Warning",
          "Unhealthy",
          "Readiness probe failed: HTTP probe failed with statuscode: 503 (GET http://10.128.2.14:8080/health/ready)",
          42,
          1,
        ),
        event("Warning", "BackOff", "Back-off restarting failed container api in pod shop-api-7d9f8-x2k4q", 61, 0),
      ],
    ],
    [
      "shop-test/Pod/shop-api-7d9f8-oom7k",
      [
        event("Normal", "Started", "Started container api", 1, 20),
        event(
          "Warning",
          "OOMKilling",
          "Memory cgroup out of memory: Killed process 1 (java) total-vm:4194304kB",
          1,
          18,
        ),
      ],
    ],
    [
      "shop-test/Deployment/shop-api",
      [
        event("Normal", "ScalingReplicaSet", "Scaled up replica set shop-api-7d9f8 to 3", 1, 50),
        event("Warning", "ProgressDeadlineExceeded", "ReplicaSet shop-api-7d9f8 has timed out progressing.", 1, 40),
      ],
    ],
    [
      "shop-dev/Pod/shop-api-7d9f8-pull9",
      [
        event("Normal", "Pulling", 'Pulling image "shop-api:metrics"', 6, 1),
        event("Warning", "Failed", 'Failed to pull image "shop-api:metrics": manifest unknown: manifest unknown', 6, 1),
        event("Warning", "BackOff", 'Back-off pulling image "shop-api:metrics"', 20, 0),
      ],
    ],
    [
      "shop-dev/Build/shop-api-41",
      [
        event("Normal", "BuildStarted", "Build shop-dev/shop-api-41 is now running", 1, 170),
        event("Warning", "BuildFailed", "Build shop-dev/shop-api-41 failed", 1, 165),
      ],
    ],
  ]);

  const logs = new Map<string, string>([
    [
      "shop-test/shop-api-7d9f8-x2k4q",
      [
        "Starting ShopApiApplication v0.42.0 using Java 21.0.5",
        "Tomcat initialized with port 8080 (http)",
        `ERROR 1 --- [main] o.s.boot.SpringApplication : Application run failed: ${LONG_LINE}`,
        "Caused by: java.net.SocketTimeoutException: Connect timed out",
        "\tat java.base/sun.nio.ch.NioSocketImpl.timedFinishConnect(NioSocketImpl.java:546)",
      ].join("\n"),
    ],
    ["shop-dev/shop-api-41", "Step 4/9 : RUN ./gradlew assemble\nerror: build failed: DockerBuildFailed\n"],
  ]);

  return { lists, events, logs };
}

/** Lines a followed Pod log keeps adding, so the viewer drops its oldest ones. */
export function followLine(n: number): string {
  const level = n % 17 === 0 ? "WARN" : "INFO";
  return `2026-11-09T08:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}Z ${level} request ${n} GET /api/cart 200 ${(n * 7) % 90}ms${n % 50 === 0 ? " PaymentGateway slow" : ""}`;
}

// ── Snyk ─────────────────────────────────────────────────────────────────────

interface Vuln {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  packageName: string;
  version: string;
  from: string[];
  upgradePath: (string | false)[];
  fixedIn: string[];
  cvssScore: number;
  identifiers: { CVE: string[] };
}

const vuln = (
  id: string,
  title: string,
  severity: Vuln["severity"],
  pkg: string,
  version: string,
  fixed: string,
  score: number,
  cve: string,
  via?: string,
): Vuln => ({
  id,
  title,
  severity,
  packageName: pkg,
  version,
  from: via ? ["shop@1.0.0", via, `${pkg}@${version}`] : ["shop@1.0.0", `${pkg}@${version}`],
  upgradePath: via ? [false, via, `${pkg}@${fixed}`] : [false, `${pkg}@${fixed}`],
  fixedIn: [fixed],
  cvssScore: score,
  identifiers: { CVE: [cve] },
});

const LODASH = (version: string) =>
  vuln("SNYK-JS-LODASH-1040724", "Prototype Pollution", "high", "lodash", version, "4.17.21", 7.5, "CVE-2020-8203");
const AXIOS = vuln(
  "SNYK-JS-AXIOS-6032459",
  "Cross-site Request Forgery",
  "medium",
  "axios",
  "1.5.1",
  "1.6.0",
  6.5,
  "CVE-2023-45857",
);
const MINIMIST = vuln(
  "SNYK-JS-MINIMIST-2429795",
  "Prototype Pollution",
  "low",
  "minimist",
  "1.2.5",
  "1.2.6",
  3.7,
  "CVE-2021-44906",
  "mkdirp@0.5.5",
);
const JWT = vuln(
  "SNYK-JS-JSONWEBTOKEN-3180022",
  "Improper Authentication",
  "critical",
  "jsonwebtoken",
  "8.5.1",
  "9.0.0",
  9.1,
  "CVE-2022-23540",
);
const LONG_PACKAGE = vuln(
  "SNYK-JS-COMPANYPAYMENTSGATEWAYCLIENT-7001234",
  "Server-side Request Forgery (SSRF)",
  "high",
  "@company/payments-gateway-client-with-a-very-long-package-name",
  "2.14.0-beta.3",
  "2.14.1",
  8.2,
  "CVE-2026-10001",
);

/**
 * What the fake Snyk CLI finds per commit. `rounding` against `cart`: lodash bumped but still vulnerable (no change),
 * axios fixed, jsonwebtoken new. `payments` against `rounding`: the long-named package is new.
 */
export function snykVulnerabilities(state: DemoState, sha: string): Vuln[] {
  const s = state.shas;
  if (sha === s.initial) return [];
  if (sha === s.cart) return [LODASH("4.17.15"), AXIOS, MINIMIST];
  if (sha === s.rounding) return [LODASH("4.17.20"), MINIMIST, JWT];
  return [LODASH("4.17.20"), MINIMIST, JWT, LONG_PACKAGE];
}
