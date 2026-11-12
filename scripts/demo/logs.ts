/**
 * The demo's CI and cluster logs, as long and as noisy as real ones: GitHub Actions jobs (runner setup, checkout,
 * install, hundreds of tests, coverage, cleanup), Jenkins pipelines (git, Gradle, JUnit), Spring Boot pods and
 * OpenShift builds. Made with seeded randomness, so they come out the same every run.
 *
 * GitHub lines carry no timestamps here; the fake server adds them across the job's time.
 */
import { lineOf } from "./codebase";
import { seeded } from "./random";

const ESC = "\u001b";
const cyan = (text: string) => `${ESC}[36;1m${text}${ESC}[0m`;
const green = (text: string) => `${ESC}[0m${ESC}[32m${text}${ESC}[0m`;
const red = (text: string) => `${ESC}[0m${ESC}[31m${text}${ESC}[0m`;
const dim = (text: string) => `${ESC}[0m${ESC}[2m${text}${ESC}[0m`;

// ── GitHub Actions ───────────────────────────────────────────────────────────

/** A failing test as bun prints it: the source around the failing line, the error, the stack. */
export interface TestFailure {
  file: string;
  name: string;
  /** The test file's content, for the source excerpt bun shows. */
  source?: string;
  /** The text on the failing line. */
  at?: string;
  error: string[];
  /** The annotation bun writes for GitHub (its first line is what the app searches for). */
  annotation: string;
  ms: number;
}

export type GitHubJobKind = "build" | "test" | "lint" | "deploy" | "e2e" | "web-test";

export interface GitHubLogOptions {
  repo: string;
  sha: string;
  job: string;
  kind: GitHubJobKind;
  /** How far the job got: all done, cancelled or timed out partway, or still running. */
  outcome: "success" | "failure" | "cancelled" | "timed_out" | "running";
  failures?: TestFailure[];
  /** Extra output of the main step (a linter's findings). */
  lint?: string[];
  seed: string;
}

const TEST_FILES: [file: string, suite: string, subjects: string[]][] = [
  [
    "src/cart/cart.test.ts",
    "cart",
    ["an item", "a line", "the quantity", "an empty cart", "the subtotal", "a discount", "the total", "two discounts"],
  ],
  [
    "src/cart/discount.test.ts",
    "discount",
    ["a percentage", "a fixed amount", "both kinds", "cents", "a voucher", "a negative total", "half a cent"],
  ],
  ["src/cart/badge.test.ts", "badge", ["an empty cart", "one item", "99 items", "100 items", "a removed item"]],
  ["src/cart/price-cache.test.ts", "price cache", ["the same lines", "a new line", "a new discount", "a removed line"]],
  [
    "src/cart/routes.test.ts",
    "cart routes",
    ["GET /cart", "POST /cart/lines", "DELETE /cart/lines/:sku", "an unknown route", "a session header"],
  ],
  [
    "src/checkout/api.test.ts",
    "checkout",
    ["an empty cart", "a free cart", "a paid order", "a failed payment", "a reservation"],
  ],
  [
    "src/checkout/CheckoutPage.test.tsx",
    "checkout page",
    ["the total", "the pay button", "the paying state", "a failed payment", "the order summary"],
  ],
  ["src/checkout/OrderSummary.test.tsx", "order summary", ["each line", "the subtotal", "the total", "an empty cart"]],
  [
    "src/payments/gateway.test.ts",
    "gateway client",
    ["the order id", "the amount", "the currency", "the idempotency key", "a 4xx answer", "a 5xx answer", "a timeout"],
  ],
  [
    "src/search/index.test.ts",
    "search",
    ["one word", "every word", "no words", "an unknown word", "upper case", "punctuation"],
  ],
  ["src/search/ranking.test.ts", "ranking", ["popularity", "ties by name", "accents", "an empty list"]],
  ["src/search/highlight.test.ts", "highlight", ["one word", "two words", "no match", "regex characters"]],
  [
    "src/inventory/reservations.test.ts",
    "reservations",
    ["a reservation", "an expired reservation", "two orders", "a released order", "15 minutes"],
  ],
  [
    "src/pricing/price-lists.test.ts",
    "price lists",
    ["Germany", "France", "the Netherlands", "a missing SKU", "the fallback list"],
  ],
  ["src/pricing/currency.test.ts", "currency", ["euros", "Swiss francs", "Swedish kronor", "an unknown currency"]],
  ["src/i18n/index.test.ts", "i18n", ["English", "German", "French", "a missing key", "placeholders"]],
  ["src/theme/theme.test.ts", "theme", ["light", "dark", "the system setting", "a system change"]],
  ["src/api/health.test.ts", "health", ["liveness", "readiness before startup", "readiness after startup"]],
  ["src/api/metrics.test.ts", "metrics", ["request counts", "durations", "two routes", "the exporter header"]],
  ["src/a11y/announcer.test.ts", "announcer", ["a message", "the same message twice", "the live region"]],
  ["src/metrics/SalesDashboard.test.tsx", "sales dashboard", ["the chart", "the weekly total", "the CSV export"]],
];
const WEB_TEST_FILES: typeof TEST_FILES = [
  ["src/price.test.ts", "price", ["whole euros", "cents", "zero", "large amounts"]],
  ["src/Gallery.test.tsx", "gallery", ["the first image", "the next image", "the buttons", "one image"]],
  ["src/ProductPage.test.tsx", "product page", ["the name", "the price", "the gallery"]],
];
const VERBS = [
  "handles",
  "keeps",
  "returns",
  "rejects",
  "counts",
  "renders",
  "rounds",
  "sorts",
  "updates",
  "ignores",
  "reads",
  "accepts",
];

interface TestRun {
  lines: string[];
  pass: number;
  fail: number;
  files: number;
  expects: number;
  seconds: number;
}

