import {
  DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
  DEFAULT_PROVIDER_LIMIT,
  type ProviderAutoRefreshSeconds,
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
  cacheLimit: ProviderLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
  jobs: JenkinsJobConfig[];
}

export const DEFAULT_JENKINS_CONFIG: JenkinsProviderConfig = {
  enabled: false,
  tokenEnvVar: "JENKINS_TOKEN",
  fetchDepth: DEFAULT_PROVIDER_LIMIT,
  cacheLimit: DEFAULT_PROVIDER_LIMIT,
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

export interface JenkinsJob {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: JenkinsStage[];
}

export interface JenkinsCommitData {
  sha: string;
  runs: JenkinsRun[];
  resolved: boolean;
}

export interface JenkinsJobFetchResult {
  jobs: JenkinsJob[];
  error: string | null;
}
