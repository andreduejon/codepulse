/**
 * GitHub Actions provider — API client and utility functions.
 *
 * All functions in this module are pure (no SolidJS reactivity) so they
 * are straightforward to unit-test.  The reactive hook (use-github-ci.ts)
 * calls these functions and manages caching/signals.
 */

import type { GraphBadge } from "../../providers/provider";
import { fetchWithRetry as fetchWithRetryPolicy } from "../shared/http";
import { categorize } from "./status";
import type {
  GitHubApiJob,
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubRepo,
  GitHubResult,
  GitHubStep,
  GitHubWorkflowRun,
} from "./types";

// ── Remote URL parsing ────────────────────────────────────────────────────

/**
 * Parse a GitHub (or GitHub Enterprise) repository's `owner`, `repo`, and
 * `hostname` from a git remote URL.
 *
 * Supported formats (any hostname):
 *   https://<host>/owner/repo[.git][/]
 *   git@<host>:owner/repo[.git]
 *   ssh://[git@]<host>/owner/repo[.git][/]
 *
 * Returns `null` for URLs that do not match the owner/repo path pattern,
 * or any malformed input.
 */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  if (!url) return null;

  const trimmed = url.trim();

  // HTTPS: https://<host>/owner/repo[.git][/]
  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    const hostname = httpsMatch[1];
    const owner = httpsMatch[2];
    const repo = httpsMatch[3];
    if (hostname && owner && repo) return { hostname, owner, repo };
  }

  // SSH scp-style: git@<host>:owner/repo[.git]
  const sshScpMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshScpMatch) {
    const hostname = sshScpMatch[1];
    const owner = sshScpMatch[2];
    const repo = sshScpMatch[3];
    if (hostname && owner && repo) return { hostname, owner, repo };
  }

  // SSH protocol: ssh://[git@]<host>/owner/repo[.git][/]
  const sshProtoMatch = trimmed.match(/^ssh:\/\/(?:git@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshProtoMatch) {
    const hostname = sshProtoMatch[1];
    const owner = sshProtoMatch[2];
    const repo = sshProtoMatch[3];
    if (hostname && owner && repo) return { hostname, owner, repo };
  }

  return null;
}

/**
 * Normalize a user-entered GitHub host. Accepts host or host:port only.
 * Rejects protocols, paths, auth, query/hash, and whitespace.
 */