/** bun test's output: every file, every test, failures with their source and stack, then the summary. */
function bunTestRun(options: {
  seed: string;
  failures: TestFailure[];
  stopAfter?: number;
  files?: typeof TEST_FILES;
}): TestRun {
  const testFiles = options.files ?? TEST_FILES;
  const random = seeded(options.seed);
  const lines = [`bun test ${dim("v1.1.42 (50eec002)")}`, ""];
  let pass = 0;
  let files = 0;
  const failedNames: string[] = [];
  const byFile = new Map<string, TestFailure[]>();
  for (const failure of options.failures) byFile.set(failure.file, [...(byFile.get(failure.file) ?? []), failure]);
  const allFiles = [...testFiles.map(([file]) => file)];
  for (const file of byFile.keys()) if (!allFiles.includes(file)) allFiles.push(file);
  for (const file of allFiles) {
    if (options.stopAfter !== undefined && files >= options.stopAfter) break;
    files++;
    lines.push(`${file}:`);
    const known = testFiles.find(([name]) => name === file);
    const suite =
      known?.[1] ??
      file
        .split("/")
        .pop()
        ?.replace(/\.test\.tsx?$/, "") ??
      "suite";
    const subjects = known?.[2] ?? ["the first case", "the second case", "the third case"];
    for (const subject of subjects) {
      const count = random.int(1, 3);
      for (let i = 0; i < count; i++) {
        pass++;
        lines.push(
          `${green("(pass)")} ${suite} > ${random.pick(VERBS)} ${subject}${i ? ` (${i + 1})` : ""} ${dim(`[${(random.next() * 4).toFixed(2)}ms]`)}`,
        );
      }
    }
    for (const failure of byFile.get(file) ?? []) {
      if (failure.source && failure.at) {
        const at = lineOf(failure.source, failure.at);
        const sourceLines = failure.source.split("\n");
        for (let n = Math.max(1, at - 4); n <= at; n++)
          lines.push(`${String(n).padStart(3)} | ${sourceLines[n - 1] ?? ""}`);
        lines.push(`${" ".repeat(6 + (sourceLines[at - 1] ?? "").indexOf(failure.at))}^`);
      }
      lines.push(...failure.error.map(text => (text.startsWith("error:") ? red(text) : text)));
      lines.push(`##[error]${failure.annotation}`);
      lines.push(`${red("(fail)")} ${failure.name} ${dim(`[${failure.ms.toFixed(2)}ms]`)}`);
      failedNames.push(`${failure.name} [${failure.ms.toFixed(2)}ms]`);
    }
    lines.push("");
  }
  const fail = failedNames.length;
  const expects = Math.round(pass * 2.4);
  const seconds = 6 + random.next() * 4;
  if (options.stopAfter === undefined) {
    if (fail > 0) lines.push(`${fail} tests failed:`, ...failedNames.map(name => `${red("(fail)")} ${name}`), "");
    lines.push(
      ` ${pass} pass`,
      ` ${fail} fail`,
      ` ${expects} expect() calls`,
      `Ran ${pass + fail} tests across ${files} files. [${seconds.toFixed(2)}s]`,
    );
  }
  return { lines, pass, fail, files, expects, seconds };
}

/** bun's coverage table, printed after the tests. */
function coverageTable(seed: string): string[] {
  const random = seeded(`${seed}-coverage`);
  const rows = TEST_FILES.map(([file]) => file.replace(/\.test(\.tsx?)$/, "$1"));
  const width = Math.max(...rows.map(row => row.length)) + 2;
  const rule = `${"-".repeat(width)}|---------|---------|-------------------`;
  const out = [rule, `${"File".padEnd(width)}| % Funcs | % Lines | Uncovered Line #s`, rule];
  out.push(`${"All files".padEnd(width)}|   87.41 |   91.02 |`);
  for (const file of rows) {
    const funcs = (70 + random.next() * 30).toFixed(2);
    const lines = (75 + random.next() * 25).toFixed(2);
    const uncovered = random.next() < 0.6 ? `${random.int(5, 40)}-${random.int(41, 80)}` : "";
    out.push(` ${file.padEnd(width - 1)}| ${funcs.padStart(7)} | ${lines.padStart(7)} | ${uncovered}`);
  }
  out.push(rule);
  return out;
}

function setUpJob(job: string, actions: [string, string][]): string[] {
  return [
    "Current runner version: '2.321.0'",
    "##[group]Operating System",
    "Ubuntu",
    "24.04.1",
    "LTS",
    "##[endgroup]",
    "##[group]Runner Image",
    "Image: ubuntu-24.04",
    "Version: 20250105.1.0",
    "Included Software: https://github.com/actions/runner-images/blob/ubuntu24/20250105.1/images/ubuntu/Ubuntu2404-Readme.md",
    "Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20250105.1",
    "##[endgroup]",
    "##[group]Runner Image Provisioner",
    "2.0.384.1",
    "##[endgroup]",
    "##[group]GITHUB_TOKEN Permissions",
    "Contents: read",
    "Metadata: read",
    "Packages: read",
    "##[endgroup]",
    "Secret source: Actions",
    "Prepare workflow directory",
    "Prepare all required actions",
    "Getting action download info",
    ...actions.map(([name, sha]) => `Download action repository '${name}' (SHA:${sha})`),
    `Complete job name: ${job}`,
  ];
}

function checkout(repo: string, sha: string): string[] {
  const workspace = `/home/runner/work/${repo.split("/")[1]}/${repo.split("/")[1]}`;
  return [
    "##[group]Run actions/checkout@v4",
    "with:",
    `  repository: ${repo}`,
    "  token: ***",
    "  ssh-strict: true",
    "  ssh-user: git",
    "  persist-credentials: true",
    "  clean: true",
    "  sparse-checkout-cone-mode: true",
    "  fetch-depth: 1",
    "  fetch-tags: false",
    "  show-progress: true",
    "  lfs: false",
    "  submodules: false",
    "  set-safe-directory: true",
    "##[endgroup]",
    `Syncing repository: ${repo}`,
    "##[group]Getting Git version info",
    `Working directory is '${workspace}'`,
    "[command]/usr/bin/git version",
    "git version 2.47.1",
    "##[endgroup]",
    "Temporarily overriding HOME='/home/runner/work/_temp/5b1e0a4c-0f0e-4d43-9c5e-6f2b1d9c1a7e' before making global git config changes",
    "Adding repository directory to the temporary git global config as a safe directory",
    `[command]/usr/bin/git config --global --add safe.directory ${workspace}`,
    `Deleting the contents of '${workspace}'`,
    "##[group]Initializing the repository",
    `[command]/usr/bin/git init ${workspace}`,
    "hint: Using 'master' as the name for the initial branch. This default branch name",
    "hint: is subject to change. To configure the initial branch name to use in all",
    "hint: of your new repositories, which will suppress this warning, call:",
    "hint:",
    "hint: \tgit config --global init.defaultBranch <name>",
    `Initialized empty Git repository in ${workspace}/.git/`,
    `[command]/usr/bin/git remote add origin https://github.com/${repo}`,
    "##[endgroup]",
    "##[group]Disabling automatic garbage collection",
    "[command]/usr/bin/git config --local gc.auto 0",
    "##[endgroup]",
    "##[group]Setting up auth",
    "[command]/usr/bin/git config --local --name-only --get-regexp core\\.sshCommand",
    "[command]/usr/bin/git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***",
    "##[endgroup]",
    "##[group]Fetching the repository",
    `[command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +${sha}:refs/remotes/origin/main`,
    "remote: Enumerating objects: 214, done.        ",
    "remote: Counting objects: 100% (214/214), done.        ",
    "remote: Compressing objects: 100% (168/168), done.        ",
    "remote: Total 214 (delta 31), reused 112 (delta 12), pack-reused 0 (from 0)        ",
    `From https://github.com/${repo}`,
    ` * [new ref]         ${sha} -> origin/main`,
    "##[endgroup]",
    "##[group]Determining the checkout info",
    "##[endgroup]",
    "[command]/usr/bin/git sparse-checkout disable",
    "[command]/usr/bin/git config --local --unset-all extensions.worktreeConfig",
    "##[group]Checking out the ref",
    "[command]/usr/bin/git checkout --progress --force -B main refs/remotes/origin/main",
    "Switched to a new branch 'main'",
    "branch 'main' set up to track 'origin/main'.",
    "##[endgroup]",
    "[command]/usr/bin/git log -1 --format=%H",
    sha,
  ];
}

