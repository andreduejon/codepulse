/**
 * GitHub Actions provider — API client and utility functions.
 *
 * All functions in this module are pure (no SolidJS reactivity) so they
 * are straightforward to unit-test.  The reactive hook (use-github-ci.ts)
 * calls these functions and manages caching/signals.
 */

import type { GraphBadge } from "../../providers/provider";
import type {
  GitHubApiJob,
  GitHubApiRun,
  GitHubCommitData,
  GitHubJob,
  GitHubRepo,
  GitHubStep,
  GitHubWorkflowRun,
} from "./types";

// ── Remote URL parsing ────────────────────────────────────────────────────

/**
 * Parse a GitHub repository's `owner` and `repo` from a git remote URL.
 *
 * Supported formats:
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *   git@github.com:owner/repo.git
 *   git@github.com:owner/repo
 *   ssh://git@github.com/owner/repo.git
 *   ssh://git@github.com/owner/repo
 *
 * Returns `null` for non-GitHub URLs (GitLab, Bitbucket, self-hosted, …)
 * or any malformed input.
 */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  if (!url) return null;

  const trimmed = url.trim();

  // HTTPS: https://github.com/owner/repo[.git][/]
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const repo = httpsMatch[2];
    if (owner && repo) return { owner, repo };
  }

  // SSH scp-style: git@github.com:owner/repo[.git]
  const sshScpMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshScpMatch) {
    const owner = sshScpMatch[1];
    const repo = sshScpMatch[2];
    if (owner && repo) return { owner, repo };
  }

  // SSH protocol: ssh://git@github.com/owner/repo[.git][/]
  const sshProtoMatch = trimmed.match(/^ssh:\/\/(?:git@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshProtoMatch) {
    const owner = sshProtoMatch[1];
    const repo = sshProtoMatch[2];
    if (owner && repo) return { owner, repo };
  }

  return null;
}

// ── Authentication ────────────────────────────────────────────────────────

/**
 * Read a GitHub Personal Access Token from an environment variable.
 * Returns `null` when the variable is absent or empty.
 */
export function getGitHubToken(envVarName: string): string | null {
  const val = process.env[envVarName];
  return val?.trim() ? val.trim() : null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

function createHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function apiBase(repo: GitHubRepo): string {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
}

// ── Status mapping ────────────────────────────────────────────────────────

/**
 * Map a GitHub run's `status` + `conclusion` to the simplified badge value
 * used across the provider boundary.
 */
export function mapRunToBadge(status: string, conclusion: string | null): GraphBadge["badge"] {
  if (status !== "completed") {
    // in_progress, queued, waiting, requested, pending
    return "running";
  }
  switch (conclusion) {
    case "success":
      return "pass";
    case "failure":
    case "cancelled":
    case "timed_out":
    case "startup_failure":
      return "fail";
    case "skipped":
    case "neutral":
    case "action_required":
    case "stale":
      return "unknown";
    default:
      return "unknown";
  }
}

// ── Response mapping ──────────────────────────────────────────────────────

function mapApiRun(r: GitHubApiRun): GitHubWorkflowRun {
  return {
    id: r.id,
    name: r.name ?? "(unnamed)",
    status: r.status,
    conclusion: r.conclusion,
    headSha: r.head_sha,
    headBranch: r.head_branch ?? "",
    event: r.event,
    runNumber: r.run_number,
    url: r.html_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    runStartedAt: r.run_started_at ?? null,
  };
}

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
  updatedAt: string;
  createdAt: string;
  workflowRun: {
    databaseId: number;
    runNumber: number;
    event: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    workflow: { name: string };
  } | null;
  checkRuns: {
    nodes: Array<{
      databaseId: number;
      name: string;
      status: string;
      conclusion: string | null;
      startedAt: string | null;
      completedAt: string | null;
      steps: {
        nodes: Array<{
          name: string;
          status: string;
          conclusion: string | null;
          number: number;
        }>;
      } | null;
    }>;
  };
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
    status,
    conclusion,
    headSha: sha,
    headBranch: "", // not available from commit-object traversal
    event: wr.event,
    runNumber: wr.runNumber,
    url: wr.url,
    createdAt: wr.createdAt,
    updatedAt: wr.updatedAt,
    runStartedAt: wr.createdAt,
  };
}

function mapGqlCheckRunToJob(cr: GqlCheckSuite["checkRuns"]["nodes"][number]): GitHubJob {
  const { status, conclusion } = gqlNormalise(cr.status, cr.conclusion);
  return {
    id: cr.databaseId,
    name: cr.name,
    status,
    conclusion,
    startedAt: cr.startedAt,
    completedAt: cr.completedAt,
    steps: (cr.steps?.nodes ?? []).map(s => {
      const sm = gqlNormalise(s.status, s.conclusion);
      return { name: s.name, status: sm.status, conclusion: sm.conclusion, number: s.number };
    }),
  };
}

// ── GraphQL API fetch ──────────────────────────────────────────────────────

const GRAPHQL_URL = "https://api.github.com/graphql";

/**
 * Maximum number of SHAs per GraphQL batch request.
 * GitHub's GraphQL complexity limit is 500 K nodes. Each SHA alias expands to
 * roughly 20 check-suite nodes × 50 check-run nodes × 30 step nodes ≈ 30 K
 * nodes in the worst case, so 50 SHAs is a safe upper bound that stays well
 * under the limit in all real-world repos.
 */
export const GQL_BATCH_SIZE = 50;

