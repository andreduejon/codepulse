/**
 * Made-up provider data for the demo repositories (`bun run demo`): every row, label and message has a commit that
 * shows it. Shared by the fake servers (GitHub, Jenkins, OpenShift) and the fake CLIs.
 *
 * The world has phases. Phase 0 is the start; `--live` or the `advance` step moves it on:
 * 1. The running work finishes: the GitHub run on `metrics` passes, its Jenkins build fails, the shop-dev rollout
 *    fails to pull its image.
 * 2. A new commit lands on origin/dev, with a queued GitHub run and a running Jenkins build.
 */
import { readFileSync } from "node:fs";
import { gatewayClientTest, RETRY_TEST } from "./codebase";
import {
  buildLog,
  crashLoopLog,
  type GitHubJobKind,
  type JavaFailure,
  type JenkinsStageLog,
  jenkinsConsole,
  type TestFailure,
} from "./logs";
import type { ProviderMode, ProviderName } from "./options";
import { ANNOTATION_LINES, shopHistory } from "./repositories";

export interface DemoState {
  root: string;
  repoPath: string;
  /** The second repository in the group. */
  webRepoPath: string;
  /** Where the local stand-ins for github.com live (see fake-ssh.ts). */
  remotes: string;
  shas: Record<string, string>;
  webShas: Record<string, string>;
  /** Local branch names, the ones Jenkins reads first. */
  branches: string[];
  /** A commit no branch points at: OpenShift runs it, the graph does not show it. */
  unseenSha: string;
  providers: Record<ProviderName, ProviderMode>;
  latency: number;
  live: number | null;
  headless: boolean;
}

export const DEMO_STATE_ENV = "CODEPULSE_DEMO_STATE";
/**
 * The commands the app hands a URL (`o`) or text (copy) to, on every OS. The demo has its own of each, so neither
 * reaches the user's browser or clipboard: they write what they got to `OUTSIDE_LOG` in the demo folder.
 */
export const BROWSER_COMMANDS = ["open", "xdg-open", "powershell"];
export const CLIPBOARD_COMMANDS = ["pbcopy", "wl-copy", "xclip", "clip"];
export const OUTSIDE_LOG = "outside.log";
/** The headless play, for the app process (play.ts). */
export const PLAY_ENV = "CODEPULSE_DEMO_PLAY";

export interface PlayConfig {
  steps: string;
  width: number;
  height: number;
  repoPath: string;
}

export const REMOTES_ENV = "CODEPULSE_DEMO_REMOTES";
export const GITHUB_REPOS = [
  { owner: "demo", repo: "shop" },
  { owner: "demo", repo: "shop-web" },
] as const;
export const JENKINS_ROOT = "https://jenkins.demo.invalid/job/shop";
export const OPENSHIFT_SERVER = "https://api.demo.invalid:6443";
export const OPENSHIFT_CONSOLE = "https://console.demo.invalid";
export const NAMESPACES = ["shop-dev", "shop-test", "shop-prod"] as const;
export const COMMIT_KEY = "dev/commit-sha";
/** The headless demo's clock starts here, so `--play` prints the same dates every run. */
export const FIXED_NOW = Date.parse("2026-03-02T09:30:00.000Z");
export const LAST_PHASE = 2;

export function loadDemoState(): DemoState {
  const path = process.env[DEMO_STATE_ENV];
  if (!path) throw new Error(`${DEMO_STATE_ENV} is not set. Start the demo with: bun run demo`);
  return JSON.parse(readFileSync(path, "utf8")) as DemoState;
}

/** Where the world is: its phase, and when each phase so far began (index 0 is the demo's start). */
export interface Phase {
  index: number;
  at: readonly number[];
}

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

// ── GitHub Actions ───────────────────────────────────────────────────────────