const run = (command: string, extra: string[] = []) => [
  `##[group]Run ${command.split("\n")[0]}`,
  ...command.split("\n").map(cyan),
  "shell: /usr/bin/bash -e {0}",
  ...extra,
  "##[endgroup]",
];

function install(seed: string): string[] {
  const random = seeded(`${seed}-install`);
  const packages = [
    "@types/bun@1.1.14",
    "axios@1.6.0",
    "express@4.19.2",
    "jest@29.7.0",
    "jsonwebtoken@8.5.1",
    "lodash@4.17.20",
    "mkdirp@0.5.5",
    "react@18.3.1",
    "react-dom@18.3.1",
    "typescript@5.4.5",
    "typescript-eslint@8.18.1",
    "eslint@9.17.0",
    "@eslint/js@9.17.0",
  ];
  return [
    "##[group]Run oven-sh/setup-bun@v2",
    "with:",
    "  bun-version: latest",
    "  no-cache: false",
    "##[endgroup]",
    "Downloading a new version of Bun: https://github.com/oven-sh/bun/releases/download/bun-v1.1.42/bun-linux-x64.zip",
    "[command]/usr/bin/unzip -o -q /home/runner/work/_temp/7a1f3c90-2c55-4b6d-9a49-8a9f2f0f0b51.zip",
    "[command]/home/runner/.bun/bin/bun --revision",
    "1.1.42+50eec0025",
    ...run("bun install --frozen-lockfile"),
    `bun install ${dim("v1.1.42 (50eec002)")}`,
    "",
    ...packages.map(pkg => `${green("+")} ${pkg}`),
    "",
    `${random.int(280, 340)} packages installed ${dim(`[${(1 + random.next() * 3).toFixed(2)}s]`)}`,
  ];
}

function cleanup(repo: string): string[] {
  const workspace = `/home/runner/work/${repo.split("/")[1]}/${repo.split("/")[1]}`;
  return [
    "Post job cleanup.",
    "[command]/usr/bin/git version",
    "git version 2.47.1",
    "Temporarily overriding HOME='/home/runner/work/_temp/0c6a1f0e-8d1e-4a6f-b0f1-2b9b7d5c3e21' before making global git config changes",
    "Adding repository directory to the temporary git global config as a safe directory",
    `[command]/usr/bin/git config --global --add safe.directory ${workspace}`,
    "[command]/usr/bin/git config --local --name-only --get-regexp core\\.sshCommand",
    "[command]/usr/bin/git submodule foreach --recursive sh -c \"git config --local --name-only --get-regexp 'core\\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :\"",
    "[command]/usr/bin/git config --local --name-only --get-regexp http\\.https\\:\\/\\/github\\.com\\/\\.extraheader",
    "http.https://github.com/.extraheader",
    "[command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader",
    "Cleaning up orphan processes",
  ];
}

const ACTIONS: [string, string][] = [
  ["actions/checkout@v4", "11bd71901bbe5b1630ceea73d27597364c9af683"],
  ["oven-sh/setup-bun@v2", "4bc047ad259df6fc24a6c9b0f9a0cb08cf17fbe5"],
];

