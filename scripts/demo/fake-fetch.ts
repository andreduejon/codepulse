/**
 * Preloaded into the demo's app process: answers GitHub, Jenkins and OpenShift requests with the made-up data in
 * scenario.ts. Nothing reaches the network; unknown requests get a 404. Every request is listed in requests.log in
 * the demo folder.
 *
 * Each provider answers as its `--github`, `--jenkins` or `--openshift` mode says: the normal world, nothing, or one
 * failure. When the world moves on (phase.ts), the answers change and open OpenShift watches hear about it.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { buildLog, githubJobLog, servingLog } from "./logs";
import type { ProviderName } from "./options";
import { advancePhase, currentPhase, onPhase } from "./phase";
import {
  COMMIT_KEY,
  type FakeBuild,
  type FakeJob,
  type FakeRun,
  followLine,
  githubRuns,
  githubTimes,
  JENKINS_ROOT,
  jenkinsBuilds,
  LAST_PHASE,
  loadDemoState,
  OLD_BRANCHES,
  OPENSHIFT_SERVER,
  type OpenShiftWorld,
  openShiftWorld,
  resourceVersion,
} from "./scenario";

const state = loadDemoState();
let phase = currentPhase();
const started = phase.at[0];
const requestLog = join(state.root, "requests.log");
let runs = githubRuns(state, phase);
let builds = jenkinsBuilds(state, phase);
let world = openShiftWorld(state, phase);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const notFound = () => json({ message: "Not Found" }, 404);

/**
 * A response that stays open until the request is aborted. `next` feeds it every 250 ms; `listen` gets a function
 * that writes to it whenever the caller wants and returns how to stop listening.
 */
function stream(
  signal: AbortSignal | null | undefined,
  first: string,
  options: { next?: () => string; listen?: (write: (text: string) => void) => () => void } = {},
): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let unlisten: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        clearInterval(timer);
        unlisten?.();
        try {
          controller.close();
        } catch {}
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      const write = (value: string) => {
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          stop();
        }
      };
      if (first) write(first);
      if (options.next) timer = setInterval(() => write(options.next?.() ?? ""), 250);
      unlisten = options.listen?.(write);
    },
    cancel() {
      clearInterval(timer);
      unlisten?.();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// ── Provider modes ───────────────────────────────────────────────────────────

const errorOf = (provider: ProviderName) => {
  const mode = state.providers[provider];
  return mode.startsWith("error:") ? mode.slice("error:".length) : null;
};
const isEmpty = (provider: ProviderName) => state.providers[provider] === "empty";

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** The failure a provider was started with, for every one of its requests; null when it answers normally. */
function failure(provider: ProviderName, signal: AbortSignal | null | undefined): Promise<Response> | null {
  switch (errorOf(provider)) {
    case "401":
      return Promise.resolve(
        provider === "openshift"
          ? json({ kind: "Status", status: "Failure", message: "Unauthorized", reason: "Unauthorized", code: 401 }, 401)
          : json({ message: "Bad credentials" }, 401),
      );
    case "rate-limit":
      return Promise.resolve(
        json({ message: "API rate limit exceeded for user ID 1." }, 403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 15 * 60),
        }),
      );
    case "offline":
      return Promise.reject(
        Object.assign(new TypeError("Unable to connect. Is the computer able to access the url?"), {
          code: "ConnectionRefused",
        }),
      );
    case "timeout":
      // Never answers; the app gives up on its own timeout.
      return new Promise((_, reject) => {
        if (signal?.aborted) reject(abortError(signal));
        signal?.addEventListener("abort", () => reject(abortError(signal)), { once: true });
      });
    default:
      return null;
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────

const upper = (value: string | null) => (value ? value.toUpperCase() : null);
const latestAttempt = (run: FakeRun) => Math.max(1, ...run.jobs.map(job => job.attempt));

/** Steps share the job's time, the last ones taking longest (tests, builds), so durations differ. */
function stepTime(job: FakeJob, index: number): string {
  const times = githubTimes(started, job);
  const start = Date.parse(times.started);
  const total = Date.parse(times.completed) - start;
  // A skipped step takes no time, so the steps add up to the job's time.
  const weights = job.steps.map((step, i) => (step.conclusion === "skipped" ? 0 : 1 + i * i));
  const done = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  const all = weights.reduce((sum, weight) => sum + weight, 0);
  return new Date(start + Math.round((total * done) / all)).toISOString();
}

/** GitHub gives a skipped step the same start and end; the others end where the next one starts. */
const stepEnd = (job: FakeJob, step: FakeJob["steps"][number], index: number) =>
  !step.conclusion ? null : step.conclusion === "skipped" ? stepTime(job, index) : stepTime(job, index + 1);

/** When GitHub last changed a run: its last job's end, or now while it runs. */
function runUpdatedAt(run: FakeRun): string {
  const jobs = run.jobs.filter(job => job.attempt === latestAttempt(run));
  if (run.status !== "completed" || jobs.length === 0) return new Date().toISOString();
  return new Date(Math.max(...jobs.map(job => Date.parse(githubTimes(started, job).completed)))).toISOString();
}

const stepStatus = (job: FakeJob, step: FakeJob["steps"][number]) =>
  step.conclusion ? "completed" : job.status === "queued" ? "queued" : "in_progress";

function gqlJob(job: FakeJob) {
  const times = githubTimes(started, job);
  return {
    databaseId: job.id,
    name: job.name,
    status: upper(job.status),
    conclusion: upper(job.conclusion),
    startedAt: job.status === "queued" ? null : times.started,
    completedAt: job.status === "completed" ? times.completed : null,
    steps: job.steps.map((step, index) => ({
      name: step.name,
      number: index + 1,
      status: upper(stepStatus(job, step)),
      conclusion: upper(step.conclusion),
      startedAt: stepTime(job, index),
      completedAt: stepEnd(job, step, index),
    })),
  };
}

function restJob(job: FakeJob) {
  const times = githubTimes(started, job);
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    started_at: job.status === "queued" ? null : times.started,
    completed_at: job.status === "completed" ? times.completed : null,
    run_attempt: job.attempt,
    steps: job.steps.map((step, index) => ({
      name: step.name,
      number: index + 1,
      status: stepStatus(job, step),
      conclusion: step.conclusion,
      started_at: stepTime(job, index),
      completed_at: stepEnd(job, step, index),
    })),
  };
}