export interface FakeStep {
  name: string;
  conclusion: "success" | "failure" | "skipped" | "cancelled" | null;
}
export interface FakeJob {
  id: number;
  name: string;
  attempt: number;
  status: "completed" | "in_progress" | "queued";
  conclusion: "success" | "failure" | "cancelled" | "timed_out" | "skipped" | null;
  startedAgoMin: number;
  minutes: number;
  /** When it ended, for a job that finished as the world moved on (overrides `minutes`). */
  endsAt?: number;
  steps: FakeStep[];
  annotations?: { annotation_level: string; path: string; start_line: number; message: string }[];
  /** What its log shows (logs.ts builds it): the job's kind, its failing tests, a linter's findings. */
  logKind?: GitHubJobKind;
  failures?: TestFailure[];
  lint?: string[];
}
export interface FakeRun {
  id: number;
  repo: (typeof GITHUB_REPOS)[number]["repo"];
  sha: string;
  name: string;
  runNumber: number;
  status: "completed" | "in_progress" | "queued";
  conclusion: "success" | "failure" | "cancelled" | "timed_out" | null;
  startedAgoMin: number;
  jobs: FakeJob[];
}

const setupSteps = (conclusion: FakeStep["conclusion"] = "success"): FakeStep[] => [
  { name: "Set up job", conclusion: "success" },
  { name: "Checkout", conclusion: "success" },
  { name: "Install dependencies", conclusion },
];

const WORKSPACE = "/home/runner/work/shop/shop";

const RETRY_FAILURE: TestFailure = {
  file: "src/payments/retry.test.ts",
  name: "retry > charges once after a timeout",
  source: RETRY_TEST,
  at: "expect(response.status).toBe(200)",
  error: [
    "error: expect(received).toBe(expected)",
    "",
    "Expected: 200",
    "Received: 401",
    "",
    `      at <anonymous> (${WORKSPACE}/src/payments/retry.test.ts:${ANNOTATION_LINES.retryTest}:29)`,
  ],
  annotation: "Expected 200, received 401",
  ms: 12.1,
};

const UNUSED_DELAY = [
  "",
  `${WORKSPACE}/src/payments/retry.ts`,
  `  ${ANNOTATION_LINES.unusedDelay}:9  warning  'delay' is assigned a value but never used  @typescript-eslint/no-unused-vars`,
  "",
  "✖ 1 problem (0 errors, 1 warning)",
];

const TYPE_ERROR =
  "Type 'string' is not assignable to type 'number'. The expected type comes from property 'maxAttempts', which is declared here on type 'RetryPolicy'.";

const LONG_LINE =
  "error: request to https://payments.internal.example/v2/charge failed after 3 retries (attempt=3, backoff=4000ms, idempotency-key=7f3a9c1e-2b4d-4e8a-9c6f-1a2b3c4d5e6f): PaymentGateway timed out after 30000ms and refused the request";

const GATEWAY_FAILURE: TestFailure = {
  file: "src/payments/gateway-client-with-a-long-file-name.test.ts",
  name: "gateway > gives up after three retries",
  source: gatewayClientTest(),
  at: 'test("gives up after three retries"',
  error: [
    'error: Test "gives up after three retries" timed out after 31000ms',
    LONG_LINE,
    "",
    `      at <anonymous> (${WORKSPACE}/src/payments/gateway-client-with-a-long-file-name.test.ts:${ANNOTATION_LINES.gatewayTest}:3)`,
  ],
  annotation: "PaymentGateway timed out after 30000ms and refused the request",
  ms: 30012.4,
};