/** A GitHub Actions job log, from runner setup to cleanup, cut where the job stopped. */
export function githubJobLog(options: GitHubLogOptions): string {
  const lines = [
    ...setUpJob(options.job, options.kind === "deploy" ? [ACTIONS[0]] : ACTIONS),
    ...checkout(options.repo, options.sha),
  ];
  const stopped = options.outcome === "cancelled" || options.outcome === "timed_out" || options.outcome === "running";
  const failed = options.outcome === "failure";
  const end = (code: number) => [`##[error]Process completed with exit code ${code}.`];
  switch (options.kind) {
    case "build": {
      lines.push(...install(options.seed));
      lines.push(...run("bun run build"));
      lines.push("$ tsc -p tsconfig.json --noEmit && bun build src/index.ts --outdir dist --target bun --minify");
      const random = seeded(`${options.seed}-build`);
      lines.push(
        "",
        `  ./index.js  ${(380 + random.next() * 60).toFixed(2)} KB`,
        "",
        `[${random.int(40, 90)}ms] bundle ${random.int(180, 240)} modules`,
      );
      break;
    }
    case "test":
    case "web-test": {
      lines.push(...install(options.seed));
      lines.push(...run("bun run lint && bun test --coverage"));
      lines.push("$ eslint .", ...(options.lint ?? []), "");
      const files = options.kind === "web-test" ? WEB_TEST_FILES : TEST_FILES;
      const tests = bunTestRun({
        seed: options.seed,
        failures: options.failures ?? [],
        stopAfter: stopped ? Math.floor(files.length / 2) : undefined,
        files,
      });
      lines.push(...tests.lines);
      if (!stopped && options.kind === "test") lines.push("", ...coverageTable(options.seed));
      if (!stopped && tests.fail > 0) lines.push(...end(1));
      break;
    }
    case "lint": {
      lines.push(...install(options.seed));
      lines.push(...run("bun run lint && bun run typecheck"));
      lines.push("$ eslint .", ...(options.lint ?? []), "", "$ tsc --noEmit");
      for (const failure of options.failures ?? []) lines.push(...failure.error, `##[error]${failure.annotation}`);
      if (failed) lines.push(...end(2));
      break;
    }
    case "deploy": {
      lines.push(
        ...run(
          "oc login --token=*** --server=https://api.demo.invalid:6443\noc apply -f deploy/openshift/ -n shop-prod\noc rollout status deployment/shop-api -n shop-prod --timeout=5m",
        ),
      );
      lines.push(
        'Logged into "https://api.demo.invalid:6443" as "system:serviceaccount:shop-prod:deployer" using the token provided.',
        "",
        'You have one project on this server: "shop-prod"',
        "",
        'Using project "shop-prod".',
        "deployment.apps/shop-api configured",
        "service/shop-api unchanged",
        "route.route.openshift.io/shop-api unchanged",
        "configmap/shop-api-config unchanged",
        "horizontalpodautoscaler.autoscaling/shop-api unchanged",
      );
      if (!stopped)
        lines.push(
          'Waiting for deployment "shop-api" rollout to finish: 1 out of 2 new replicas have been updated...',
          'Waiting for deployment "shop-api" rollout to finish: 1 out of 2 new replicas have been updated...',
          'Waiting for deployment "shop-api" rollout to finish: 1 old replicas are pending termination...',
          'deployment "shop-api" successfully rolled out',
        );
      else lines.push('Waiting for deployment "shop-api" rollout to finish: 0 of 2 updated replicas are available...');
      break;
    }
    case "e2e": {
      lines.push(...install(options.seed));
      lines.push(...run("bunx playwright test --reporter=line"));
      const random = seeded(`${options.seed}-e2e`);
      lines.push("", "Running 64 tests using 2 workers", "");
      for (let n = 1; n <= 41; n++) {
        const spec = random.pick(["cart", "checkout", "search", "account", "payments"]);
        lines.push(
          `[${n}/64] [chromium] › e2e/${spec}.spec.ts:${random.int(8, 120)}:5 › ${spec} › ${random.pick(VERBS)} ${random.pick(["the page", "a product", "the form", "an order", "the total"])}`,
        );
      }
      lines.push("[42/64] [chromium] › e2e/payments.spec.ts:88:5 › payments › retries a slow gateway");
      break;
    }
  }
  if (options.outcome === "cancelled") lines.push("##[error]The operation was canceled.");
  else if (options.outcome === "timed_out")
    lines.push(
      "##[error]The job running on runner GitHub Actions 7 has exceeded the maximum execution time of 60 minutes.",
      "##[error]The operation was canceled.",
    );
  if (options.outcome !== "running") lines.push(...cleanup(options.repo));
  return `﻿${lines.join("\n")}\n`;
}

// ── Jenkins ──────────────────────────────────────────────────────────────────

/** A failing JUnit test as Gradle prints it. */
export interface JavaFailure {
  className: string;
  method: string;
  error: string;
  /** The test's own frame. */
  line: number;
}

export interface JenkinsStageLog {
  name: string;
  /** How long the stage took; Gradle reports the same. */
  seconds: number;
  kind: "checkout" | "build" | "test" | "publish" | "checks" | "aborted";
  /** `skipped`: not run because an earlier stage failed. `running`: the log stops inside it. */
  state: "done" | "failed" | "skipped" | "running";
  failures?: JavaFailure[];
  tests?: { total: number; skipped: number };
}

export interface JenkinsLogOptions {
  job: string;
  branch: string;
  sha: string;
  subject: string;
  stages: JenkinsStageLog[];
  result: "SUCCESS" | "FAILURE" | "ABORTED" | "UNSTABLE" | null;
  seed: string;
  abortedBy?: string;
}

const JUNIT_FRAMES = [
  "at app//org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)",
  "at app//org.junit.jupiter.api.AssertionFailureBuilder.buildAndThrow(AssertionFailureBuilder.java:132)",
  "at app//org.junit.jupiter.api.AssertEquals.failNotEqual(AssertEquals.java:197)",
  "at app//org.junit.jupiter.api.AssertEquals.assertEquals(AssertEquals.java:150)",
  "at app//org.junit.jupiter.api.Assertions.assertEquals(Assertions.java:563)",
];

const JAVA_CLASSES = [
  "Cart",
  "Discount",
  "PaymentService",
  "RetryPolicy",
  "Gateway",
  "Checkout",
  "Inventory",
  "PriceList",
  "Currency",
  "Search",
  "Ranking",
  "Health",
  "Metrics",
  "OrderSummary",
  "Reservation",
];
const JAVA_METHODS = [
  "addsAnItem",
  "removesALine",
  "roundsToCents",
  "keepsTheQuantity",
  "rejectsAnEmptyCart",
  "readsTheTotal",
  "retriesA503",
  "keepsTheIdempotencyKey",
  "sortsByPopularity",
  "releasesAfter15Minutes",
  "returnsUp",
  "countsRequests",
  "formatsEuros",
  "fallsBackToGermany",
  "ignoresAccents",
];

/** Gradle's test output with every test listed, the failures with their stack. */
const gradleTime = (seconds: number) =>
  seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.max(1, (seconds % 60) - 2)}s` : `${Math.max(1, seconds - 2)}s`;

function gradleTests(
  seconds: number,
  seed: string,
  failures: JavaFailure[],
  tests: { total: number; skipped: number },
  /** Failing tests fail the build (otherwise `ignoreFailures`: the build goes on, JUnit makes it unstable). */
  failBuild = true,
): string[] {
  const random = seeded(`${seed}-junit`);
  const out = [
    "+ ./gradlew test --no-daemon --console=plain",
    "> Task :compileJava UP-TO-DATE",
    "> Task :processResources UP-TO-DATE",
    "> Task :classes UP-TO-DATE",
    "> Task :compileTestJava",
    "> Task :processTestResources",
    "> Task :testClasses",
    "",
    "> Task :test",
    "",
  ];
  const failing = new Set(failures.map(f => `${f.className}.${f.method}`));
  const passing = tests.total - failures.length - tests.skipped;
  for (let i = 0; i < passing; i++) {
    const cls = random.pick(JAVA_CLASSES);
    out.push(
      `${cls}Test > ${random.pick(JAVA_METHODS)}${i % 7 === 0 ? `With${random.pick(JAVA_CLASSES)}` : ""}() PASSED`,
    );
  }
  for (let i = 0; i < tests.skipped; i++)
    out.push(`${random.pick(JAVA_CLASSES)}IntegrationTest > ${random.pick(JAVA_METHODS)}() SKIPPED`);
  for (const failure of failures) {
    const simple = failure.className.split(".").pop();
    out.push(
      "",
      `${simple} > ${failure.method}() FAILED`,
      `    ${failure.error}`,
      ...(failure.error.startsWith("org.opentest4j") ? JUNIT_FRAMES.map(frame => `        ${frame}`) : []),
      `        at app//${failure.className}.${failure.method}(${simple}.java:${failure.line})`,
    );
  }
  out.push("", `${tests.total} tests completed, ${failures.length} failed, ${tests.skipped} skipped`, "");
  if (failing.size > 0 && failBuild)
    out.push(
      "> Task :test FAILED",
      "",
      "FAILURE: Build failed with an exception.",
      "",
      "* What went wrong:",
      "Execution failed for task ':test'.",
      "> There were failing tests. See the report at: file:///var/lib/jenkins/workspace/shop/build/reports/tests/test/index.html",
      "",
      "* Try:",
      "> Run with --scan to get full insights.",
      "",
      `BUILD FAILED in ${gradleTime(seconds)}`,
      "5 actionable tasks: 3 executed, 2 up-to-date",
    );
  else out.push(`BUILD SUCCESSFUL in ${gradleTime(seconds)}`, "5 actionable tasks: 3 executed, 2 up-to-date");
  return out;
}

