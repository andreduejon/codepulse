import { isAbortError } from "../../core/abort";
import { bannerOrFallback, debugError } from "../../core/banner";
import { JENKINS_BANNER } from "../../core/jenkins/banner";
import {
  JENKINS_MULTIBRANCH_JOB_LIMIT,
  type JenkinsFailedTest,
  type JenkinsJob,
  type JenkinsJobConfig,
  type JenkinsListedBuilds,
  type JenkinsRun,
  type JenkinsStage,
  type JenkinsTestReport,
} from "../../core/jenkins/types";
import { isSafeJenkinsRequestUrl } from "../../core/jenkins/validation";
import { failureOf, ProviderAuthError, type ProviderFailure } from "../../core/provider-failure";
import { fetchWithRetry as fetchWithRetryPolicy, runLimited } from "../http";

interface JenkinsBuildApi {
  number?: number;
  id?: string;
  url?: string;
  result?: string | null;
  building?: boolean;
  timestamp?: number;
  duration?: number;
  actions?: unknown[];
  changeSet?: { items?: unknown[] };
  changeSets?: { items?: unknown[] }[];
}

interface JenkinsJobApi {
  _class?: string;
  displayName?: string;
  builds?: JenkinsBuildApi[];
  lastBuild?: { number?: number; url?: string; building?: boolean } | null;
  jobs?: JenkinsMultibranchChildApi[];
}

interface JenkinsMultibranchChildApi {
  _class?: string;
  name?: string;
  displayName?: string;
  url?: string;
  buildable?: boolean;
  disabled?: boolean;
  lastBuild?: { number?: number; timestamp?: number; building?: boolean } | null;
}

interface JenkinsWfapiStage {
  id?: string;
  name?: string;
  status?: string;
  startTimeMillis?: number;
  durationMillis?: number;
}

interface JenkinsWfapiDescribe {
  id?: string;
  name?: string;
  status?: string;
  startTimeMillis?: number;
  endTimeMillis?: number;
  durationMillis?: number;
  stages?: JenkinsWfapiStage[];
}

const JENKINS_REQUEST_TIMEOUT_MS = 20_000;
const JENKINS_CONCURRENCY = 6;
const JENKINS_HTTP_POLICY = {
  timeoutMs: JENKINS_REQUEST_TIMEOUT_MS,
  attempts: 2,
  retryDelayMs: 500,
  timeoutMessage: JENKINS_BANNER.timeout,
};

async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithRetryPolicy(url, init, JENKINS_HTTP_POLICY, "Jenkins");
}

function treeApiSuffix(tree: string): string {
  return `api/json?tree=${encodeURIComponent(tree)}`;
}

function lastBuildTree(): string {
  return "lastBuild[number,building]";
}

function shallowGraphTree(limit: number): string {
  return `lastBuild[number,building],builds[number,url,result,building,timestamp,duration,actions[lastBuiltRevision[SHA1],scmRevisionAction[revision[hash]]],changeSets[items[commitId,id]],changeSet[items[commitId,id]]]{0,${limit}}`;
}

function buildRefsTree(limit: number): string {
  return `builds[number,url]{0,${limit}}`;
}

function buildDetailTree(): string {
  return [
    "number",
    "id",
    "url",
    "result",
    "building",
    "timestamp",
    "duration",
    "actions[lastBuiltRevision[SHA1],scmRevisionAction[revision[hash]]]",
    "changeSets[items[commitId,id]]",
    "changeSet[items[commitId,id]]",
  ].join(",");
}

function multibranchJobsTree(): string {
  return "_class,jobs[_class,name,displayName,url,buildable,disabled,lastBuild[number,timestamp,building]]";
}

function autoDetectTree(jobTree?: string): string {
  return jobTree ? `${jobTree},${multibranchJobsTree()}` : multibranchJobsTree();
}

export function normalizeJenkinsJobUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function jenkinsApiUrl(jobUrl: string, suffix = "api/json"): string {
  return `${normalizeJenkinsJobUrl(jobUrl)}/${suffix.replace(/^\/+/, "")}`;
}

export function getJenkinsToken(envVar: string): string | null {
  const token = process.env[envVar];
  return token && token.length > 0 ? token : null;
}

