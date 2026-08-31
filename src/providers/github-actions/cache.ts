import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROVIDER_LIMIT, type ProviderLimit } from "../shared/auto-refresh";
import { mergeById, ShaJsonCache } from "../shared/sha-json-cache";
import type { GitHubJob, GitHubStep, GitHubWorkflowRun } from "./types";

export const DEFAULT_GITHUB_CACHE_ROOT = join(homedir(), ".cache", "codepulse", "github-actions");

export interface GitHubCacheEntry {
  sha: string;
  runs: GitHubWorkflowRun[];
  /** Completed jobs + steps keyed by run id. Logs stay off disk. */
  jobs?: Record<string, GitHubJob[]>;
}

export function isTerminalGitHubRun(run: GitHubWorkflowRun): boolean {
  return run.status === "completed";
}

function isGitHubWorkflowRun(value: unknown): value is GitHubWorkflowRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as GitHubWorkflowRun;
  return (
    typeof run.id === "number" &&
    typeof run.name === "string" &&
    typeof run.status === "string" &&
    (run.conclusion === null || typeof run.conclusion === "string") &&
    typeof run.headSha === "string" &&
    typeof run.event === "string" &&
    typeof run.runNumber === "number" &&
    typeof run.updatedAt === "string"
  );
}

function isGitHubStep(value: unknown): value is GitHubStep {
  if (typeof value !== "object" || value === null) return false;
  const step = value as GitHubStep;
  return (
    typeof step.name === "string" &&
    typeof step.status === "string" &&
    (step.conclusion === null || typeof step.conclusion === "string") &&
    typeof step.number === "number" &&
    (step.startedAt === null || typeof step.startedAt === "string") &&
    (step.completedAt === null || typeof step.completedAt === "string")
  );
}

function isGitHubJob(value: unknown): value is GitHubJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as GitHubJob;
  return (
    typeof job.id === "number" &&
    typeof job.name === "string" &&
    typeof job.status === "string" &&
    (job.conclusion === null || typeof job.conclusion === "string") &&
    (job.startedAt === null || typeof job.startedAt === "string") &&
    (job.completedAt === null || typeof job.completedAt === "string") &&
    Array.isArray(job.steps) &&
    job.steps.every(isGitHubStep)
  );
}

function isGitHubJobsMap(value: unknown): value is Record<string, GitHubJob[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(jobs => Array.isArray(jobs) && jobs.every(isGitHubJob));
}

export function isGitHubCacheEntry(value: unknown): value is GitHubCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as GitHubCacheEntry;
  if (typeof entry.sha !== "string" || !Array.isArray(entry.runs) || !entry.runs.every(isGitHubWorkflowRun))
    return false;
  return entry.jobs === undefined || isGitHubJobsMap(entry.jobs);
}

export function mergeGitHubRuns(
  existing: readonly GitHubWorkflowRun[],
  incoming: readonly GitHubWorkflowRun[],
): GitHubWorkflowRun[] {
  return mergeById(existing, incoming);
}

export function mergeGitHubJobs(
  existing: Record<string, GitHubJob[]> | undefined,
  incoming: Record<string, GitHubJob[]>,
): Record<string, GitHubJob[]> {
  return { ...existing, ...incoming };
}

export function jobsMapFromGitHubCache(jobsCache: ReadonlyMap<number, GitHubJob[]>, runIds: readonly number[]) {
  const jobs: Record<string, GitHubJob[]> = {};
  for (const id of runIds) {
    const cached = jobsCache.get(id);
    if (cached && cached.length > 0) jobs[String(id)] = cached;
  }
  return jobs;
}

export class GitHubCache extends ShaJsonCache<GitHubCacheEntry> {
  constructor(options: { root?: string; maxEntries?: ProviderLimit } = {}) {
    super({
      root: options.root ?? DEFAULT_GITHUB_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_PROVIDER_LIMIT,
      isEntry: isGitHubCacheEntry,
      invalidMessage: "Cannot cache an invalid GitHub Actions run snapshot.",
    });
  }
}
