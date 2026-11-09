/**
 * Preloaded by `bun run demo`: answers GitHub, Jenkins and OpenShift requests with the made-up data in scenario.ts,
 * so every v0.17 row can be looked at without a real server. Nothing reaches the network; unknown requests get a 404
 * and are listed in requests.log next to the demo state.
 */
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEMO_STATE_ENV,
  type FakeJob,
  type FakeRun,
  followLine,
  GITHUB_REPO,
  githubRuns,
  githubTimes,
  JENKINS_ROOT,
  jenkinsBuilds,
  loadDemoState,
  OLD_BRANCHES,
  OPENSHIFT_SERVER,
  openShiftWorld,
} from "./scenario";

const state = loadDemoState();
const started = Date.now();
const requestLog = join(dirname(process.env[DEMO_STATE_ENV] ?? "."), "requests.log");
const runs = githubRuns(state);
const builds = jenkinsBuilds(state);
const world = openShiftWorld(state, started);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const notFound = () => json({ message: "Not Found" }, 404);

/** A response that stays open until the request is aborted, feeding `next()` every 250 ms when given. */
function stream(signal: AbortSignal | null | undefined, first: string, next?: () => string): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      if (first) controller.enqueue(encoder.encode(first));
      if (next)
        timer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(next()));
          } catch {
            clearInterval(timer);
          }
        }, 250);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// ── GitHub ───────────────────────────────────────────────────────────────────

const upper = (value: string | null) => (value ? value.toUpperCase() : null);
const latestAttempt = (run: FakeRun) => Math.max(...run.jobs.map(job => job.attempt));

/** Steps share the job's time, the last ones taking longest (tests, builds), so durations differ. */
function stepTime(job: FakeJob, index: number): string {
  const times = githubTimes(started, job);
  const start = Date.parse(times.started);
  const total = Date.parse(times.completed) - start;
  const weights = job.steps.map((_, i) => 1 + i * i);
  const done = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  const all = weights.reduce((sum, weight) => sum + weight, 0);
  return new Date(start + Math.round((total * done) / all)).toISOString();
}

function gqlJob(job: FakeJob) {
  const times = githubTimes(started, job);
  return {
    databaseId: job.id,
    name: job.name,
    status: upper(job.status),
    conclusion: upper(job.conclusion),
    startedAt: times.started,
    completedAt: job.status === "completed" ? times.completed : null,
    steps: job.steps.map((step, index) => ({
      name: step.name,
      number: index + 1,
      status: step.conclusion ? "COMPLETED" : "IN_PROGRESS",
      conclusion: upper(step.conclusion),
      startedAt: stepTime(job, index),
      completedAt: step.conclusion ? stepTime(job, index + 1) : null,
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
    started_at: times.started,
    completed_at: job.status === "completed" ? times.completed : null,
    run_attempt: job.attempt,
    steps: job.steps.map((step, index) => ({
      name: step.name,
      number: index + 1,
      status: step.conclusion ? "completed" : "in_progress",
      conclusion: step.conclusion,
      started_at: stepTime(job, index),
      completed_at: step.conclusion ? stepTime(job, index + 1) : null,
    })),
  };
}

function graphql(body: string): Response {
  const parsed = JSON.parse(body) as { query: string; variables?: Record<string, string> };
  const repository: Record<string, unknown> = {};
  const withJobs = parsed.query.includes("jobs(first");
  const aliases = [...parsed.query.matchAll(/c(\d+): object\(oid: (?:"([0-9a-f]+)"|\$oid\d+)\)/g)];
  for (const [, index, literal] of aliases) {
    const oid = literal ?? parsed.variables?.[`oid${index}`] ?? "";
    const nodes = runs
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
            updatedAt: startedAt,
            url: `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/actions/runs/${run.id}`,
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
  const base = `/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}`;
  if (!url.pathname.startsWith(base)) return notFound();
  const path = url.pathname.slice(base.length);
  const runJobs = path.match(/^\/actions\/runs\/(\d+)\/jobs$/);
  if (runJobs) {
    const run = runs.find(item => item.id === Number(runJobs[1]));
    return run ? json({ total_count: run.jobs.length, jobs: run.jobs.map(restJob) }) : notFound();
  }
  const allJobs = runs.flatMap(run => run.jobs);
  const annotations = path.match(/^\/check-runs\/(\d+)\/annotations$/);
  if (annotations) return json(allJobs.find(job => job.id === Number(annotations[1]))?.annotations ?? []);
  const logs = path.match(/^\/actions\/jobs\/(\d+)\/logs$/);
  if (logs) {
    const job = allJobs.find(item => item.id === Number(logs[1]));
    return job ? text(job.log ?? `${job.name}: nothing to see here.\n`) : notFound();
  }
  return notFound();
}

// ── Jenkins ──────────────────────────────────────────────────────────────────

const WORKFLOW_JOB = "org.jenkinsci.plugins.workflow.job.WorkflowJob";
const branchUrl = (branch: string) => `${JENKINS_ROOT}/job/${encodeURIComponent(branch)}/`;

function jenkinsBuild(build: (typeof builds)[number]) {
  const timestamp = started - build.agoMin * 60_000;
  const duration = build.stages.reduce((sum, stage) => sum + stage.seconds * 1000, 0);
  return {
    _class: "org.jenkinsci.plugins.workflow.job.WorkflowRun",
    number: build.number,
    id: String(build.number),
    url: `${branchUrl(build.branch)}${build.number}/`,
    result: build.result,
    building: build.result === null,
    timestamp,
    duration: build.result === null ? 0 : duration,
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
        lastBuild: { timestamp: built },
      })),
    });
  }
  const match = rest.match(/^\/job\/([^/]+)\/(?:(\d+)\/)?(.*)$/);
  if (!match) return notFound();
  const branch = decodeURIComponent(match[1]);
  const number = match[2] ? Number(match[2]) : null;
  const tail = match[3];
  const ofBranch = builds.filter(build => build.branch === branch).sort((a, b) => b.number - a.number);
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
      durationMillis: build.stages.reduce((sum, stage) => sum + stage.seconds * 1000, 0),
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