export function deriveJenkinsJobLabel(job: JenkinsJobConfig): string {
  if (job.label?.trim()) return job.label.trim();
  const parts = normalizeJenkinsJobUrl(job.url).split("/").filter(Boolean);
  return decodeURIComponent(parts.at(-1) ?? "jenkins");
}

function isEnabledMultibranchJob(job: JenkinsMultibranchChildApi): boolean {
  return (
    job._class === "org.jenkinsci.plugins.workflow.job.WorkflowJob" &&
    job.buildable === true &&
    job.disabled !== true &&
    typeof job.url === "string" &&
    job.url.trim().length > 0
  );
}

function authHeaders(username: string | undefined, token: string): Record<string, string> {
  if (!username) throw new Error(JENKINS_BANNER.noUsername);
  return { Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}` };
}

/**
 * Jenkins builds absolute URLs from its own "Jenkins URL" setting, which may name another host.
 * Move them onto the configured origin so credentials never leave it.
 */
function onOrigin(url: string, base: string): string {
  const parsed = new URL(url);
  const origin = new URL(base).origin;
  return parsed.origin === origin
    ? parsed.toString()
    : new URL(`${parsed.pathname}${parsed.search}`, origin).toString();
}

function isJenkinsLoginRedirect(location: string | null): boolean {
  return !!location && /securityRealm\/commenceLogin/i.test(location);
}

function jenkinsAuthError(detail: string): Error {
  debugError("Jenkins", detail);
  return new ProviderAuthError(JENKINS_BANNER.authFailed);
}

async function fetchJson<T>(
  url: string,
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!isSafeJenkinsRequestUrl(url)) {
    debugError("Jenkins", url);
    throw new Error(JENKINS_BANNER.invalidJobUrl);
  }
  const res = await fetchWithRetry(url, { headers: authHeaders(username, token), signal, redirect: "manual" });
  if (res.status >= 300 && res.status < 400 && isJenkinsLoginRedirect(res.headers.get("location"))) {
    throw jenkinsAuthError(`login redirect ${url}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 401) throw new ProviderAuthError(JENKINS_BANNER.tokenExpired);
  if (!res.ok) {
    debugError("Jenkins", `${res.status} ${res.statusText} ${url}`);
    throw new Error(JENKINS_BANNER.fetchFailed);
  }
  if (/text\/html/i.test(contentType)) throw jenkinsAuthError(`html response ${url}`);
  return (await res.json()) as T;
}