export function normalizeGitHubHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes("://") || /[/?#@\s]/.test(trimmed)) return null;

  try {
    const url = new URL(`https://${trimmed}`);
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    if (url.hostname !== "github.com" && !url.hostname.includes(".")) return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedGitHubHost(hostname: string, trustedEnterpriseHost: string | null = null): boolean {
  const normalized = normalizeGitHubHost(hostname);
  if (!normalized) return false;
  if (normalized === "github.com") return true;
  return trustedEnterpriseHost != null && normalizeGitHubHost(trustedEnterpriseHost) === normalized;
}

// ── Authentication ────────────────────────────────────────────────────────

/**
 * Determine whether a token is available for display purposes.
 *
 * @returns `"env"` when the env var is set, or `null` when no token is available.
 */
export function getTokenSource(envVarName: string): "env" | null {
  const envVal = process.env[envVarName];
  return envVal?.trim() ? "env" : null;
}

/**
 * Read a GitHub Personal Access Token from the environment variable.
 * Returns `null` when the env var is not set or empty.
 */
export function getGitHubToken(envVarName: string): string | null {
  const val = process.env[envVarName];
  return val?.trim() ? val.trim() : null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

const GITHUB_REQUEST_TIMEOUT_MS = 20_000;
const GITHUB_HTTP_POLICY = {
  timeoutMs: GITHUB_REQUEST_TIMEOUT_MS,
  attempts: 2,
  retryDelayMs: 500,
  timeoutMessage: `GitHub request timed out after ${GITHUB_REQUEST_TIMEOUT_MS}ms`,
};

function createHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function apiBase(repo: GitHubRepo): string {
  if (repo.hostname === "github.com") {
    return `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  }
  // GitHub Enterprise Server uses /api/v3 prefix
  return `https://${repo.hostname}/api/v3/repos/${repo.owner}/${repo.repo}`;
}

function graphqlEndpoint(repo: GitHubRepo): string {
  if (repo.hostname === "github.com") {
    return "https://api.github.com/graphql";
  }
  // GitHub Enterprise Server uses /api/graphql
  return `https://${repo.hostname}/api/graphql`;
}

function describeHttpError(res: Response, fallback: string): string {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 429 || (res.status === 403 && remaining === "0")) {
    const reset = res.headers.get("x-ratelimit-reset");
    if (reset) {
      const resetDate = new Date(Number(reset) * 1000);
      if (!Number.isNaN(resetDate.getTime()))
        return `GitHub rate limit exceeded; resets ${resetDate.toLocaleTimeString()}`;
    }
    return "GitHub rate limit exceeded";
  }
  return fallback;
}

async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithRetryPolicy(url, init, GITHUB_HTTP_POLICY);
}

// ── Status mapping ────────────────────────────────────────────────────────

/**
 * Map a GitHub run's `status` + `conclusion` to the simplified badge value
 * used across the provider boundary.
 *
 * Note: `cancelled` maps to `"unknown"` (not counted as failure) to avoid
 * inflating fail counts when a user manually cancels a run.
 */
export function mapRunToBadge(status: string, conclusion: string | null): GraphBadge["badge"] {
  const cat = categorize(status, conclusion);
  switch (cat) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "running":
      return "running";
    default:
      return "unknown";
  }
}

// ── Response mapping ──────────────────────────────────────────────────────

function mapApiJob(j: GitHubApiJob): GitHubJob {
  return {
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    startedAt: j.started_at ?? null,
    completedAt: j.completed_at ?? null,
    steps: (j.steps ?? []).map(
      (s): GitHubStep => ({
        name: s.name,
        status: s.status,
        conclusion: s.conclusion,
        number: s.number,
        startedAt: s.started_at ?? null,
        completedAt: s.completed_at ?? null,
      }),
    ),
  };
}

// ── Badge aggregation ─────────────────────────────────────────────────────

/**
 * Aggregate all runs for a single SHA into a GraphBadge.
 *
 * Worst-status wins for the top-level `badge` field:
 *   fail > running > pass > unknown
 *
 * Counts are the raw number of runs in each category.
 * `latestRunAt` / `latestStatus` refer to the most-recently-updated run.
 */
export function aggregateRunsToGraphBadge(sha: string, runs: GitHubWorkflowRun[]): GraphBadge {
  let passCount = 0;
  let failCount = 0;
  let runningCount = 0;
  let unknownCount = 0;

  // Find the most recently updated run
  let latestRun: GitHubWorkflowRun | null = null;
  for (const run of runs) {
    const badge = mapRunToBadge(run.status, run.conclusion);
    switch (badge) {
      case "pass":
        passCount++;
        break;
      case "fail":
        failCount++;
        break;
      case "running":
        runningCount++;
        break;
      default:
        unknownCount++;
    }
    if (!latestRun || run.updatedAt > latestRun.updatedAt) {
      latestRun = run;
    }
  }

  // Worst-status wins
  let badge: GraphBadge["badge"] = "unknown";
  if (passCount > 0 && failCount === 0 && runningCount === 0 && unknownCount === 0) {
    badge = "pass";
  } else if (failCount > 0) {
    badge = "fail";
  } else if (runningCount > 0) {
    badge = "running";
  } else if (passCount > 0) {
    badge = "pass";
  }

  const latestStatus: GraphBadge["latestStatus"] = latestRun
    ? mapRunToBadge(latestRun.status, latestRun.conclusion)
    : "unknown";

  return {
    sha,
    badge,
    passCount,
    failCount,
    runningCount,
    latestRunAt: latestRun?.updatedAt ?? "",
    latestStatus,
  };
}

/**
 * Group an array of workflow runs by commit SHA and build GraphBadges.
 * Returns a Map<sha, GraphBadge> suitable for storing in state.graphBadges.
 */
export function buildGraphBadges(runs: GitHubWorkflowRun[]): Map<string, GraphBadge> {
  // Group by SHA
  const bySha = new Map<string, GitHubWorkflowRun[]>();
  for (const run of runs) {
    const existing = bySha.get(run.headSha);
    if (existing) {
      existing.push(run);
    } else {
      bySha.set(run.headSha, [run]);
    }
  }

  // Aggregate each SHA's runs into a badge
  const badges = new Map<string, GraphBadge>();
  for (const [sha, shaRuns] of bySha) {
    badges.set(sha, aggregateRunsToGraphBadge(sha, shaRuns));
  }
  return badges;
}

/**
 * Group an array of workflow runs by commit SHA.
 * Returns a Map<sha, GitHubCommitData> for the detail panel.
 */
export function buildCommitDataMap(runs: GitHubWorkflowRun[]): Map<string, GitHubCommitData> {
  const map = new Map<string, GitHubCommitData>();
  for (const run of runs) {
    const existing = map.get(run.headSha);
    if (existing) {
      existing.runs.push(run);
    } else {
      map.set(run.headSha, { sha: run.headSha, runs: [run] });
    }
  }
  // Sort each SHA's runs newest-first
  for (const data of map.values()) {
    data.runs.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  }
  return map;
}

// ── GraphQL types ─────────────────────────────────────────────────────────

/** Raw GraphQL CheckSuite node (maps to a single workflow run). */
interface GqlCheckSuite {
  status: string;
  conclusion: string | null;
  workflowRun: {
    databaseId: number;
    runNumber: number;
    url?: string;
    event: string;
    createdAt: string;
    updatedAt: string;
    workflow: { name: string };
  } | null;
}

/** A single commit object returned by the aliased object(oid:) query. */
interface GqlCommitObject {
  oid: string;
  checkSuites: {
    nodes: GqlCheckSuite[];
  } | null;
}

/** Shape of the batched object(oid:) GraphQL query result. */
interface GqlBatchQueryResult {
  data?: {
    repository?: Record<string, GqlCommitObject | null> | null;
  };
  errors?: Array<{ message: string }>;
}

// ── GraphQL status mapping ─────────────────────────────────────────────────

/**
 * Map GraphQL CheckSuite / CheckRun status/conclusion (UPPER_SNAKE_CASE) to
 * the normalised lower-case strings used by the REST mapper and badge logic.
 *
 * GraphQL enums:  IN_PROGRESS, QUEUED, COMPLETED  (status)
 *                 SUCCESS, FAILURE, CANCELLED, TIMED_OUT, SKIPPED,
 *                 NEUTRAL, ACTION_REQUIRED, STALE  (conclusion)
 */
function gqlNormalise(status: string, conclusion: string | null): { status: string; conclusion: string | null } {
  return { status: status.toLowerCase(), conclusion: conclusion ? conclusion.toLowerCase() : null };
}

function mapGqlCheckSuiteToRun(suite: GqlCheckSuite, sha: string): GitHubWorkflowRun | null {
  // Suites without a workflowRun are non-Actions checks (e.g. Dependabot) — skip.
  if (!suite.workflowRun) return null;
  const wr = suite.workflowRun;
  const { status, conclusion } = gqlNormalise(suite.status, suite.conclusion);
  return {
    id: wr.databaseId,
    name: wr.workflow.name || "(unnamed)",
    url: wr.url,
    status,
    conclusion,
    headSha: sha,
    event: wr.event,
    runNumber: wr.runNumber,
    startedAt: wr.createdAt,
    updatedAt: wr.updatedAt,
  };
}

// ── GraphQL API fetch ──────────────────────────────────────────────────────

/**
 * Maximum number of SHAs per GraphQL batch request.
 * Node budget: 100 SHAs × 10 check-suites × 20 check-runs = 20,000 nodes,
 * well under GitHub's 500K limit.  Steps are not included in the batch query
 * (fetched on demand via fetchRunJobs) to keep the node count low.
 */
export const GQL_BATCH_SIZE = 100;

/**
 * Inline fragment shared by every aliased commit object.
 *
 * Node budget per SHA: 10 check-suites (scalars only, no checkRuns connection).
 * At GQL_BATCH_SIZE=100: 100 × 10 = 1,000 nodes — ~1-2 rate-limit points.
 *
 * checkRuns intentionally omitted — jobs are fetched on demand via fetchRunJobs
 * (REST) when the user expands a run in the Actions tab.
 */
const COMMIT_FRAGMENT = `
... on Commit {
  oid
  checkSuites(first: 10) {
    nodes {
      status
      conclusion
      workflowRun {
        databaseId
        runNumber
        event
        createdAt
        updatedAt
        url
        workflow { name }
      }
    }
  }
}`.trim();

/**
 * Build a GraphQL query string that fetches check suites for up to
 * GQL_BATCH_SIZE commit SHAs using aliased `object(oid:)` fields.
 *
 * Each alias is `c<index>` so the response keys are predictable.
 * Works for any commit on any branch — no branch restriction.
 */
function buildBatchQuery(shas: string[]): string {
  const aliases = shas.map((sha, i) => `  c${i}: object(oid: "${sha}") { ${COMMIT_FRAGMENT} }`).join("\n");
  return `query CIBatch($owner: String!, $repo: String!) {\n  repository(owner: $owner, name: $repo) {\n${aliases}\n  }\n}`;
}

export type GraphQLFetchResult = GitHubResult<GitHubWorkflowRun[]>;

/**
 * Fetch CI check-suite data for a batch of commit SHAs using the GitHub
 * GraphQL API.  Works for commits on ANY branch — not limited to a single
 * branch's history.
 *
 * Callers should split large SHA arrays into chunks of ≤ GQL_BATCH_SIZE
 * before calling this function.
 *
 * Returns runs + pre-populated jobs map in a single HTTP request.
 * Falls back gracefully on errors (returns empty result, never throws).
 */
export async function fetchCIDataForSHAs(
  repo: GitHubRepo,
  token: string,
  shas: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<GraphQLFetchResult> {
  const { signal } = opts;
  const empty: GraphQLFetchResult = { data: [], error: null };
  if (shas.length === 0) return empty;

  try {
    const res = await fetchWithRetry(graphqlEndpoint(repo), {
      method: "POST",
      headers: { ...createHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        query: buildBatchQuery(shas),
        variables: { owner: repo.owner, repo: repo.repo },
      }),
      signal,
    });

    if (!res.ok) {
      const msg = describeHttpError(res, `GraphQL HTTP ${res.status}`);
      console.error(`[github-actions] ${msg} for ${repo.owner}/${repo.repo}`);
      return { ...empty, error: msg };
    }

    const json = (await res.json()) as GqlBatchQueryResult;

    if (json.errors?.length) {
      const msg = json.errors.map(e => e.message).join("; ");
      console.error("[github-actions] GraphQL errors:", msg);
      return { ...empty, error: msg };
    }

    const repoData = json.data?.repository ?? {};
    const runs: GitHubWorkflowRun[] = [];

    // Iterate alias keys c0, c1, … in the same order as the input shas array
    for (let i = 0; i < shas.length; i++) {
      const commitObj = repoData[`c${i}`];
      if (!commitObj) continue; // SHA not found or not a Commit object
      const sha = commitObj.oid;
      for (const suite of commitObj.checkSuites?.nodes ?? []) {
        const run = mapGqlCheckSuiteToRun(suite, sha);
        if (!run) continue;
        runs.push(run);
      }
    }

    return { data: runs, error: null };
  } catch (err) {
    if (signal?.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[github-actions] GraphQL fetch error:", err);
    return { ...empty, error: msg };
  }
}

// ── REST API calls ────────────────────────────────────────────────────────

/**
 * Fetch all jobs (with steps) for a single workflow run.
 *
 * Returns an explicit error on API failures so the UI doesn't confuse a failed
 * request with a real empty job list.
 */
export async function fetchRunJobs(
  repo: GitHubRepo,
  token: string,
  runId: number,
  signal?: AbortSignal,
): Promise<GitHubJobFetchResult> {
  const url = `${apiBase(repo)}/actions/runs/${runId}/jobs?per_page=100`;
  const headers = createHeaders(token);

  try {
    const res = await fetchWithRetry(url, { headers, signal });
    if (!res.ok) {
      const error = describeHttpError(res, `Jobs HTTP ${res.status}`);
      console.error(`[github-actions] fetchRunJobs: ${error} for run ${runId}`);
      return { jobs: [], error };
    }
    const json = (await res.json()) as { jobs?: GitHubApiJob[] };
    return { jobs: (json.jobs ?? []).map(mapApiJob), error: null };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error("[github-actions] fetchRunJobs: network error:", err);
    return { jobs: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fetch the plain-text log output for a single job.
 *
 * The GitHub API returns a redirect to a temporary pre-signed URL for the log
 * content.  We follow the redirect and return the raw text.
 *
 * Returns an empty string (never throws) on any error.
 */
export async function fetchJobLog(
  repo: GitHubRepo,
  token: string,
  jobId: number,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${apiBase(repo)}/actions/jobs/${jobId}/logs`;
  const headers = createHeaders(token);

  try {
    // GitHub redirects to a pre-signed S3/Azure URL — follow the redirect
    const res = await fetchWithRetry(url, { headers, signal, redirect: "follow" });
    if (!res.ok) {
      const error = describeHttpError(res, `Logs HTTP ${res.status}`);
      console.error(`[github-actions] fetchJobLog: ${error} for job ${jobId}`);
      return "";
    }
    return await res.text();
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error("[github-actions] fetchJobLog: network error:", err);
    return "";
  }
}