/** Inline fragment shared by every aliased commit object. */
const COMMIT_FRAGMENT = `
... on Commit {
  oid
  checkSuites(first: 20) {
    nodes {
      status
      conclusion
      updatedAt
      createdAt
      workflowRun {
        databaseId
        runNumber
        event
        url
        createdAt
        updatedAt
        workflow { name }
      }
      checkRuns(first: 50) {
        nodes {
          databaseId
          name
          status
          conclusion
          startedAt
          completedAt
          steps(first: 30) {
            nodes { name status conclusion number }
          }
        }
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

export interface GraphQLFetchResult {
  /** Runs grouped by commit SHA — branch-agnostic. */
  runs: GitHubWorkflowRun[];
  /**
   * Pre-fetched jobs keyed by run ID.
   * Populated from check run data embedded in the GraphQL response —
   * no extra round-trips needed for the queried commits.
   */
  jobsByRunId: Map<number, GitHubJob[]>;
}

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
  const empty: GraphQLFetchResult = { runs: [], jobsByRunId: new Map() };
  if (shas.length === 0) return empty;

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { ...createHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        query: buildBatchQuery(shas),
        variables: { owner: repo.owner, repo: repo.repo },
      }),
      signal,
    });

    if (!res.ok) {
      console.error(`[github-actions] GraphQL HTTP ${res.status} for ${repo.owner}/${repo.repo}`);
      return empty;
    }

    const json = (await res.json()) as GqlBatchQueryResult;

    if (json.errors?.length) {
      console.error("[github-actions] GraphQL errors:", json.errors.map(e => e.message).join("; "));
      return empty;
    }

    const repoData = json.data?.repository ?? {};
    const runs: GitHubWorkflowRun[] = [];
    const jobsByRunId = new Map<number, GitHubJob[]>();

    // Iterate alias keys c0, c1, … in the same order as the input shas array
    for (let i = 0; i < shas.length; i++) {
      const commitObj = repoData[`c${i}`];
      if (!commitObj) continue; // SHA not found or not a Commit object
      const sha = commitObj.oid;
      for (const suite of commitObj.checkSuites?.nodes ?? []) {
        const run = mapGqlCheckSuiteToRun(suite, sha);
        if (!run) continue;
        runs.push(run);
        const jobs = suite.checkRuns.nodes.map(mapGqlCheckRunToJob);
        jobsByRunId.set(run.id, jobs);
      }
    }

    return { runs, jobsByRunId };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error("[github-actions] GraphQL fetch error:", err);
    return empty;
  }
}

// ── API calls ─────────────────────────────────────────────────────────────

/**
 * Fetch recent workflow runs for a repository.
 *
 * Uses ETag-based conditional requests: pass the ETag from a previous
 * response in `opts.etag` to get a 304 (no change) response when nothing
 * has changed, saving rate-limit quota.
 *
 * Returns:
 *   - `changed: false` + unchanged `runs`/`etag` when the server returns 304
 *   - `changed: true` + new `runs` + new `etag` on a 200 response
 *   - Empty runs array (no throw) on API errors (4xx / 5xx / network)
 */
export async function fetchWorkflowRuns(
  repo: GitHubRepo,
  token: string,
  opts: {
    perPage?: number;
    etag?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<{ changed: boolean; runs: GitHubWorkflowRun[]; etag: string | null }> {
  const { perPage = 100, etag = null, signal } = opts;
  const url = `${apiBase(repo)}/actions/runs?per_page=${perPage}`;

  const headers: Record<string, string> = createHeaders(token);
  if (etag) headers["If-None-Match"] = etag;

  try {
    const res = await fetch(url, { headers, signal });

    // 304 Not Modified — nothing changed
    if (res.status === 304) {
      return { changed: false, runs: [], etag };
    }

    // Extract new ETag for next request
    const newEtag = res.headers.get("etag");

    if (!res.ok) {
      // 401/403/404/422 — log to console but don't throw (graceful degradation)
      console.error(`[github-actions] fetchWorkflowRuns: HTTP ${res.status} for ${repo.owner}/${repo.repo}`);
      return { changed: true, runs: [], etag: newEtag };
    }

    const json = (await res.json()) as { workflow_runs?: GitHubApiRun[] };
    const runs = (json.workflow_runs ?? []).map(mapApiRun);
    return { changed: true, runs, etag: newEtag };
  } catch (err) {
    if (signal?.aborted) throw err; // propagate AbortError so callers can check
    console.error("[github-actions] fetchWorkflowRuns: network error:", err);
    return { changed: false, runs: [], etag };
  }
}

/**
 * Fetch all jobs (with steps) for a single workflow run.
 *
 * Returns an empty array (no throw) on API errors.
 */
export async function fetchRunJobs(
  repo: GitHubRepo,
  token: string,
  runId: number,
  signal?: AbortSignal,
): Promise<GitHubJob[]> {
  const url = `${apiBase(repo)}/actions/runs/${runId}/jobs?per_page=100`;
  const headers = createHeaders(token);

  try {
    const res = await fetch(url, { headers, signal });
    if (!res.ok) {
      console.error(`[github-actions] fetchRunJobs: HTTP ${res.status} for run ${runId}`);
      return [];
    }
    const json = (await res.json()) as { jobs?: GitHubApiJob[] };
    return (json.jobs ?? []).map(mapApiJob);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error("[github-actions] fetchRunJobs: network error:", err);
    return [];
  }
}