export async function resolveJenkinsJobs(
  jobs: JenkinsJobConfig[],
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
  jobTree?: string,
  /** Branch names in the graph: over the limit, their jobs are kept first. */
  preferredBranches: ReadonlySet<string> = new Set(),
): Promise<{
  jobs: JenkinsJobConfig[];
  rootData: Map<string, JenkinsJobApi>;
  /** Each branch job's last build, from its project's listing: what a probe compares. */
  branchLastBuilds: Map<string, JenkinsJobApi["lastBuild"]>;
  error: string | null;
  failure?: ProviderFailure;
  complete: boolean;
  truncated: boolean;
  /** Branch jobs of multibranch projects: how many are read, out of how many enabled ones. */
  branchJobs: { shown: number; total: number };
}> {
  const resolved = new Map<string, JenkinsJobConfig>();
  const rootData = new Map<string, JenkinsJobApi>();
  const branchLastBuilds = new Map<string, JenkinsJobApi["lastBuild"]>();
  let firstError: string | null = null;
  let failure: ProviderFailure | undefined;
  let discoveredCount = 0;
  let branchJobTotal = 0;
  let truncated = false;
  const discoveries: ({ job: JenkinsJobConfig; api: JenkinsJobApi } | null)[] = jobs.map(() => null);
  await runLimited(
    jobs.map((job, index) => ({ job, index })),
    JENKINS_CONCURRENCY,
    async ({ job, index }) => {
      try {
        const api = await fetchJson<JenkinsJobApi>(
          jenkinsApiUrl(job.url, treeApiSuffix(autoDetectTree(jobTree))),
          username,
          token,
          signal,
        );
        discoveries[index] = { job, api };
      } catch (err) {
        if (isAbortError(err, signal)) throw err;
        firstError ??= bannerOrFallback(err, JENKINS_BANNER.fetchFailed, "Jenkins");
        failure ??= failureOf(err);
      }
    },
    signal,
  );

  // Branch jobs of every multibranch project, read after the limit is applied to all of them together.
  const candidates: {
    child: JenkinsMultibranchChildApi;
    parentOrigin: string;
    order: number;
    preferred: boolean;
    built: number;
  }[] = [];
  for (const discovery of discoveries) {
    if (!discovery) continue;
    if (discovery.api._class !== "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject") {
      const url = normalizeJenkinsJobUrl(discovery.job.url);
      resolved.set(url, discovery.job);
      rootData.set(url, discovery.api);
      continue;
    }
    let parentOrigin: string;
    try {
      parentOrigin = new URL(discovery.job.url).origin;
    } catch {
      debugError("Jenkins", discovery.job.url);
      firstError ??= JENKINS_BANNER.invalidJobUrl;
      continue;
    }
    const inGraph = (child: JenkinsMultibranchChildApi) => {
      const name = child.name ? safeDecode(child.name) : "";
      return preferredBranches.has(name) || (!!child.displayName && preferredBranches.has(child.displayName));
    };
    for (const child of (discovery.api.jobs ?? []).filter(isEnabledMultibranchJob))
      candidates.push({
        child,
        parentOrigin,
        order: candidates.length,
        preferred: inGraph(child),
        built: child.lastBuild?.timestamp ?? -1,
      });
  }
  // Each branch job once, with a valid URL, and not one configured directly: those are what the limit and its notice
  // count.
  const branchJobs: {
    child: JenkinsMultibranchChildApi;
    url: string;
    order: number;
    preferred: boolean;
    built: number;
  }[] = [];
  const seen = new Set<string>();
  for (const { child, parentOrigin, ...rank } of candidates) {
    let url: string;
    try {
      url = normalizeJenkinsJobUrl(onOrigin(child.url ?? "", parentOrigin));
    } catch {
      debugError("Jenkins", child.url ?? "");
      firstError ??= JENKINS_BANNER.invalidJobUrl;
      continue;
    }
    if (!url || resolved.has(url) || seen.has(url)) continue;
    if (!isSafeJenkinsRequestUrl(url)) {
      debugError("Jenkins", url);
      firstError ??= JENKINS_BANNER.invalidJobUrl;
      continue;
    }
    seen.add(url);
    branchJobs.push({ child, url, ...rank });
  }
  branchJobTotal = branchJobs.length;
  // Over the limit, the branches in the graph are read first, then the most recently built (stable otherwise),
  // whichever project they belong to.
  branchJobs.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.built - a.built || a.order - b.order);
  for (const { child, url } of branchJobs) {
    if (discoveredCount >= JENKINS_MULTIBRANCH_JOB_LIMIT) {
      if (!truncated) debugError("Jenkins", `Multibranch discovery limited to ${JENKINS_MULTIBRANCH_JOB_LIMIT} jobs`);
      truncated = true;
      continue;
    }
    const childLabel = child.displayName?.trim() || child.name?.trim() || deriveJenkinsJobLabel({ url });
    // Jenkins names a branch job after its branch; a pull request's job (`PR-12`, `MR-3`) builds no branch.
    const branch = child.name ? safeDecode(child.name).trim() : "";
    resolved.set(url, { url, label: childLabel, ...(branch && !/^(PR|MR)-\d+$/.test(branch) ? { branch } : {}) });
    // Its last build, from the project's one listing: a probe skips the branch job when it is unchanged.
    branchLastBuilds.set(url, child.lastBuild ?? null);
    discoveredCount++;
  }

  return {
    jobs: [...resolved.values()],
    rootData,
    branchLastBuilds,
    error: firstError,
    failure,
    complete: discoveries.every(Boolean) && !truncated,
    truncated,
    branchJobs: { shown: discoveredCount, total: branchJobTotal },
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractSha(raw: unknown): string | null {
  const readSha = (value: unknown): string | null =>
    typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value) ? value : null;

  if (raw && typeof raw === "object") {
    const root = raw as Record<string, unknown>;
    const changeSets = root.changeSets;
    if (Array.isArray(changeSets)) {
      for (const changeSet of changeSets) {
        if (!changeSet || typeof changeSet !== "object") continue;
        const items = (changeSet as Record<string, unknown>).items;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          const sha = readSha(obj.commitId) ?? readSha(obj.id);
          if (sha) return sha;
        }
      }
    }
  }

  const seen = new Set<unknown>();
  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const obj = value as Record<string, unknown>;
    for (const key of ["GIT_COMMIT", "commitId", "SHA1", "sha", "commit"] as const) {
      const candidate = obj[key];
      if (typeof candidate === "string" && /^[0-9a-f]{7,40}$/i.test(candidate)) return candidate;
    }
    for (const child of Object.values(obj)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = visit(item);
          if (found) return found;
        }
      } else {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(raw);
}

