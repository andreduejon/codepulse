import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROVIDER_LIMIT, type ProviderLimit } from "../shared/auto-refresh";
import { mergeById, ShaJsonCache } from "../shared/sha-json-cache";
import type { JenkinsJob, JenkinsJobFetchResult, JenkinsRun, JenkinsStage } from "./types";

export const DEFAULT_JENKINS_CACHE_ROOT = join(homedir(), ".cache", "codepulse", "jenkins");

export interface JenkinsCacheEntry {
  sha: string;
  runs: JenkinsRun[];
  /** Pipeline jobs + stages keyed by run id. Logs stay off disk. */
  jobs?: Record<string, JenkinsJob[]>;
}

export function isTerminalJenkinsRun(run: JenkinsRun): boolean {
  return run.status === "completed";
}

function isJenkinsRun(value: unknown): value is JenkinsRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as JenkinsRun;
  return (
    typeof run.id === "string" &&
    typeof run.name === "string" &&
    typeof run.status === "string" &&
    (run.conclusion === null || typeof run.conclusion === "string") &&
    typeof run.headSha === "string" &&
    typeof run.runNumber === "number" &&
    (run.startedAt === null || typeof run.startedAt === "string") &&
    typeof run.updatedAt === "string" &&
    typeof run.url === "string" &&
    typeof run.jobLabel === "string" &&
    typeof run.jobUrl === "string"
  );
}

function isJenkinsStage(value: unknown): value is JenkinsStage {
  if (typeof value !== "object" || value === null) return false;
  const stage = value as JenkinsStage;
  return (
    typeof stage.id === "string" &&
    typeof stage.name === "string" &&
    typeof stage.status === "string" &&
    (stage.conclusion === null || typeof stage.conclusion === "string") &&
    (stage.startedAt === null || typeof stage.startedAt === "string") &&
    (stage.completedAt === null || typeof stage.completedAt === "string")
  );
}

function isJenkinsJob(value: unknown): value is JenkinsJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as JenkinsJob;
  return (
    typeof job.id === "string" &&
    typeof job.name === "string" &&
    typeof job.status === "string" &&
    (job.conclusion === null || typeof job.conclusion === "string") &&
    (job.startedAt === null || typeof job.startedAt === "string") &&
    (job.completedAt === null || typeof job.completedAt === "string") &&
    Array.isArray(job.steps) &&
    job.steps.every(isJenkinsStage)
  );
}

function isJenkinsJobsMap(value: unknown): value is Record<string, JenkinsJob[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(jobs => Array.isArray(jobs) && jobs.every(isJenkinsJob));
}

export function isJenkinsCacheEntry(value: unknown): value is JenkinsCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as JenkinsCacheEntry;
  if (typeof entry.sha !== "string" || !Array.isArray(entry.runs) || !entry.runs.every(isJenkinsRun)) return false;
  return entry.jobs === undefined || isJenkinsJobsMap(entry.jobs);
}

export function mergeJenkinsRuns(existing: readonly JenkinsRun[], incoming: readonly JenkinsRun[]): JenkinsRun[] {
  return mergeById(existing, incoming);
}

export function mergeJenkinsJobs(
  existing: Record<string, JenkinsJob[]> | undefined,
  incoming: Record<string, JenkinsJob[]>,
): Record<string, JenkinsJob[]> {
  return { ...existing, ...incoming };
}

export function jobsMapFromCache(jobsCache: ReadonlyMap<string, JenkinsJobFetchResult>, runIds: readonly string[]) {
  const jobs: Record<string, JenkinsJob[]> = {};
  for (const id of runIds) {
    const cached = jobsCache.get(id);
    if (cached && cached.error === null && cached.jobs.length > 0) jobs[id] = cached.jobs;
  }
  return jobs;
}

export class JenkinsCache extends ShaJsonCache<JenkinsCacheEntry> {
  constructor(options: { root?: string; maxEntries?: ProviderLimit } = {}) {
    super({
      root: options.root ?? DEFAULT_JENKINS_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_PROVIDER_LIMIT,
      isEntry: isJenkinsCacheEntry,
      invalidMessage: "Cannot cache an invalid Jenkins run snapshot.",
    });
  }
}