const runsOf = (repo: string) => (isEmpty("github") ? [] : runs.filter(run => run.repo === repo));

/**
 * A job's log as GitHub serves it: a byte order mark, then every line stamped with the time it was written, spread
 * over the job's run. A skipped job has none.
 */
function jobLog(run: FakeRun, job: FakeJob): string | null {
  if (job.conclusion === "skipped" || job.status === "queued") return null;
  const outcome =
    job.status !== "completed"
      ? "running"
      : job.conclusion === "success"
        ? "success"
        : job.conclusion === "cancelled"
          ? "cancelled"
          : job.conclusion === "timed_out"
            ? "timed_out"
            : "failure";
  const raw = githubJobLog({
    repo: `demo/${run.repo}`,
    sha: run.sha,
    job: job.name,
    kind: job.logKind ?? "build",
    outcome,
    failures: job.failures,
    lint: job.lint,
    seed: String(job.id),
  });
  const times = githubTimes(started, job);
  const start = Date.parse(times.started);
  const end = job.status === "completed" ? Date.parse(times.completed) : Date.now();
  const lines = raw.replace(/\n$/, "").split("\n");
  const stamped = lines.map((line, index) => {
    const at = new Date(start + Math.round(((end - start) * index) / lines.length)).toISOString();
    return `${at.replace("Z", "0000Z")} ${line}`;
  });
  return `\ufeff${stamped.join("\n")}\n`;
}