let followCount = 0;

function openshift(url: URL, signal: AbortSignal | null | undefined): Response {
  const match = url.pathname.match(/^\/apis?\/(?:[^/]+\/)?v1\/namespaces\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/(log))?$/);
  if (!match) return notFound();
  const [, ns, plural, name, log] = match;
  if (plural === "events") {
    if (ns === "shop-prod") return json({ kind: "Status", message: "events is forbidden", code: 403 }, 403);
    const selector = url.searchParams.get("fieldSelector") ?? "";
    const kind = selector.match(/involvedObject\.kind=([^,]+)/)?.[1];
    const object = selector.match(/involvedObject\.name=([^,]+)/)?.[1];
    return json({ kind: "EventList", items: world.events.get(`${ns}/${kind}/${object}`) ?? [] });
  }
  const kind = PLURALS[plural];
  if (!kind) return notFound();
  const items = world.lists.get(ns)?.get(kind) ?? [];
  if (url.searchParams.get("watch") === "true") return stream(signal, "");
  if (!name) {
    const selector = url.searchParams.get("labelSelector");
    return json({
      kind: `${kind}List`,
      metadata: { resourceVersion: "1000" },
      items: items.filter(item => matchesSelector(item, selector)),
    });
  }
  const item = items.find(entry => nameOf(entry) === name);
  if (!item) return notFound();
  if (!log) return json(item);
  const saved = world.logs.get(`${ns}/${name}`) ?? `${name} started\n${followLine(0)}\n`;
  if (url.searchParams.get("follow") === "true")
    return stream(signal, `${saved}\n`, () =>
      Array.from({ length: 40 }, () => followLine(++followCount))
        .join("\n")
        .concat("\n"),
    );
  return text(saved);
}

// ── Router ───────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : request ? await request.text() : "";
  const signal = init?.signal ?? request?.signal;
  const origin = `${url.protocol}//${url.host}`;
  let response: Response;
  if (origin === "https://api.github.com") response = github(url, method, body);
  else if (origin === new URL(JENKINS_ROOT).origin) response = jenkins(url);
  else if (origin === new URL(OPENSHIFT_SERVER).origin) response = openshift(url, signal);
  else response = notFound();
  try {
    appendFileSync(requestLog, `${new Date().toISOString()} ${method} ${url.href} -> ${response.status}\n`);
  } catch {}
  // A short pause, so the fetching states show for a moment.
  await new Promise(resolve => setTimeout(resolve, 150));
  return response;
}

globalThis.fetch = Object.assign(fakeFetch, { preconnect: realFetch.preconnect }) as typeof fetch;