function stageBody(stage: JenkinsStageLog, options: JenkinsLogOptions): string[] {
  const workspace = `/var/lib/jenkins/workspace/${options.job.replace("/", "_")}`;
  const random = seeded(`${options.seed}-${stage.name}`);
  switch (stage.kind) {
    case "checkout":
      return [
        "[Pipeline] checkout",
        "The recommended git tool is: git",
        "using credential github-app-demo",
        ` > git rev-parse --resolve-git-dir ${workspace}/.git # timeout=10`,
        "Fetching changes from the remote Git repository",
        " > git config remote.origin.url https://github.com/demo/shop.git # timeout=10",
        "Fetching upstream changes from https://github.com/demo/shop.git",
        " > git --version # timeout=10",
        " > git --version # 'git version 2.43.0'",
        "using GIT_ASKPASS to set credentials GitHub App for demo",
        ` > git fetch --tags --force --progress -- https://github.com/demo/shop.git +refs/heads/${options.branch}:refs/remotes/origin/${options.branch} # timeout=10`,
        `Checking out Revision ${options.sha} (${options.branch})`,
        " > git config core.sparsecheckout # timeout=10",
        ` > git checkout -f ${options.sha} # timeout=10`,
        `Commit message: "${options.subject}"`,
      ];
    case "build":
      return [
        "[Pipeline] sh",
        "+ ./gradlew assemble --no-daemon --console=plain",
        "To honour the JVM settings for this build a single-use Daemon process will be forked. For more on this, please refer to https://docs.gradle.org/8.10.2/userguide/gradle_daemon.html#sec:disabling_the_daemon in the Gradle documentation.",
        "Daemon will be stopped at the end of the build",
        "> Task :compileJava",
        ...(stage.state === "running"
          ? []
          : [
              "> Task :processResources",
              "> Task :classes",
              "> Task :resolveMainClassName",
              "> Task :bootJar",
              "> Task :jar",
              "> Task :assemble",
              "",
              `BUILD SUCCESSFUL in ${gradleTime(stage.seconds)}`,
              "6 actionable tasks: 6 executed",
            ]),
      ];
    case "aborted":
      return [
        "[Pipeline] sh",
        "+ ./gradlew assemble --no-daemon --console=plain",
        "> Task :compileJava",
        "Sending interrupt signal to process",
        "Terminated",
        "script returned exit code 143",
      ];
    case "test":
      return [
        "[Pipeline] sh",
        ...gradleTests(
          stage.seconds,
          options.seed,
          stage.failures ?? [],
          stage.tests ?? { total: 1207, skipped: 12 },
          stage.state === "failed",
        ),
      ];
    case "publish":
      return [
        "[Pipeline] sh",
        `+ podman build -t image-registry.openshift-image-registry.svc:5000/shop/shop-api:${options.sha.slice(0, 7)} .`,
        "STEP 1/9: FROM node:20-alpine AS build",
        "STEP 2/9: WORKDIR /app",
        "--> Using cache 3b1f0d2a9c84",
        "STEP 3/9: COPY package.json package-lock.json ./",
        "--> 9f2e1c7b8a10",
        "STEP 4/9: RUN npm ci",
        `added ${random.int(280, 340)} packages in ${random.int(8, 20)}s`,
        "STEP 5/9: COPY . .",
        "STEP 6/9: RUN npm run build",
        "STEP 7/9: FROM node:20-alpine",
        "STEP 8/9: COPY --from=build /app/dist ./dist",
        'STEP 9/9: CMD ["node", "dist/index.js"]',
        `COMMIT image-registry.openshift-image-registry.svc:5000/shop/shop-api:${options.sha.slice(0, 7)}`,
        `+ podman push image-registry.openshift-image-registry.svc:5000/shop/shop-api:${options.sha.slice(0, 7)}`,
        "Copying blob sha256:4f4fb700ef54461cfa02571ae0db9a0dc1e0cdb5577484a6d75e68dc38e8acc1",
        "Copying config sha256:b1d3e1f9a2c45e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
        "Writing manifest to image destination",
      ];
    case "checks":
      return [];
  }
}