function collectShas(raw: unknown, out: Set<string>, seen = new Set<unknown>()) {
  if (!raw || typeof raw !== "object" || seen.has(raw)) return;
  seen.add(raw);
  const obj = raw as Record<string, unknown>;
  for (const key of ["GIT_COMMIT", "commitId", "SHA1", "sha", "commit", "hash"] as const) {
    const candidate = obj[key];
    if (typeof candidate === "string" && /^[0-9a-f]{7,40}$/i.test(candidate)) out.add(candidate);
  }
  for (const child of Object.values(obj)) {
    if (Array.isArray(child)) {
      for (const item of child) collectShas(item, out, seen);
    } else {
      collectShas(child, out, seen);
    }
  }
}

function collectHeadShas(raw: unknown, out: Set<string>, seen = new Set<unknown>()) {
  if (!raw || typeof raw !== "object" || seen.has(raw)) return;
  seen.add(raw);
  const obj = raw as Record<string, unknown>;
  for (const key of ["GIT_COMMIT", "SHA1", "sha", "commit", "hash"] as const) {
    const candidate = obj[key];
    if (typeof candidate === "string" && /^[0-9a-f]{7,40}$/i.test(candidate)) out.add(candidate);
  }
  for (const [key, child] of Object.entries(obj)) {
    if (key === "changeSet" || key === "changeSets") continue;
    if (Array.isArray(child)) {
      for (const item of child) collectHeadShas(item, out, seen);
    } else {
      collectHeadShas(child, out, seen);
    }
  }
}

export function extractHeadShas(raw: unknown): string[] {
  const shas = new Set<string>();
  collectHeadShas(raw, shas);
  return [...shas];
}

export function extractCandidateShas(raw: unknown): string[] {
  const shas = new Set<string>();
  collectShas(raw, shas);
  return [...shas];
}

function matchingHeadShas(raw: unknown, wanted: Set<string>): string[] {
  const matches = extractHeadShas(raw)
    .map(sha => ({ sha, lower: sha.toLowerCase() }))
    .filter(({ lower }) => wanted.has(lower))
    .map(({ sha }) => sha);
  return [...new Set(matches)];
}

/** Jenkins build results in the shared vocabulary, so builds and their stages (`mapWfapiStatus`) agree. */
const BUILD_CONCLUSIONS: Record<string, string> = { aborted: "cancelled", not_built: "skipped" };

export function mapStatus(
  build: Pick<JenkinsBuildApi, "building" | "result">,
): Pick<JenkinsRun, "status" | "conclusion"> {
  if (build.building) return { status: "running", conclusion: null };
  const result = (build.result ?? "UNKNOWN").toLowerCase();
  return { status: "completed", conclusion: BUILD_CONCLUSIONS[result] ?? result };
}

function mapWfapiStatus(status: string | undefined): { status: string; conclusion: string | null } {
  switch (status) {
    case "IN_PROGRESS":
      return { status: "running", conclusion: null };
    case "SUCCESS":
      return { status: "completed", conclusion: "success" };
    case "FAILED":
    case "FAILURE":
    case "ERROR":
      return { status: "completed", conclusion: "failure" };
    case "ABORTED":
      return { status: "completed", conclusion: "cancelled" };
    case "NOT_EXECUTED":
      return { status: "completed", conclusion: "skipped" };
    default:
      return { status: "completed", conclusion: status ? status.toLowerCase() : null };
  }
}