function graphql(body: string): Response {
  const parsed = JSON.parse(body) as { query: string; variables?: Record<string, string> };
  const repoRuns = runsOf(parsed.variables?.repo ?? "");
  const repository: Record<string, unknown> = {};
  const withJobs = parsed.query.includes("jobs(first");
  const aliases = [...parsed.query.matchAll(/c(\d+): object\(oid: (?:"([0-9a-f]+)"|\$oid\d+)\)/g)];
  for (const [, index, literal] of aliases) {
    const oid = literal ?? parsed.variables?.[`oid${index}`] ?? "";
    const nodes = repoRuns
      .filter(run => run.sha === oid)
      .map(run => {
        const startedAt = new Date(started - run.startedAgoMin * 60_000).toISOString();
        return {
          status: upper(run.status),
          conclusion: upper(run.conclusion),
          workflowRun: {
            databaseId: run.id,
            runNumber: run.runNumber,
            event: "push",
            createdAt: startedAt,
            updatedAt: runUpdatedAt(run),
            url: `https://github.com/demo/${run.repo}/actions/runs/${run.id}`,
            workflow: { name: run.name },
            // GraphQL has no attempts: it lists the latest attempt's jobs, so the first expand asks REST once.
            ...(withJobs
              ? { jobs: { nodes: run.jobs.filter(job => job.attempt === latestAttempt(run)).map(gqlJob) } }
              : {}),
          },
        };
      });
    repository[`c${index}`] = { oid, checkSuites: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
  }
  return json({ data: { repository } });
}

function github(url: URL, method: string, body: string): Response {
  if (url.pathname === "/graphql" && method === "POST") return graphql(body);
  const match = url.pathname.match(/^\/repos\/demo\/([^/]+)(\/.*)$/);
  if (!match) return notFound();
  const [, repo, path] = match;
  const repoRuns = runsOf(repo);
  const runJobs = path.match(/^\/actions\/runs\/(\d+)\/jobs$/);
  if (runJobs) {
    const run = repoRuns.find(item => item.id === Number(runJobs[1]));
    return run ? json({ total_count: run.jobs.length, jobs: run.jobs.map(restJob) }) : notFound();
  }
  const allJobs = repoRuns.flatMap(run => run.jobs);
  const annotations = path.match(/^\/check-runs\/(\d+)\/annotations$/);
  if (annotations) return json(allJobs.find(job => job.id === Number(annotations[1]))?.annotations ?? []);
  const logs = path.match(/^\/actions\/jobs\/(\d+)\/logs$/);
  if (logs) {
    const run = repoRuns.find(item => item.jobs.some(job => job.id === Number(logs[1])));
    const job = run?.jobs.find(item => item.id === Number(logs[1]));
    const log = run && job ? jobLog(run, job) : null;
    return log === null ? notFound() : text(log);
  }
  return notFound();
}

// ── Jenkins ──────────────────────────────────────────────────────────────────

const WORKFLOW_JOB = "org.jenkinsci.plugins.workflow.job.WorkflowJob";
const branchUrl = (branch: string) => `${JENKINS_ROOT}/job/${encodeURIComponent(branch)}/`;
const buildDuration = (build: FakeBuild) => build.stages.reduce((sum, stage) => sum + stage.seconds * 1000, 0);

function jenkinsBuild(build: FakeBuild) {
  return {
    _class: "org.jenkinsci.plugins.workflow.job.WorkflowRun",
    number: build.number,
    id: String(build.number),
    url: `${branchUrl(build.branch)}${build.number}/`,
    result: build.result,
    building: build.result === null,
    timestamp: started - build.agoMin * 60_000,
    duration: build.result === null ? 0 : buildDuration(build),
    actions: [{ _class: "hudson.plugins.git.util.BuildData", lastBuiltRevision: { SHA1: build.sha } }],
    changeSets: [],
  };
}

function jenkins(url: URL): Response {
  const root = new URL(JENKINS_ROOT).pathname;
  if (!url.pathname.startsWith(root)) return notFound();
  const rest = url.pathname.slice(root.length);
  if (rest === "/api/json") {
    const graph = state.branches.map((name, i) => ({ name, built: started - (60 + i) * 60 * 60_000 }));
    const old = OLD_BRANCHES.map((name, i) => ({ name, built: started - (i + 1) * 60_000 }));
    return json({
      _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
      jobs: [...old, ...graph].map(({ name, built }) => ({
        _class: WORKFLOW_JOB,
        name: encodeURIComponent(name),
        displayName: name,
        url: branchUrl(name),
        buildable: true,
        lastBuild: isEmpty("jenkins") ? null : { timestamp: built },
      })),
    });
  }
  const match = rest.match(/^\/job\/([^/]+)\/(?:(\d+)\/)?(.*)$/);
  if (!match) return notFound();
  const branch = decodeURIComponent(match[1]);
  const number = match[2] ? Number(match[2]) : null;
  const tail = match[3];
  const ofBranch = isEmpty("jenkins")
    ? []
    : builds.filter(build => build.branch === branch).sort((a, b) => b.number - a.number);
  if (number === null) {
    if (tail !== "api/json") return notFound();
    return json({
      _class: WORKFLOW_JOB,
      lastBuild: ofBranch[0] ? { number: ofBranch[0].number, url: jenkinsBuild(ofBranch[0]).url } : null,
      builds: ofBranch.map(jenkinsBuild),
    });
  }
  const build = ofBranch.find(item => item.number === number);
  if (!build) return notFound();
  if (tail === "api/json") return json(jenkinsBuild(build));
  if (tail === "consoleText") return text(build.console);
  if (tail === "wfapi/describe") {
    let at = started - build.agoMin * 60_000;
    return json({
      id: String(build.number),
      status: build.result ?? "IN_PROGRESS",
      startTimeMillis: at,
      durationMillis: buildDuration(build),
      stages: build.stages.map((stage, index) => {
        const item = {
          id: String(index + 1),
          name: stage.name,
          status: stage.status,
          startTimeMillis: at,
          durationMillis: stage.seconds * 1000,
        };
        at += stage.seconds * 1000;
        return item;
      }),
    });
  }
  if (tail === "testReport/api/json") {
    if (!build.tests) return text("Not found", 404);
    return json({
      failCount: build.tests.failed.length,
      passCount: build.tests.pass,
      skipCount: build.tests.skip,
      suites: [
        {
          cases: build.tests.failed.map(test => ({
            className: test.className,
            name: test.name,
            status: "FAILED",
            errorDetails: test.details,
            errorStackTrace: test.stack,
          })),
        },
      ],
    });
  }
  return notFound();
}

// ── OpenShift ────────────────────────────────────────────────────────────────

const PLURALS: Record<string, string> = {
  builds: "Build",
  imagestreamtags: "ImageStreamTag",
  deployments: "Deployment",
  replicasets: "ReplicaSet",
  deploymentconfigs: "DeploymentConfig",
  replicationcontrollers: "ReplicationController",
  pods: "Pod",
};

type Item = Record<string, unknown>;
const labelsOf = (item: Item) =>
  ((item.metadata as Item | undefined)?.labels as Record<string, string> | undefined) ?? {};
const nameOf = (item: Item) => String((item.metadata as Item | undefined)?.name ?? "");
const forbidden = (message: string) =>
  json({ kind: "Status", status: "Failure", message, reason: "Forbidden", code: 403 }, 403);

function matchesSelector(item: Item, selector: string | null): boolean {
  if (!selector) return true;
  const labels = labelsOf(item);
  const set = selector.match(/^(\S+) in \(([^)]*)\)$/);
  if (set) return set[2].split(",").includes(labels[set[1]] ?? "");
  return selector.split(",").every(part => {
    const [key, value] = part.split("=");
    return labels[key] === value;
  });
}

