/**
 * GitHub Actions provider — type definitions.
 *
 * These types model the GitHub Actions API responses and the derived
 * data structures used by the UI.  Nothing in this file is shared with
 * other providers; each provider owns its own type hierarchy.
 */

import {
  DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
  DEFAULT_PROVIDER_CACHE_LIMIT,
  DEFAULT_PROVIDER_LIMIT,
  type ProviderAutoRefreshSeconds,
  type ProviderCacheLimit,
  type ProviderLimit,
} from "../shared/auto-refresh";

// ── GitHub API response shapes ────────────────────────────────────────────/** Raw job as returned by GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs */
export interface GitHubApiJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: GitHubApiStep[];
  /** Which attempt of the run the job belongs to (re-runs). */
  run_attempt?: number;
}

/** Raw step within a job. */
export interface GitHubApiStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

// ── Derived / mapped types used by the UI ────────────────────────────────

/**
 * Mapped workflow run — GitHub API fields normalised to camelCase and
 * trimmed to the fields actually used by the UI.
 */
export interface GitHubWorkflowRun {
  id: number;
  /** Workflow name, defaulting to "(unnamed)" when the API returns null. */
  name: string;
  url?: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  event: string;
  runNumber: number;
  startedAt?: string | null;
  updatedAt: string;
}

/** A check run annotation: what failed (or warns) and where. */
export interface GitHubAnnotation {
  level: "failure" | "warning" | "notice";
  path: string;
  /** Start line, or null when it names no line. */
  line: number | null;
  message: string;
}

/** Mapped job within a workflow run. */
export interface GitHubJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: GitHubStep[];
  /** A failed job's annotations, once read (an Actions job is a check run with the same id). */
  annotations?: GitHubAnnotation[];
  /** The run attempt (1 for the first run). Unknown for jobs listed by GraphQL, which lists the latest only. */
  runAttempt?: number;
}

export interface GitHubJobFetchResult {
  jobs: GitHubJob[];
  error: string | null;
}

export interface GitHubResult<T> {
  data: T;
  error: string | null;
}

/** Mapped step within a job. */
export interface GitHubStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * All CI data for a single commit SHA.
 * Stored in the provider's in-memory cache keyed by SHA.
 */
export interface GitHubCommitData {
  sha: string;
  /** All runs associated with this SHA, most-recently-updated first. */
  runs: GitHubWorkflowRun[];
}

/** GitHub repository coordinates, parsed from the remote URL. */
export interface GitHubRepo {
  owner: string;
  repo: string;
  /** Hostname of the GitHub instance (e.g. "github.com" or "github.example.com"). */
  hostname: string;
}

/** Config for the GitHub Actions provider (subset of CodepulseConfig). */
export interface GitHubProviderConfig {
  /** Whether the provider is enabled. Defaults to false. */
  enabled: boolean;
  /** Name of the environment variable holding the Personal Access Token.
   *  Defaults to "GITHUB_TOKEN". */
  tokenEnvVar: string;
  /** Trusted GitHub Enterprise host for this repo. github.com is always trusted. */
  trustedEnterpriseHost: string | null;
  /** Graph SHA window queried from Actions. */
  fetchDepth: ProviderLimit;
  cacheLimit: ProviderCacheLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
}

export const DEFAULT_GITHUB_CONFIG: GitHubProviderConfig = {
  enabled: false,
  tokenEnvVar: "GITHUB_TOKEN",
  trustedEnterpriseHost: null,
  fetchDepth: DEFAULT_PROVIDER_LIMIT,
  cacheLimit: DEFAULT_PROVIDER_CACHE_LIMIT,
  autoRefreshSeconds: DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
};