function mapRun(job: JenkinsJobConfig, build: JenkinsBuildApi, sha: string): JenkinsRun {
  const startedAt = build.timestamp ? new Date(build.timestamp).toISOString() : null;
  const updatedAt = build.timestamp
    ? new Date(build.timestamp + (build.duration ?? 0)).toISOString()
    : new Date().toISOString();
  const number = build.number ?? Number(build.id ?? 0);
  const status = mapStatus(build);
  const label = deriveJenkinsJobLabel(job);
  return {
    id: `${normalizeJenkinsJobUrl(job.url)}#${number}`,
    name: label,
    runNumber: number,
    headSha: sha,
    startedAt,
    updatedAt,
    url: build.url ? onOrigin(build.url, job.url) : `${normalizeJenkinsJobUrl(job.url)}/${number}`,
    jobLabel: label,
    jobUrl: normalizeJenkinsJobUrl(job.url),
    ...(job.branch ? { branch: job.branch } : {}),
    ...status,
  };
}

export async function fetchJenkinsRunsForBuilds(
  runs: JenkinsRun[],
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<{ data: JenkinsRun[]; error: string | null; failure?: ProviderFailure }> {
  const out: JenkinsRun[] = [];
  let firstError: string | null = null;
  let failure: ProviderFailure | undefined;
  await runLimited(
    runs,
    JENKINS_CONCURRENCY,
    async run => {
      try {
        const build = await fetchJson<JenkinsBuildApi>(
          jenkinsApiUrl(onOrigin(run.url, run.jobUrl), treeApiSuffix(buildDetailTree())),
          username,
          token,
          signal,
        );
        out.push(
          mapRun(
            { url: run.jobUrl, label: run.jobLabel, ...(run.branch ? { branch: run.branch } : {}) },
            build,
            run.headSha,
          ),
        );
      } catch (err) {
        if (isAbortError(err, signal)) throw err;
        firstError ??= bannerOrFallback(err, JENKINS_BANNER.fetchFailed, "Jenkins");
        failure ??= failureOf(err);
      }
    },
    signal,
  );
  return { data: out, error: firstError, failure };
}

export async function fetchJenkinsDataForSHAs(
  jobs: JenkinsJobConfig[],
  username: string | undefined,
  token: string,
  shas: string[],
  opts: { signal?: AbortSignal; buildLimit?: number; preferredBranches?: ReadonlySet<string> } = {},
): Promise<JenkinsListedBuilds> {
  const buildLimit = opts.buildLimit ?? 20;
  const wanted = new Set(shas.map(s => s.toLowerCase()));
  const runs: JenkinsRun[] = [];
  const resolved = await resolveJenkinsJobs(
    jobs,
    username,
    token,
    opts.signal,
    buildRefsTree(buildLimit),
    opts.preferredBranches,
  );
  let firstError = resolved.error;
  let failure = resolved.failure;
  await runLimited(
    resolved.jobs,
    JENKINS_CONCURRENCY,
    async job => {
      try {
        const api =
          resolved.rootData.get(normalizeJenkinsJobUrl(job.url)) ??
          (await fetchJson<JenkinsJobApi>(
            jenkinsApiUrl(job.url, treeApiSuffix(buildRefsTree(buildLimit))),
            username,
            token,
            opts.signal,
          ));
        const builds = api.builds ?? (api.lastBuild ? [api.lastBuild] : []);
        await runLimited(
          builds.slice(0, buildLimit),
          JENKINS_CONCURRENCY,
          async ref => {
            try {
              if (!ref.number && !ref.url) return;
              const buildUrl = ref.url
                ? jenkinsApiUrl(onOrigin(ref.url, job.url), treeApiSuffix(buildDetailTree()))
                : jenkinsApiUrl(`${job.url}/${ref.number}`, treeApiSuffix(buildDetailTree()));
              const build = await fetchJson<JenkinsBuildApi>(buildUrl, username, token, opts.signal);
              for (const sha of matchingHeadShas(build, wanted)) runs.push(mapRun(job, build, sha));
            } catch (err) {
              if (isAbortError(err, opts.signal)) throw err;
              firstError ??= bannerOrFallback(err, JENKINS_BANNER.fetchFailed, "Jenkins");
              failure ??= failureOf(err);
            }
          },
          opts.signal,
        );
      } catch (err) {
        if (isAbortError(err, opts.signal)) throw err;
        firstError ??= bannerOrFallback(err, JENKINS_BANNER.fetchFailed, "Jenkins");
        failure ??= failureOf(err);
      }
    },
    opts.signal,
  );
  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    data: runs,
    error: firstError,
    failure,
    jobUrls: resolved.jobs.map(job => normalizeJenkinsJobUrl(job.url)),
    discoveryComplete: resolved.complete,
    discoveryTruncated: resolved.truncated,
    branchJobs: resolved.branchJobs,
    lastBuilds: new Map<string, number>(),
  };
}