/** A Jenkins pipeline console: one `[Pipeline] { (Stage)` block per stage, parallel branches, post actions. */
export function jenkinsConsole(options: JenkinsLogOptions): string {
  const workspace = `/var/lib/jenkins/workspace/${options.job.replace("/", "_")}`;
  const out = [
    options.abortedBy ? "Started by an SCM change" : "Started by an SCM change",
    "Obtained Jenkinsfile from git https://github.com/demo/shop.git",
    "[Pipeline] Start of Pipeline",
    "[Pipeline] node",
    `Running on agent-linux-0${(options.branch.length % 4) + 1} in ${workspace}`,
    "[Pipeline] {",
    "[Pipeline] withEnv",
    "[Pipeline] {",
  ];
  let running = false;
  for (const stage of options.stages) {
    out.push("[Pipeline] stage", `[Pipeline] { (${stage.name})`);
    if (stage.state === "skipped") {
      out.push(
        `Stage "${stage.name}" skipped due to earlier failure(s)`,
        "[Pipeline] getContext",
        "[Pipeline] }",
        "[Pipeline] // stage",
      );
      continue;
    }
    if (stage.kind === "checks") {
      out.push("[Pipeline] parallel");
      for (const branch of ["Unit tests", "Integration tests", "Lint"]) {
        out.push(`[Pipeline] { (Branch: ${branch})`, "[Pipeline] stage", `[Pipeline] { (${branch})`);
        if (branch === "Lint")
          out.push(
            "[Pipeline] sh",
            "+ ./gradlew spotlessCheck checkstyleMain --no-daemon --console=plain",
            "> Task :spotlessJavaCheck",
            "> Task :checkstyleMain",
            "BUILD SUCCESSFUL in 41s",
          );
        else
          out.push(
            ...gradleTests(Math.round(stage.seconds * 0.8), `${options.seed}-${branch}`, [], {
              total: branch === "Unit tests" ? 1207 : 86,
              skipped: branch === "Unit tests" ? 12 : 0,
            }),
          );
        out.push("[Pipeline] }", "[Pipeline] // stage", "[Pipeline] }");
      }
      out.push("[Pipeline] // parallel", "[Pipeline] }", "[Pipeline] // stage");
      continue;
    }
    out.push(...stageBody(stage, options));
    if (stage.state === "running") {
      running = true;
      break;
    }
    if (stage.state === "failed" && stage.kind !== "aborted")
      out.push("[Pipeline] }", "ERROR: script returned exit code 1", "[Pipeline] // stage");
    else out.push("[Pipeline] }", "[Pipeline] // stage");
  }
  if (running || options.result === null) return `${out.join("\n")}\n`;
  const hasTests = options.stages.some(stage => stage.kind === "test" || stage.kind === "checks");
  out.push(
    "[Pipeline] stage",
    "[Pipeline] { (Declarative: Post Actions)",
    ...(hasTests
      ? ["[Pipeline] junit", "Recording test results", "[Checks API] No suitable checks publisher found."]
      : []),
    ...(options.result === "UNSTABLE"
      ? ["Build step 'Publish JUnit test result report' changed build result to UNSTABLE"]
      : []),
    "[Pipeline] cleanWs",
    "[WS-CLEANUP] Deleting project workspace...",
    "[WS-CLEANUP] Deferred wipeout is used...",
    "[WS-CLEANUP] done",
    "[Pipeline] }",
    "[Pipeline] // stage",
    "[Pipeline] }",
    "[Pipeline] // withEnv",
    "[Pipeline] }",
    "[Pipeline] // node",
    "[Pipeline] End of Pipeline",
  );
  if (options.result === "ABORTED") out.push(`Aborted by ${options.abortedBy ?? "admin"}`, "Finished: ABORTED");
  else if (options.result === "FAILURE") out.push("ERROR: script returned exit code 1", "Finished: FAILURE");
  else out.push(`Finished: ${options.result}`);
  return `${out.join("\n")}\n`;
}

// ── OpenShift ────────────────────────────────────────────────────────────────

const stamp = (base: number, offsetMs: number) => new Date(base + offsetMs).toISOString().replace("Z", "+00:00");

/** A Spring Boot service starting up, as the pod logs it. */
function springBoot(base: number, pod: string, seed: string): string[] {
  const random = seeded(seed);
  let t = 0;
  const log = (level: string, thread: string, logger: string, message: string) => {
    t += random.int(5, 400);
    return `${stamp(base, t)}  ${level.padStart(5)} 1 --- [shop-api] [${thread.padStart(15)}] ${logger.padEnd(40)} : ${message}`;
  };
  return [
    "",
    "  .   ____          _            __ _ _",
    " /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\",
    "( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\",
    " \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )",
    "  '  |____| .__|_| |_|_| |_\\__, | / / / /",
    " =========|_|==============|___/=/_/_/_/",
    "",
    " :: Spring Boot ::                (v3.3.5)",
    "",
    log(
      "INFO",
      "main",
      "c.d.shop.ShopApiApplication",
      `Starting ShopApiApplication v0.42.0 using Java 21.0.5 with PID 1 (/deployments/shop-api.jar started by 1000750000 in /deployments)`,
    ),
    log("INFO", "main", "c.d.shop.ShopApiApplication", 'The following 1 profile is active: "openshift"'),
    log(
      "INFO",
      "main",
      ".s.d.r.c.RepositoryConfigurationDelegate",
      "Bootstrapping Spring Data JPA repositories in DEFAULT mode.",
    ),
    log(
      "INFO",
      "main",
      ".s.d.r.c.RepositoryConfigurationDelegate",
      "Finished Spring Data repository scanning in 112 ms. Found 6 JPA repository interfaces.",
    ),
    log("INFO", "main", "o.s.b.w.embedded.tomcat.TomcatWebServer", "Tomcat initialized with port 8080 (http)"),
    log("INFO", "main", "o.apache.catalina.core.StandardService", "Starting service [Tomcat]"),
    log("INFO", "main", "o.apache.catalina.core.StandardEngine", "Starting Servlet engine: [Apache Tomcat/10.1.31]"),
    log("INFO", "main", "o.a.c.c.C.[Tomcat].[localhost].[/]", "Initializing Spring embedded WebApplicationContext"),
    log(
      "INFO",
      "main",
      "w.s.c.ServletWebServerApplicationContext",
      `Root WebApplicationContext: initialization completed in ${random.int(900, 1600)} ms`,
    ),
    log("INFO", "main", "com.zaxxer.hikari.HikariDataSource", "HikariPool-1 - Starting..."),
    log(
      "INFO",
      "main",
      "com.zaxxer.hikari.pool.HikariPool",
      "HikariPool-1 - Added connection org.postgresql.jdbc.PgConnection@6b3e12f2",
    ),
    log("INFO", "main", "com.zaxxer.hikari.HikariDataSource", "HikariPool-1 - Start completed."),
    log(
      "INFO",
      "main",
      "o.hibernate.jpa.internal.util.LogHelper",
      "HHH000204: Processing PersistenceUnitInfo [name: default]",
    ),
    log("INFO", "main", "org.hibernate.Version", "HHH000412: Hibernate ORM core version 6.5.3.Final"),
    log(
      "INFO",
      "main",
      "o.h.e.t.j.p.i.JtaPlatformInitiator",
      "HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)",
    ),
    log(
      "INFO",
      "main",
      "j.LocalContainerEntityManagerFactoryBean",
      "Initialized JPA EntityManagerFactory for persistence unit 'default'",
    ),
    log(
      "WARN",
      "main",
      "JpaBaseConfiguration$JpaWebConfiguration",
      "spring.jpa.open-in-view is enabled by default. Therefore, database queries may be performed during view rendering. Explicitly configure spring.jpa.open-in-view to disable this warning",
    ),
    log("INFO", "main", "o.s.b.a.e.web.EndpointLinksResolver", "Exposing 3 endpoints beneath base path '/actuator'"),
    log(
      "INFO",
      "main",
      "c.d.shop.payments.GatewayClient",
      "Payment gateway: https://payments.internal.example/v2 (timeout 30000 ms, 3 attempts)",
    ),
    log("INFO", "main", "c.d.shop.search.SearchIndex", `Indexed 6000 products in ${random.int(30, 60)} ms`),
    log(
      "INFO",
      "main",
      "o.s.b.w.embedded.tomcat.TomcatWebServer",
      "Tomcat started on port 8080 (http) with context path '/'",
    ),
    `${pod} ready`,
  ];
}