/** Open watches, each with its namespace and kind; the phase listener writes their events. */
const watches = new Set<{ ns: string; kind: string; selector: string | null; write: (text: string) => void }>();

const itemsOf = (target: OpenShiftWorld, ns: string, kind: string) =>
  isEmpty("openshift") ? [] : (target.lists.get(ns)?.get(kind) ?? []);

let followCount = 0;

function openshift(url: URL, signal: AbortSignal | null | undefined): Response {
  const match = url.pathname.match(/^\/apis?\/(?:[^/]+\/)?v1\/namespaces\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/(log))?$/);
  if (!match) return notFound();
  const [, ns, plural, name, log] = match;
  if (plural === "events") {
    if (ns === "shop-prod") return forbidden("events is forbidden");
    const selector = url.searchParams.get("fieldSelector") ?? "";
    const kind = selector.match(/involvedObject\.kind=([^,]+)/)?.[1];
    const object = selector.match(/involvedObject\.name=([^,]+)/)?.[1];
    return json({ kind: "EventList", items: world.events.get(`${ns}/${kind}/${object}`) ?? [] });
  }
  const kind = PLURALS[plural];
  if (!kind) return notFound();
  // --openshift error:partial: shop-prod's lists are forbidden, the other namespaces answer.
  if (errorOf("openshift") === "partial" && ns === "shop-prod")
    return forbidden(`${plural} is forbidden: User "demo" cannot list resource "${plural}" in namespace "${ns}"`);
  const items = itemsOf(world, ns, kind);
  const selector = url.searchParams.get("labelSelector");
  if (url.searchParams.get("watch") === "true") {
    if (errorOf("openshift") === "watch-denied") return forbidden(`${plural} is forbidden: watch is not allowed`);
    return stream(signal, "", {
      listen: write => {
        const watch = { ns, kind, selector, write };
        watches.add(watch);
        return () => watches.delete(watch);
      },
    });
  }
  if (!name) {
    return json({
      kind: `${kind}List`,
      metadata: { resourceVersion: resourceVersion(phase) },
      items: items.filter(item => matchesSelector(item, selector)),
    });
  }
  const item = items.find(entry => nameOf(entry) === name);
  if (!item) return notFound();
  if (!log) return json(item);
  const saved =
    world.logs.get(`${ns}/${name}`) ??
    (kind === "Build"
      ? buildLog(name, labelsOf(item)[COMMIT_KEY] ?? "0".repeat(40), false)
      : servingLog(started - 45 * 60_000, name));
  // Like a cluster: only a running container keeps the followed log open. A crashed one ends with its crash.
  const statuses = (item.status as { containerStatuses?: { state?: { running?: unknown } }[] } | undefined)
    ?.containerStatuses;
  if (url.searchParams.get("follow") === "true" && statuses?.some(status => status.state?.running))
    return stream(signal, `${saved}\n`, {
      next: () =>
        Array.from({ length: 40 }, () => followLine(++followCount))
          .join("\n")
          .concat("\n"),
    });
  return text(saved);
}