/** A last build's number once it has finished; null while it builds (or without one). */
function settledNumber(build: { number?: number; building?: boolean } | null | undefined): number | null {
  return typeof build?.number === "number" && !build.building ? build.number : null;
}

export async function fetchJenkinsGraphDataForSHAs(
  jobs: JenkinsJobConfig[],
  username: string | undefined,
  token: string,
  shas: string[],
  opts: {
    signal?: AbortSignal;
    buildLimit?: number;
    knownLastBuilds?: ReadonlyMap<string, number>;
    preferredBranches?: ReadonlySet<string>;
  } = {},
): Promise<JenkinsListedBuilds> {
  const buildLimit = opts.buildLimit ?? 20;
  const wanted = new Set(shas.map(s => s.toLowerCase()));
  const runs: JenkinsRun[] = [];
  const lastBuilds = new Map<string, number>();
  const probeOnly = !!opts.knownLastBuilds && opts.knownLastBuilds.size > 0;
  const resolved = await resolveJenkinsJobs(
    jobs,
    username,
    token,
    opts.signal,
    probeOnly ? lastBuildTree() : shallowGraphTree(buildLimit),
    opts.preferredBranches,
  );
  let firstError = resolved.error;
  let failure = resolved.failure;
  await runLimited(
    resolved.jobs,
    JENKINS_CONCURRENCY,
    async job => {
      try {
        const url = normalizeJenkinsJobUrl(job.url);
        const probed = resolved.rootData.get(url);
        // Unchanged since the last fetch, and finished: nothing new to list.
        const lastNumber = settledNumber(probed ? probed.lastBuild : resolved.branchLastBuilds.get(url));
        if (lastNumber !== null && opts.knownLastBuilds?.get(url) === lastNumber) {
          lastBuilds.set(url, lastNumber);
          return;
        }
        const api =
          !probeOnly && probed
            ? probed
            : await fetchJson<JenkinsJobApi>(
                jenkinsApiUrl(job.url, treeApiSuffix(shallowGraphTree(buildLimit))),
                username,
                token,
                opts.signal,
              );
        // Only a job whose listed builds have all finished is remembered: one still building (the last or an earlier
        // one) may not have checked out its commit yet, so its job is listed again next time.
        const listed = settledNumber(api.lastBuild);
        if (listed !== null && !(api.builds ?? []).some(build => build.building)) lastBuilds.set(url, listed);
        const builds = api.builds ?? [];
        for (const build of builds) {
          for (const sha of matchingHeadShas(build, wanted)) runs.push(mapRun(job, build, sha));
        }
      } catch (err) {
        if (isAbortError(err, opts.signal)) throw err;
        firstError ??= bannerOrFallback(err, JENKINS_BANNER.fetchFailed, "Jenkins");
        failure ??= failureOf(err);
      }
    },
    opts.signal,
  );
  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    data: runs,
    error: firstError,
    failure,
    jobUrls: resolved.jobs.map(job => normalizeJenkinsJobUrl(job.url)),
    discoveryComplete: resolved.complete,
    discoveryTruncated: resolved.truncated,
    branchJobs: resolved.branchJobs,
    lastBuilds,
  };
}

/** At most this many failed tests are kept and listed; the counts still say how many failed. */
const MAX_FAILED_TESTS = 50;
const TEST_REPORT_TREE =
  "failCount,passCount,skipCount,suites[cases[className,name,status,errorDetails,errorStackTrace]]";

/**
 * A finished build's JUnit test report. Null when the build has none (404) or it could not be read: the build still
 * shows, only without a Tests row.
 */