export function githubRuns(state: DemoState, phase: Phase): FakeRun[] {
  const s = state.shas;
  const w = state.webShas;
  const finished = phase.index >= 1;
  return [
    {
      // Re-run: attempt 2 failed again; attempt 1 is folded at the end of the run.
      id: 9001,
      repo: "shop",
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
              start_line: ANNOTATION_LINES.retryTest,
              message: "Expected 200, received 401",
            },
          ],
          logKind: "test",
          failures: [RETRY_FAILURE],
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
              start_line: ANNOTATION_LINES.retryTest,
              message: "Expected 200, received 401\n\n  at retry.test.ts:42:18\n  at processTicksAndRejections",
            },
            {
              annotation_level: "failure",
              path: "src/payments/gateway-client-with-a-long-file-name.test.ts",
              start_line: ANNOTATION_LINES.gatewayTest,
              message: "PaymentGateway timed out after 30000ms and refused the request",
            },
            {
              annotation_level: "warning",
              path: "src/payments/retry.ts",
              start_line: ANNOTATION_LINES.unusedDelay,
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
          logKind: "test",
          failures: [RETRY_FAILURE, GATEWAY_FAILURE],
          lint: UNUSED_DELAY,
        },
        {
          // Needs test: skipped once it failed.
          id: 70023,
          name: "deploy",
          attempt: 2,
          status: "completed",
          conclusion: "skipped",
          startedAgoMin: 52,
          minutes: 0,
          steps: [],
        },
      ],
    },
    {
      id: 9002,
      repo: "shop",
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
          logKind: "test",
        },
      ],
    },
    {
      id: 9003,
      repo: "shop",
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
          logKind: "deploy",
        },
      ],
    },
    {
      // Running at the start; passes once the world moves on.
      id: 9004,
      repo: "shop",
      sha: s.metrics,
      name: "CI",
      runNumber: 814,
      status: finished ? "completed" : "in_progress",
      conclusion: finished ? "success" : null,
      startedAgoMin: 3,
      jobs: [
        {
          id: 70051,
          name: "test",
          attempt: 1,
          status: finished ? "completed" : "in_progress",
          conclusion: finished ? "success" : null,
          startedAgoMin: 3,
          minutes: 0,
          endsAt: phase.at[1],
          steps: [
            ...setupSteps(finished ? "success" : null),
            { name: "Run tests", conclusion: finished ? "success" : null },
          ],
          logKind: "test",
        },
      ],
    },
    {
      // Queued behind CI at the start, deploying once CI passed.
      id: 9006,
      repo: "shop",
      sha: s.metrics,
      name: "Deploy preview",
      runNumber: 78,
      status: finished ? "in_progress" : "queued",
      conclusion: null,
      startedAgoMin: 3,
      jobs: [
        {
          id: 70052,
          name: "deploy",
          attempt: 1,
          status: finished ? "in_progress" : "queued",
          conclusion: null,
          startedAgoMin: 3,
          minutes: 0,
          steps: finished
            ? [
                { name: "Set up job", conclusion: "success" },
                { name: "oc apply", conclusion: null },
              ]
            : [],
          logKind: "deploy",
        },
      ],
    },
    {
      // Cancelled by hand while its tests ran.
      id: 9007,
      repo: "shop",
      sha: s.health,
      name: "CI",
      runNumber: 811,
      status: "completed",
      conclusion: "cancelled",
      startedAgoMin: 48,
      jobs: [
        {
          id: 70071,
          name: "test",
          attempt: 1,
          status: "completed",
          conclusion: "cancelled",
          startedAgoMin: 48,
          minutes: 2,
          steps: [...setupSteps(), { name: "Run tests", conclusion: "cancelled" }],
          logKind: "test",
        },
      ],
    },
    {
      // The nightly end-to-end run hit its time limit.
      id: 9008,
      repo: "shop",
      sha: s.rounding,
      name: "Nightly e2e",
      runNumber: 203,
      status: "completed",
      conclusion: "timed_out",
      startedAgoMin: 60 * 24 * 8,
      jobs: [
        {
          id: 70081,
          name: "e2e",
          attempt: 1,
          status: "completed",
          conclusion: "timed_out",
          startedAgoMin: 60 * 24 * 8,
          minutes: 60,
          steps: [...setupSteps(), { name: "Run e2e", conclusion: "cancelled" }],
          logKind: "e2e",
        },
      ],
    },
    ...(phase.index >= 2
      ? [
          {
            id: 9009,
            repo: "shop" as const,
            sha: s.next,
            name: "CI",
            runNumber: 816,
            status: "queued" as const,
            conclusion: null,
            startedAgoMin: 0,
            jobs: [],
          },
        ]
      : []),
    {
      id: 9005,
      repo: "shop",
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
              start_line: ANNOTATION_LINES.retryPolicy,
              message: TYPE_ERROR,
            },
          ],
          logKind: "lint",
          failures: [
            {
              file: "src/payments/retry-policy-with-exponential-backoff.ts",
              name: "typecheck",
              error: [
                `src/payments/retry-policy-with-exponential-backoff.ts(${ANNOTATION_LINES.retryPolicy},58): error TS2322: ${TYPE_ERROR}`,
              ],
              annotation: TYPE_ERROR,
              ms: 0,
            },
          ],
        },
      ],
    },
    // shop-web, the second repository in the group.
    {
      id: 9101,
      repo: "shop-web",
      sha: w.gallery,
      name: "CI",
      runNumber: 51,
      status: "completed",
      conclusion: "success",
      startedAgoMin: 60 * 47,
      jobs: [
        {
          id: 71011,
          name: "build",
          attempt: 1,
          status: "completed",
          conclusion: "success",
          startedAgoMin: 60 * 47,
          minutes: 3,
          steps: [...setupSteps(), { name: "Build", conclusion: "success" }],
        },
      ],
    },
    {
      id: 9102,
      repo: "shop-web",
      sha: w.prices,
      name: "CI",
      runNumber: 52,
      status: "completed",
      conclusion: "failure",
      startedAgoMin: 170,
      jobs: [
        {
          id: 71021,
          name: "build",
          attempt: 1,
          status: "completed",
          conclusion: "failure",
          startedAgoMin: 170,
          minutes: 2,
          steps: [...setupSteps(), { name: "Build", conclusion: "failure" }],
          logKind: "web-test",
          failures: [
            {
              file: "src/price.test.ts",
              name: "price > shows two decimals",
              error: ["error: expect(received).toBe(expected)", "", 'Expected: "9.90"', 'Received: "9.9"'],
              annotation: 'Expected "9.90", received "9.9"',
              ms: 1.2,
            },
          ],
        },
      ],
    },
  ];
}

