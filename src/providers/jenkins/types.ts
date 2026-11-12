import {
  DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
  DEFAULT_PROVIDER_CACHE_LIMIT,
  DEFAULT_PROVIDER_LIMIT,
  type ProviderAutoRefreshSeconds,
  type ProviderCacheLimit,
  type ProviderLimit,
} from "../shared/auto-refresh";

export interface JenkinsJobConfig {
  label?: string;
  url: string;
}

export const JENKINS_MULTIBRANCH_JOB_LIMIT = 25;

export interface JenkinsProviderConfig {
  enabled: boolean;
  username?: string;
  tokenEnvVar: string;
  /** Graph SHA window and builds inspected per job. */
  fetchDepth: ProviderLimit;
  cacheLimit: ProviderCacheLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
  jobs: JenkinsJobConfig[];
}

export const DEFAULT_JENKINS_CONFIG: JenkinsProviderConfig = {
  enabled: false,
  tokenEnvVar: "JENKINS_TOKEN",
  fetchDepth: DEFAULT_PROVIDER_LIMIT,
  cacheLimit: DEFAULT_PROVIDER_CACHE_LIMIT,
  autoRefreshSeconds: DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
  jobs: [],
};

export interface JenkinsRun {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  runNumber: number;
  startedAt: string | null;
  updatedAt: string;
  url: string;
  jobLabel: string;
  jobUrl: string;
}

export interface JenkinsStage {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** A failed JUnit test: where it is, and why it failed. */
export interface JenkinsFailedTest {
  className: string;
  name: string;
  details: string | null;
  stackTrace: string | null;
}

/** A finished build's JUnit test report: its counts and (up to 50) failed tests. */
export interface JenkinsTestReport {
  passCount: number;
  failCount: number;
  skipCount: number;
  failed: JenkinsFailedTest[];
}

export interface JenkinsJob {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: JenkinsStage[];
  /**
   * The build's test report, read once the build has finished: null when it has none, missing while it is not known
   * (still running, or the report could not be read, so it is asked for again).
   */
  tests?: JenkinsTestReport | null;
}

/**
 * What a row under a build stands for: an entry of its log (the whole build when it has no stages, or one stage), or
 * its test report.
 */
export type JenkinsTreeRow =
  | { kind: "log"; pipeline: JenkinsJob; entry: number }
  | { kind: "tests"; report: JenkinsTestReport };

export interface JenkinsCommitData {
  sha: string;
  runs: JenkinsRun[];
  resolved: boolean;
}

export interface JenkinsJobFetchResult {
  jobs: JenkinsJob[];
  error: string | null;
}