const SPRING = (frame: string, jar = "spring-beans-6.1.14.jar!/:6.1.14") => `\tat ${frame} ~[${jar}]`;
const BOOT = "spring-boot-3.3.5.jar!/:3.3.5";
const CONTEXT = "spring-context-6.1.14.jar!/:6.1.14";

/** The crash-looping pod: startup, then the gateway refuses and the app dies with a long cause chain. */
export function crashLoopLog(base: number, pod: string, longLine: string): string {
  return [
    ...springBoot(base, pod, `${pod}-boot`).slice(0, -2),
    `${stamp(base, 9000)} ERROR 1 --- [shop-api] [           main] o.s.boot.SpringApplication               : Application run failed: ${longLine}`,
    "",
    "org.springframework.beans.factory.UnsatisfiedDependencyException: Error creating bean with name 'checkoutController' defined in URL [jar:nested:/deployments/shop-api.jar/!BOOT-INF/classes/!/com/demo/shop/checkout/CheckoutController.class]: Unsatisfied dependency expressed through constructor parameter 0: Error creating bean with name 'paymentGatewayClient': Failed to instantiate [com.demo.shop.payments.GatewayClient]: Constructor threw exception",
    SPRING(
      "org.springframework.beans.factory.support.ConstructorResolver.createArgumentArray(ConstructorResolver.java:795)",
    ),
    SPRING(
      "org.springframework.beans.factory.support.ConstructorResolver.autowireConstructor(ConstructorResolver.java:237)",
    ),
    SPRING(
      "org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory.autowireConstructor(AbstractAutowireCapableBeanFactory.java:1375)",
    ),
    SPRING(
      "org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory.createBeanInstance(AbstractAutowireCapableBeanFactory.java:1212)",
    ),
    SPRING(
      "org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory.doCreateBean(AbstractAutowireCapableBeanFactory.java:562)",
    ),
    SPRING(
      "org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory.createBean(AbstractAutowireCapableBeanFactory.java:522)",
    ),
    SPRING(
      "org.springframework.beans.factory.support.AbstractBeanFactory.lambda$doGetBean$0(AbstractBeanFactory.java:337)",
    ),
    SPRING(
      "org.springframework.beans.factory.support.DefaultSingletonBeanRegistry.getSingleton(DefaultSingletonBeanRegistry.java:234)",
    ),
    SPRING("org.springframework.beans.factory.support.AbstractBeanFactory.doGetBean(AbstractBeanFactory.java:335)"),
    SPRING("org.springframework.beans.factory.support.AbstractBeanFactory.getBean(AbstractBeanFactory.java:200)"),
    SPRING(
      "org.springframework.beans.factory.support.DefaultListableBeanFactory.preInstantiateSingletons(DefaultListableBeanFactory.java:975)",
    ),
    SPRING(
      "org.springframework.context.support.AbstractApplicationContext.finishBeanFactoryInitialization(AbstractApplicationContext.java:971)",
      CONTEXT,
    ),
    SPRING(
      "org.springframework.context.support.AbstractApplicationContext.refresh(AbstractApplicationContext.java:625)",
      CONTEXT,
    ),
    SPRING(
      "org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext.refresh(ServletWebServerApplicationContext.java:146)",
      BOOT,
    ),
    SPRING("org.springframework.boot.SpringApplication.refresh(SpringApplication.java:754)", BOOT),
    SPRING("org.springframework.boot.SpringApplication.refreshContext(SpringApplication.java:456)", BOOT),
    SPRING("org.springframework.boot.SpringApplication.run(SpringApplication.java:335)", BOOT),
    SPRING("org.springframework.boot.SpringApplication.run(SpringApplication.java:1363)", BOOT),
    SPRING("org.springframework.boot.SpringApplication.run(SpringApplication.java:1352)", BOOT),
    SPRING("com.demo.shop.ShopApiApplication.main(ShopApiApplication.java:12)", "!/:0.42.0"),
    SPRING(
      "java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)",
      "na:na",
    ),
    SPRING("java.base/java.lang.reflect.Method.invoke(Method.java:580)", "na:na"),
    SPRING("org.springframework.boot.loader.launch.Launcher.launch(Launcher.java:91)", "shop-api.jar:0.42.0"),
    SPRING("org.springframework.boot.loader.launch.Launcher.launch(Launcher.java:53)", "shop-api.jar:0.42.0"),
    SPRING("org.springframework.boot.loader.launch.JarLauncher.main(JarLauncher.java:58)", "shop-api.jar:0.42.0"),
    "Caused by: org.springframework.beans.factory.BeanCreationException: Error creating bean with name 'paymentGatewayClient': Failed to instantiate [com.demo.shop.payments.GatewayClient]: Constructor threw exception",
    SPRING("org.springframework.beans.factory.support.ConstructorResolver.instantiate(ConstructorResolver.java:321)"),
    SPRING(
      "org.springframework.beans.factory.support.ConstructorResolver.autowireConstructor(ConstructorResolver.java:309)",
    ),
    "\t... 24 common frames omitted",
    "Caused by: org.springframework.beans.BeanInstantiationException: Failed to instantiate [com.demo.shop.payments.GatewayClient]: Constructor threw exception",
    SPRING("org.springframework.beans.BeanUtils.instantiateClass(BeanUtils.java:222)"),
    SPRING(
      "org.springframework.beans.factory.support.SimpleInstantiationStrategy.instantiate(SimpleInstantiationStrategy.java:145)",
    ),
    SPRING("org.springframework.beans.factory.support.ConstructorResolver.instantiate(ConstructorResolver.java:318)"),
    "\t... 26 common frames omitted",
    "Caused by: com.demo.shop.payments.GatewayException: Gateway health check failed: 401 Unauthorized",
    SPRING("com.demo.shop.payments.GatewayClient.checkHealth(GatewayClient.java:88)", "!/:0.42.0"),
    SPRING("com.demo.shop.payments.GatewayClient.<init>(GatewayClient.java:41)", "!/:0.42.0"),
    SPRING(
      "java.base/jdk.internal.reflect.DirectConstructorHandleAccessor.newInstance(DirectConstructorHandleAccessor.java:62)",
      "na:na",
    ),
    SPRING("java.base/java.lang.reflect.Constructor.newInstanceWithCaller(Constructor.java:502)", "na:na"),
    SPRING("java.base/java.lang.reflect.Constructor.newInstance(Constructor.java:486)", "na:na"),
    SPRING("org.springframework.beans.BeanUtils.instantiateClass(BeanUtils.java:209)"),
    "\t... 28 common frames omitted",
    "Caused by: java.net.SocketTimeoutException: Connect timed out",
    "\tat java.base/sun.nio.ch.NioSocketImpl.timedFinishConnect(NioSocketImpl.java:546) ~[na:na]",
    "\tat java.base/sun.nio.ch.NioSocketImpl.connect(NioSocketImpl.java:592) ~[na:na]",
    "\tat java.base/java.net.SocksSocketImpl.connect(SocksSocketImpl.java:327) ~[na:na]",
    "\tat java.base/java.net.Socket.connect(Socket.java:751) ~[na:na]",
    "\tat java.base/sun.net.NetworkClient.doConnect(NetworkClient.java:178) ~[na:na]",
    "\tat java.base/sun.net.www.http.HttpClient.openServer(HttpClient.java:531) ~[na:na]",
    "\tat java.base/sun.net.www.http.HttpClient.openServer(HttpClient.java:636) ~[na:na]",
    SPRING("com.demo.shop.payments.GatewayClient.checkHealth(GatewayClient.java:84)", "!/:0.42.0"),
    "\t... 33 common frames omitted",
    "",
  ].join("\n");
}

