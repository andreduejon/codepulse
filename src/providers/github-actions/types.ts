/**
 * GitHub Actions provider — type definitions.
 *
 * These types model the GitHub Actions API responses and the derived
 * data structures used by the UI.  Nothing in this file is shared with
 * other providers; each provider owns its own type hierarchy.
 */

// ── GitHub API response shapes ────────────────────────────────────────────

/** Raw workflow run as returned by the GitHub Actions API. */
export interface GitHubApiRun {
  id: number;
  /** Workflow / pipeline name (e.g. "CI", "Deploy") */
  name: string | null;
  /** Run-level status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending" */
  status: string;
  /** Run-level conclusion (only set when status === "completed"):
   *  "success" | "failure" | "cancelled" | "skipped" | "timed_out"
   *  | "action_required" | "stale" | "startup_failure" | null */
  conclusion: string | null;
  head_sha: string;
  head_branch: string | null;
  /** Trigger event: "push" | "pull_request" | "schedule" | "workflow_dispatch" | … */
  event: string;
  run_number: number;
  /** URL to the run on github.com */
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
}

/** Raw job as returned by GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs */
export interface GitHubApiJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: GitHubApiStep[];
}

/** Raw step within a job. */
export interface GitHubApiStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
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
  status: string;
  conclusion: string | null;
  headSha: string;
  event: string;
  runNumber: number;
  updatedAt: string;
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
}

/** Mapped step within a job. */
export interface GitHubStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

/**
 * Full detail for a single workflow run, including lazily-fetched jobs.
 * Stored in the per-run jobs cache once fetched.
 */
export interface GitHubRunDetail {
  run: GitHubWorkflowRun;
  jobs: GitHubJob[];
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
}

/** Config for the GitHub Actions provider (subset of CodepulseConfig). */
export interface GitHubProviderConfig {
  /** Whether the provider is enabled. Defaults to true. */
  enabled: boolean;
  /** Name of the environment variable holding the Personal Access Token.
   *  Defaults to "GITHUB_TOKEN". */
  tokenEnvVar: string;
}

export const DEFAULT_GITHUB_CONFIG: GitHubProviderConfig = {
  enabled: true,
  tokenEnvVar: "GITHUB_TOKEN",
};