/** What changed in OpenShift between two phases, as watch events per namespace and kind. */
function watchEvents(before: OpenShiftWorld, after: OpenShiftWorld) {
  const events: { ns: string; kind: string; type: string; object: Item }[] = [];
  const namespaces = new Set([...before.lists.keys(), ...after.lists.keys()]);
  for (const ns of namespaces) {
    for (const kind of Object.values(PLURALS)) {
      const old = new Map(itemsOf(before, ns, kind).map(item => [nameOf(item), item]));
      const next = itemsOf(after, ns, kind);
      for (const item of next) {
        const previous = old.get(nameOf(item));
        const strip = (value: Item) =>
          JSON.stringify({ ...value, metadata: { ...(value.metadata as Item), resourceVersion: "" } });
        if (!previous) events.push({ ns, kind, type: "ADDED", object: item });
        else if (strip(previous) !== strip(item)) events.push({ ns, kind, type: "MODIFIED", object: item });
        old.delete(nameOf(item));
      }
      for (const item of old.values()) events.push({ ns, kind, type: "DELETED", object: item });
    }
  }
  return events;
}

// ── The world moves on ───────────────────────────────────────────────────────

onPhase(next => {
  const before = world;
  phase = next;
  runs = githubRuns(state, next);
  builds = jenkinsBuilds(state, next);
  world = openShiftWorld(state, next);
  for (const event of watchEvents(before, world))
    for (const watch of watches)
      if (watch.ns === event.ns && watch.kind === event.kind && matchesSelector(event.object, watch.selector))
        watch.write(`${JSON.stringify({ type: event.type, object: event.object })}\n`);
  // Phase 2: the new commit lands on origin/dev, for the next `git fetch` to find.
  if (next.index === 2) {
    const result = Bun.spawnSync([
      "git",
      "--git-dir",
      join(state.remotes, "demo", "shop.git"),
      "update-ref",
      "refs/heads/dev",
      state.shas.next,
    ]);
    if (result.exitCode !== 0) log(`git update-ref failed: ${result.stderr.toString().trim()}`);
  }
  log(`world moved to phase ${next.index} of ${LAST_PHASE}`);
});

// --live: the interactive demo moves on by itself, one phase per interval.
if (state.live !== null) {
  const timer = setInterval(() => {
    if (!advancePhase() || currentPhase().index >= LAST_PHASE) clearInterval(timer);
  }, state.live * 1000);
}

// ── Router ───────────────────────────────────────────────────────────────────

function log(line: string) {
  try {
    appendFileSync(requestLog, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

const realFetch = globalThis.fetch;
const sleep = (ms: number, signal: AbortSignal | null | undefined) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });

async function route(url: URL, method: string, body: string, signal: AbortSignal | null | undefined) {
  const origin = `${url.protocol}//${url.host}`;
  const provider: ProviderName | null =
    origin === "https://api.github.com"
      ? "github"
      : origin === new URL(JENKINS_ROOT).origin
        ? "jenkins"
        : origin === new URL(OPENSHIFT_SERVER).origin
          ? "openshift"
          : null;
  if (!provider) return notFound();
  const failed = failure(provider, signal);
  if (failed) return failed;
  if (provider === "github") return github(url, method, body);
  if (provider === "jenkins") return jenkins(url);
  return openshift(url, signal);
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : request ? await request.text() : "";
  const signal = init?.signal ?? request?.signal;
  let outcome = "failed";
  try {
    // A short pause, so the fetching states show for a moment.
    await sleep(state.latency, signal);
    const response = await route(url, method, body, signal);
    outcome = String(response.status);
    return response;
  } catch (error) {
    if (signal?.aborted) outcome = "aborted";
    throw error;
  } finally {
    log(`${method} ${url.href} -> ${outcome}`);
  }
}

globalThis.fetch = Object.assign(fakeFetch, { preconnect: realFetch.preconnect }) as typeof fetch;