/** A healthy pod: startup, then a stream of requests (following the log adds more). */
export function servingLog(base: number, pod: string): string {
  const random = seeded(`${pod}-requests`);
  const lines = springBoot(base, pod, `${pod}-boot`);
  let t = 12_000;
  for (let i = 0; i < 60; i++) {
    t += random.int(200, 4000);
    const route = random.pick(["/cart", "/cart/lines", "/search?q=shoes", "/health/ready", "/checkout", "/metrics"]);
    const status = random.next() < 0.03 ? 503 : 200;
    lines.push(
      `${stamp(base, t)}  ${status === 200 ? "INFO" : "WARN"} 1 --- [shop-api] [nio-8080-exec-${random.int(1, 10)}] c.d.shop.web.RequestLog                  : ${random.pick(["GET", "POST", "GET", "GET"])} ${route} ${status} ${random.int(2, 180)}ms`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** An OpenShift Docker build: the steps, then Gradle failing (or the push). */
export function buildLog(name: string, sha: string, failed: boolean): string {
  const random = seeded(`build-${name}`);
  const lines = [
    `Cloning "https://github.com/demo/shop.git" ...`,
    `\tCommit:\t${sha.slice(0, 7)} (${failed ? "feat(payments): retry failed payments with exponential backoff" : "build"})`,
    "\tAuthor:\tDemo Dev <demo.dev@demo.invalid>",
    "\tDate:\tMon Mar 2 02:30:00 2026 +0000",
    'time="2026-03-02T02:31:04Z" level=info msg="Not using native diff for overlay, this may cause degraded performance for building images: kernel has CONFIG_OVERLAY_FS_REDIRECT_DIR enabled"',
    'I0302 02:31:04.912847       1 defaults.go:112] Defaulting to storage driver "overlay" with options [mountopt=metacopy=on].',
    'Caching blobs under "/var/cache/blobs".',
    "Pulling image registry.access.redhat.com/ubi9/openjdk-21:1.20 ...",
    "Trying to pull registry.access.redhat.com/ubi9/openjdk-21:1.20...",
    "Getting image source signatures",
    "Copying blob sha256:a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e",
    "Copying blob sha256:5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d",
    "Copying config sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    "Writing manifest to image destination",
    "STEP 1/9: FROM registry.access.redhat.com/ubi9/openjdk-21:1.20 AS build",
    "STEP 2/9: WORKDIR /build",
    "STEP 3/9: COPY . .",
    "STEP 4/9: RUN ./gradlew assemble --no-daemon --console=plain",
    "Downloading https://services.gradle.org/distributions/gradle-8.10.2-bin.zip",
    ".............10%.............20%.............30%.............40%.............50%.............60%.............70%.............80%.............90%.............100%",
    "> Task :compileJava",
  ];
  if (failed) {
    lines.push(
      "/build/src/main/java/com/demo/shop/payments/RetryPolicy.java:31: error: incompatible types: String cannot be converted to int",
      '        int maxAttempts = config.get("payments.retry.max-attempts");',
      "                                    ^",
      "1 error",
      "",
      "> Task :compileJava FAILED",
      "",
      "FAILURE: Build failed with an exception.",
      "",
      "* What went wrong:",
      "Execution failed for task ':compileJava'.",
      "> Compilation failed; see the compiler error output for details.",
      "",
      `BUILD FAILED in ${random.int(40, 90)}s`,
      'error: build error: building at STEP "RUN ./gradlew assemble --no-daemon --console=plain": while running runtime: exit status 1',
    );
  } else {
    lines.push(
      "> Task :processResources",
      "> Task :classes",
      "> Task :bootJar",
      "> Task :assemble",
      "",
      `BUILD SUCCESSFUL in ${random.int(60, 120)}s`,
      "STEP 5/9: FROM registry.access.redhat.com/ubi9/openjdk-21-runtime:1.20",
      "STEP 6/9: COPY --from=build /build/build/libs/shop-api.jar /deployments/",
      "STEP 7/9: EXPOSE 8080",
      'STEP 8/9: ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"',
      `STEP 9/9: LABEL "io.openshift.build.commit.id"="${sha}"`,
      `COMMIT temp.builder.openshift.io/shop-dev/${name}:${sha.slice(0, 8)}`,
      `Successfully pushed image-registry.openshift-image-registry.svc:5000/shop-dev/shop-api@sha256:${sha}${sha.slice(0, 24)}`,
      "Push successful",
    );
  }
  return `${lines.join("\n")}\n`;
}