export async function fetchJenkinsTestReport(
  run: JenkinsRun,
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<JenkinsTestReport | null | undefined> {
  try {
    const url = jenkinsApiUrl(
      onOrigin(run.url, run.jobUrl),
      `testReport/api/json?tree=${encodeURIComponent(TEST_REPORT_TREE)}`,
    );
    if (!isSafeJenkinsRequestUrl(url)) return null;
    const res = await fetchWithRetry(url, { headers: authHeaders(username, token), signal, redirect: "manual" });
    // Most builds have no report: that is no error, so Debug stays quiet about it.
    if (res.status === 404) return null;
    // Not read: unknown rather than none, so it is asked for again.
    if (!res.ok || /text\/html/i.test(res.headers.get("content-type") ?? "")) {
      debugError("Jenkins", `${res.status} ${res.statusText} ${url}`);
      return undefined;
    }
    const report = (await res.json()) as {
      failCount?: number;
      passCount?: number;
      skipCount?: number;
      suites?: { cases?: Record<string, unknown>[] }[];
    };
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
    const failed = (report.suites ?? [])
      .flatMap(suite => suite.cases ?? [])
      .filter(test => test.status === "FAILED" || test.status === "REGRESSION")
      .slice(0, MAX_FAILED_TESTS)
      .map(
        (test): JenkinsFailedTest => ({
          className: typeof test.className === "string" ? test.className : "",
          name: typeof test.name === "string" ? test.name : "test",
          details: text(test.errorDetails),
          stackTrace: text(test.errorStackTrace),
        }),
      );
    return {
      passCount: report.passCount ?? 0,
      failCount: report.failCount ?? failed.length,
      skipCount: report.skipCount ?? 0,
      failed,
    };
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    return undefined;
  }
}

export async function fetchJenkinsRunJobs(
  run: JenkinsRun,
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<{ jobs: JenkinsJob[]; error: string | null; failure?: ProviderFailure }> {
  try {
    const wfapi = await fetchJson<JenkinsWfapiDescribe>(
      jenkinsApiUrl(onOrigin(run.url, run.jobUrl), "wfapi/describe"),
      username,
      token,
      signal,
    );
    const stages: JenkinsStage[] = (wfapi.stages ?? []).map(stage => {
      const mapped = mapWfapiStatus(stage.status);
      const startedAt = stage.startTimeMillis ? new Date(stage.startTimeMillis).toISOString() : null;
      const completedAt =
        stage.startTimeMillis != null && stage.durationMillis != null
          ? new Date(stage.startTimeMillis + stage.durationMillis).toISOString()
          : null;
      return {
        id: stage.id ?? stage.name ?? "stage",
        name: stage.name ?? "stage",
        status: mapped.status,
        conclusion: mapped.conclusion,
        startedAt,
        completedAt,
      };
    });
    const wfapiStartedAt = wfapi.startTimeMillis ? new Date(wfapi.startTimeMillis).toISOString() : null;
    const wfapiCompletedAt =
      wfapi.startTimeMillis != null && wfapi.durationMillis != null
        ? new Date(wfapi.startTimeMillis + wfapi.durationMillis).toISOString()
        : null;
    const job: JenkinsJob = {
      id: run.id,
      name: "Pipeline",
      status: run.status,
      conclusion: run.conclusion,
      startedAt: wfapiStartedAt ?? run.startedAt,
      completedAt: wfapiCompletedAt,
      steps: stages,
    };
    // Reports are written when the build ends, so only a finished build is asked for one.
    const tests = run.status === "completed" ? await fetchJenkinsTestReport(run, username, token, signal) : undefined;
    return { jobs: [tests === undefined ? job : { ...job, tests }], error: null };
  } catch (err) {
    if (isAbortError(err, signal)) throw err;
    // Like GitHub's "jobs failed": say which part failed, not a generic fetch failure.
    return { jobs: [], error: bannerOrFallback(err, JENKINS_BANNER.stagesFailed, "Jenkins"), failure: failureOf(err) };
  }
}

export async function fetchJenkinsConsoleLog(
  run: JenkinsRun,
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${normalizeJenkinsJobUrl(onOrigin(run.url, run.jobUrl))}/consoleText`;
  // A failed request throws its banner so the log dialog can say why; "" is a build without output.
  if (!isSafeJenkinsRequestUrl(url)) throw new Error(JENKINS_BANNER.invalidJobUrl);
  const res = await fetchWithRetry(url, {
    headers: authHeaders(username, token),
    signal,
  });
  if (res.status === 401) throw new ProviderAuthError(JENKINS_BANNER.tokenExpired);
  if (!res.ok) {
    debugError("Jenkins", `${res.status} ${res.statusText} ${url}`);
    throw new Error(JENKINS_BANNER.logFailed);
  }
  return res.text();
}