export function githubTimes(now: number, job: Pick<FakeJob, "startedAgoMin" | "minutes" | "endsAt">) {
  const started = now - job.startedAgoMin * MIN;
  return { started: iso(started), completed: iso(job.endsAt ?? started + job.minutes * MIN + 17_000) };
}

// ── Jenkins ──────────────────────────────────────────────────────────────────

export interface FakeBuild {
  branch: string;
  number: number;
  sha: string;
  result: "SUCCESS" | "FAILURE" | "ABORTED" | "UNSTABLE" | null;
  agoMin: number;
  stages: {
    name: string;
    status: "SUCCESS" | "FAILED" | "IN_PROGRESS" | "NOT_EXECUTED" | "ABORTED" | "UNSTABLE";
    seconds: number;
  }[];
  tests?: { pass: number; skip: number; failed: { className: string; name: string; details: string; stack: string }[] };
  console: string;
}

type BuildData = Omit<FakeBuild, "console">;

/** Each build's console, from its stages, tests and result (logs.ts writes it the way Jenkins does). */
export function jenkinsBuilds(state: DemoState, phase: Phase): FakeBuild[] {
  const subjects = new Map(shopHistory().commits.map(commit => [state.shas[commit.key], commit.subject]));
  return jenkinsBuildData(state, phase).map(build => ({
    ...build,
    console: consoleOf(build, subjects.get(build.sha) ?? ""),
  }));
}

function consoleOf(build: BuildData, subject: string): string {
  const failures: JavaFailure[] = (build.tests?.failed ?? []).map(test => ({
    className: test.className,
    method: test.name,
    error: test.stack.split("\n")[0] ?? test.details,
    line: Number(/:(\d+)\)/.exec(test.stack)?.[1] ?? 42),
  }));
  const stages = build.stages.map((stage): JenkinsStageLog => {
    const kind = /checkout/i.test(stage.name)
      ? "checkout"
      : /^checks$/i.test(stage.name)
        ? "checks"
        : /test/i.test(stage.name)
          ? "test"
          : /publish/i.test(stage.name)
            ? "publish"
            : stage.status === "ABORTED"
              ? "aborted"
              : "build";
    const state =
      stage.status === "NOT_EXECUTED"
        ? "skipped"
        : stage.status === "IN_PROGRESS"
          ? "running"
          : stage.status === "FAILED" || stage.status === "ABORTED"
            ? "failed"
            : "done";
    return {
      name: stage.name,
      seconds: stage.seconds,
      kind,
      state,
      ...(kind === "test" && build.tests
        ? {
            failures,
            tests: { total: build.tests.pass + build.tests.skip + failures.length, skipped: build.tests.skip },
          }
        : {}),
    };
  });
  return jenkinsConsole({
    job: `shop/${build.branch}`,
    branch: build.branch,
    sha: build.sha,
    subject,
    stages,
    result: build.result,
    seed: `${build.branch}#${build.number}`,
    ...(build.result === "ABORTED" ? { abortedBy: "Ana Lima" } : {}),
  });
}

