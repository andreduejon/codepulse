export interface JenkinsJobConfig {
  label?: string;
  url: string;
}

export interface JenkinsProviderConfig {
  enabled: boolean;
  host?: string;
  username?: string;
  tokenEnvVar: string;
  jobs: JenkinsJobConfig[];
}

export const DEFAULT_JENKINS_CONFIG: JenkinsProviderConfig = {
  enabled: false,
  tokenEnvVar: "JENKINS_TOKEN",
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
}

export interface JenkinsJobFetchResult {
  jobs: JenkinsJob[];
  error: string | null;
}
