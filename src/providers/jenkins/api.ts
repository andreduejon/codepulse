import type { GraphBadge } from "../provider";
import { fetchWithRetry as fetchWithRetryPolicy, runLimited } from "../shared/http";
import { categorize } from "../shared/status";
import type { JenkinsCommitData, JenkinsJob, JenkinsJobConfig, JenkinsRun, JenkinsStage } from "./types";

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
  displayName?: string;
  builds?: JenkinsBuildApi[];
  lastBuild?: { number?: number; url?: string } | null;
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
  timeoutMessage: `Jenkins request timed out after ${JENKINS_REQUEST_TIMEOUT_MS}ms`,
};

async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithRetryPolicy(url, init, JENKINS_HTTP_POLICY);
}

function treeApiSuffix(tree: string): string {
  return `api/json?tree=${encodeURIComponent(tree)}`;
}

function shallowGraphTree(limit: number): string {
  return `builds[number,url,result,building,timestamp,duration,actions[lastBuiltRevision[SHA1]],changeSets[items[commitId,id]],changeSet[items[commitId,id]]]{0,${limit}}`;
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

function authHeaders(username: string | undefined, token: string): Record<string, string> {
  if (!username) throw new Error("Jenkins username is required for token authentication");
  return { Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}` };
}

function isJenkinsLoginRedirect(location: string | null): boolean {
  return !!location && /securityRealm\/commenceLogin/i.test(location);
}

function jenkinsAuthError(): Error {
  return new Error("Jenkins authentication failed. Verify username, token, and complete browser login if required.");
}

async function fetchJson<T>(
  url: string,
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithRetry(url, { headers: authHeaders(username, token), signal, redirect: "manual" });
  if (res.status >= 300 && res.status < 400 && isJenkinsLoginRedirect(res.headers.get("location"))) {
    throw jenkinsAuthError();
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`Jenkins ${res.status}: ${res.statusText}`);
  if (/text\/html/i.test(contentType)) throw jenkinsAuthError();
  return (await res.json()) as T;
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

export function extractCandidateShas(raw: unknown): string[] {
  const shas = new Set<string>();
  collectShas(raw, shas);
  return [...shas];
}

function mapStatus(build: JenkinsBuildApi): Pick<JenkinsRun, "status" | "conclusion"> {
  if (build.building) return { status: "running", conclusion: null };
  const result = (build.result ?? "UNKNOWN").toLowerCase();
  return { status: "completed", conclusion: result };
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
    url: build.url ?? `${normalizeJenkinsJobUrl(job.url)}/${number}`,
    jobLabel: label,
    jobUrl: normalizeJenkinsJobUrl(job.url),
    ...status,
  };
}

export async function fetchJenkinsDataForSHAs(
  jobs: JenkinsJobConfig[],
  username: string | undefined,
  token: string,
  shas: string[],
  opts: { signal?: AbortSignal; buildLimit?: number } = {},
): Promise<{ data: JenkinsRun[]; error: string | null }> {
  const buildLimit = opts.buildLimit ?? 20;
  const wanted = new Set(shas.map(s => s.toLowerCase()));
  const runs: JenkinsRun[] = [];
  let firstError: string | null = null;
  await Promise.all(
    jobs.map(async job => {
      try {
        const api = await fetchJson<JenkinsJobApi>(
          jenkinsApiUrl(job.url, treeApiSuffix(buildRefsTree(buildLimit))),
          username,
          token,
          opts.signal,
        );
        const builds = api.builds ?? (api.lastBuild ? [api.lastBuild] : []);
        await runLimited(builds.slice(0, buildLimit), JENKINS_CONCURRENCY, async ref => {
          if (!ref.number && !ref.url) return;
          const buildUrl = ref.url
            ? jenkinsApiUrl(ref.url, treeApiSuffix(buildDetailTree()))
            : jenkinsApiUrl(`${job.url}/${ref.number}`, treeApiSuffix(buildDetailTree()));
          const build = await fetchJson<JenkinsBuildApi>(buildUrl, username, token, opts.signal);
          const sha = extractSha(build);
          if (sha && wanted.has(sha.toLowerCase())) runs.push(mapRun(job, build, sha));
        });
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : String(err);
      }
    }),
  );
  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { data: runs, error: firstError };
}

export async function fetchJenkinsGraphDataForSHAs(
  jobs: JenkinsJobConfig[],
  username: string | undefined,
  token: string,
  shas: string[],
  opts: { signal?: AbortSignal; buildLimit?: number } = {},
): Promise<{ data: JenkinsRun[]; error: string | null }> {
  const buildLimit = opts.buildLimit ?? 20;
  const wanted = new Set(shas.map(s => s.toLowerCase()));
  const runs: JenkinsRun[] = [];
  let firstError: string | null = null;
  await Promise.all(
    jobs.map(async job => {
      try {
        const api = await fetchJson<JenkinsJobApi>(
          jenkinsApiUrl(job.url, treeApiSuffix(shallowGraphTree(buildLimit))),
          username,
          token,
          opts.signal,
        );
        const builds = api.builds ?? [];
        for (const build of builds) {
          const exactSha = extractSha(build);
          if (exactSha && wanted.has(exactSha.toLowerCase())) {
            runs.push(mapRun(job, build, exactSha));
            continue;
          }

          const fallbackMatches = extractCandidateShas(build.actions)
            .map(sha => ({ sha, lower: sha.toLowerCase() }))
            .filter(({ lower }) => wanted.has(lower));
          const uniqueMatches = [...new Set(fallbackMatches.map(({ sha }) => sha))];

          // Ambiguous multi-SCM build: better show nothing than attach same run to
          // multiple commits in the graph.
          if (uniqueMatches.length === 1) runs.push(mapRun(job, build, uniqueMatches[0]));
        }
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : String(err);
      }
    }),
  );
  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { data: runs, error: firstError };
}

export function buildJenkinsCommitDataMap(runs: JenkinsRun[], resolved: boolean): Map<string, JenkinsCommitData> {
  const map = new Map<string, JenkinsCommitData>();
  for (const run of runs) {
    const existing = map.get(run.headSha) ?? { sha: run.headSha, runs: [], resolved };
    existing.runs.push(run);
    existing.resolved = resolved;
    map.set(run.headSha, existing);
  }
  for (const data of map.values()) data.runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return map;
}

export function buildJenkinsGraphBadges(runs: JenkinsRun[]): Map<string, GraphBadge> {
  const map = new Map<string, GraphBadge>();
  for (const run of runs) {
    const badge = map.get(run.headSha) ?? {
      sha: run.headSha,
      badge: "unknown" as const,
      passCount: 0,
      failCount: 0,
      runningCount: 0,
      latestRunAt: run.updatedAt,
      latestStatus: "unknown" as const,
    };
    const category = categorize(run.status, run.conclusion);
    if (category === "running") badge.runningCount++;
    else if (category === "pass") badge.passCount++;
    else if (category === "fail") badge.failCount++;
    if (run.updatedAt >= badge.latestRunAt) {
      badge.latestRunAt = run.updatedAt;
      badge.latestStatus = category === "pass" || category === "fail" || category === "running" ? category : "unknown";
    }
    badge.badge =
      badge.failCount > 0 ? "fail" : badge.runningCount > 0 ? "running" : badge.passCount > 0 ? "pass" : "unknown";
    map.set(run.headSha, badge);
  }
  return map;
}

export async function fetchJenkinsRunJobs(
  run: JenkinsRun,
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<{ jobs: JenkinsJob[]; error: string | null }> {
  try {
    const wfapi = await fetchJson<JenkinsWfapiDescribe>(
      jenkinsApiUrl(run.url, "wfapi/describe"),
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
      name: "build",
      status: run.status,
      conclusion: run.conclusion,
      startedAt: wfapiStartedAt ?? run.startedAt,
      completedAt: wfapiCompletedAt,
      steps: stages,
    };
    return { jobs: [job], error: null };
  } catch (err) {
    return { jobs: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchJenkinsConsoleLog(
  run: JenkinsRun,
  username: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchWithRetry(`${normalizeJenkinsJobUrl(run.url)}/consoleText`, {
    headers: authHeaders(username, token),
    signal,
  });
  if (!res.ok) return "";
  return res.text();
}