function jenkinsBuildData(state: DemoState, phase: Phase): BuildData[] {
  const s = state.shas;
  const started = phase.at[0];
  // dev #7 runs at the start and fails its tests once the world moves on.
  const metricsAgoMin = 2;
  const metricsTestSeconds = phase.at[1]
    ? Math.max(5, Math.round((phase.at[1] - (started - metricsAgoMin * MIN)) / 1000) - 63)
    : 0;
  const metricsBuild: BuildData =
    phase.index >= 1
      ? {
          branch: "dev",
          number: 7,
          sha: s.metrics,
          result: "FAILURE",
          agoMin: metricsAgoMin,
          stages: [
            { name: "Checkout", status: "SUCCESS", seconds: 3 },
            { name: "Build", status: "SUCCESS", seconds: 60 },
            { name: "Unit tests", status: "FAILED", seconds: metricsTestSeconds },
          ],
          tests: {
            pass: 1205,
            skip: 12,
            failed: [
              {
                className: "com.demo.shop.api.MetricsExporterTest",
                name: "exportsRequestCounts",
                details: "expected: <42> but was: <0>",
                stack:
                  "org.opentest4j.AssertionFailedError: expected: <42> but was: <0>\n\tat com.demo.shop.api.MetricsExporterTest.exportsRequestCounts(MetricsExporterTest.java:31)",
              },
              {
                className: "com.demo.shop.api.MetricsExporterTest",
                name: "labelsRequestsByRoute",
                details: "Missing label: route",
                stack:
                  "java.lang.IllegalStateException: Missing label: route\n\tat com.demo.shop.api.Metrics.label(Metrics.java:57)",
              },
            ],
          },
        }
      : {
          branch: "dev",
          number: 7,
          sha: s.metrics,
          result: null,
          agoMin: metricsAgoMin,
          stages: [
            { name: "Checkout", status: "SUCCESS", seconds: 3 },
            { name: "Build", status: "IN_PROGRESS", seconds: 60 },
          ],
        };
  return [
    metricsBuild,
    {
      // Aborted by hand during its build.
      branch: "dev",
      number: 6,
      sha: s.health,
      result: "ABORTED",
      agoMin: 47,
      stages: [
        { name: "Checkout", status: "SUCCESS", seconds: 3 },
        { name: "Build", status: "ABORTED", seconds: 41 },
        { name: "Unit tests", status: "NOT_EXECUTED", seconds: 0 },
      ],
    },
    {
      // Unstable: it built, one test failed.
      branch: "feature/payments-retry-with-a-really-long-branch-name",
      number: 3,
      sha: s.retry,
      result: "UNSTABLE",
      agoMin: 340,
      stages: [
        { name: "Checkout", status: "SUCCESS", seconds: 4 },
        { name: "Build", status: "SUCCESS", seconds: 88 },
        { name: "Unit tests", status: "UNSTABLE", seconds: 190 },
      ],
      tests: {
        pass: 1206,
        skip: 12,
        failed: [
          {
            className: "com.demo.shop.payments.RetryPolicyTest",
            name: "waitsLongerAfterEachAttempt",
            details: "expected: <4000> but was: <2000>",
            stack: "org.opentest4j.AssertionFailedError: expected: <4000> but was: <2000>",
          },
        ],
      },
    },
    ...(phase.index >= 2
      ? [
          {
            branch: "dev",
            number: 8,
            sha: s.next,
            result: null,
            agoMin: 0,
            stages: [{ name: "Checkout", status: "IN_PROGRESS" as const, seconds: 2 }],
          },
        ]
      : []),
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

export function openShiftWorld(state: DemoState, phase: Phase): OpenShiftWorld {
  const s = state.shas;
  const now = phase.at[0];
  const failed = phase.index >= 1;
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
  const notReady = {
    phase: "Running",
    conditions: [
      {
        type: "Ready",
        status: "False",
        reason: "ContainersNotReady",
        message: "containers with unready status: [api]",
      },
    ],
  };

  // shop-dev: rolling out `metrics`. One pod is still pulling its image, and fails to once the world moves on.
  const devRs = deployment("shop-dev", "shop-api", s.metrics, 2, {
    replicas: 2,
    updatedReplicas: 1,
    readyReplicas: 1,
    availableReplicas: 1,
    unavailableReplicas: 1,
    conditions: failed
      ? [
          {
            type: "Progressing",
            status: "False",
            reason: "ProgressDeadlineExceeded",
            message: 'ReplicaSet "shop-api-7d9f8" has timed out progressing.',
          },
        ]
      : [{ type: "Progressing", status: "True", reason: "ReplicaSetUpdated" }],
  });
  pod("shop-dev", "shop-api-7d9f8-r2m4p", devRs, "shop-api", {
    ...ready,
    containerStatuses: [container(s.metrics, { ready: true, restartCount: 0, state: { running: {} } })],
  });
  pod("shop-dev", "shop-api-7d9f8-pull9", devRs, "shop-api", {
    ...notReady,
    phase: "Pending",
    containerStatuses: [
      container(s.metrics, {
        imageID: "",
        restartCount: 0,
        state: {
          waiting: failed
            ? { reason: "ImagePullBackOff", message: 'Back-off pulling image "shop-api:metrics"' }
            : { reason: "ContainerCreating" },
        },
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
  if (phase.index >= 2)
    add("shop-dev", "Build", {
      kind: "Build",
      metadata: { name: "shop-api-45", namespace: "shop-dev", uid: nextUid(), labels: { [COMMIT_KEY]: s.next } },
      spec: { output: { to: { kind: "ImageStreamTag", name: "shop-api:45" } } },
      status: { phase: "Running" },
    });
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
  pod("shop-test", "shop-api-7d9f8-ev1ct", testRs, "shop-api", {
    phase: "Failed",
    reason: "Evicted",
    message: "The node was low on resource: memory. Threshold quantity: 100Mi, available: 61Mi.",
  });
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
        event("Normal", "Scheduled", "Successfully assigned shop-dev/shop-api-7d9f8-pull9 to worker-1", 1, 2),
        event("Normal", "Pulling", 'Pulling image "shop-api:metrics"', failed ? 6 : 1, failed ? 1 : 0),
        ...(failed
          ? [
              event(
                "Warning",
                "Failed",
                'Failed to pull image "shop-api:metrics": manifest unknown: manifest unknown',
                6,
                1,
              ),
              event("Warning", "BackOff", 'Back-off pulling image "shop-api:metrics"', 20, 0),
            ]
          : []),
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

  // The crash-looping pod and the failed build; other pods and builds get a healthy log (fake-fetch.ts).
  const logs = new Map<string, string>([
    ["shop-test/shop-api-7d9f8-x2k4q", crashLoopLog(now - 2 * MIN, "shop-api-7d9f8-x2k4q", LONG_LINE)],
    ["shop-dev/shop-api-41", buildLog("shop-api-41", s.payments, true)],
  ]);

  // Every object carries the phase's resource version, so a watch picks up where its list left off.
  for (const byKind of lists.values())
    for (const items of byKind.values())
      for (const item of items) (item.metadata as Record<string, unknown>).resourceVersion = resourceVersion(phase);

  return { lists, events, logs };
}

export const resourceVersion = (phase: Phase) => String(1000 + phase.index);

/** Lines a followed Pod log keeps adding (requests as they come in), so the viewer drops its oldest ones. */
export function followLine(n: number): string {
  const routes = ["/cart", "/cart/lines", "/search?q=shoes", "/health/ready", "/checkout", "/metrics"];
  const slow = n % 50 === 0;
  const status = n % 37 === 0 ? 503 : 200;
  // Forty lines come at once, every 250 ms: a few milliseconds apart, like requests in a busy second.
  const at = new Date(Date.now() - (40 - (n % 40)) * 6);
  return `${at.toISOString().replace("Z", "+00:00")}  ${status === 200 && !slow ? "INFO" : "WARN"} 1 --- [shop-api] [nio-8080-exec-${(n % 10) + 1}] c.d.shop.web.RequestLog                  : ${n % 4 === 1 ? "POST" : "GET"} ${routes[n % routes.length]} ${status} ${slow ? 2400 + n : (n * 7) % 90}ms${slow ? " (PaymentGateway slow)" : ""}`;
}
