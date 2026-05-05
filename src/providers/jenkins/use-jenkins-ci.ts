import type { Accessor } from "solid-js";
import { createEffect, createSignal, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { providerError, providerIdle, providerLoading, providerUnavailable } from "../../context/state";
import { collectTopSHAs } from "../github-actions/sha-selection";
import { registerProvider, unregisterProvider } from "../provider";
import {
  buildJenkinsCommitDataMap,
  buildJenkinsGraphBadges,
  fetchJenkinsConsoleLog,
  fetchJenkinsDataForSHAs,
  fetchJenkinsRunJobs,
  getJenkinsToken,
} from "./api";
import type { JenkinsCommitData, JenkinsJobFetchResult, JenkinsProviderConfig, JenkinsRun } from "./types";
import { DEFAULT_JENKINS_CONFIG } from "./types";

const INITIAL_SHA_LIMIT = 100;

export interface UseJenkinsCIResult {
  getCommitData: (sha: string) => JenkinsCommitData | null;
  fetchJobsForRun: (run: JenkinsRun) => Promise<JenkinsJobFetchResult>;
  fetchRunLog: (run: JenkinsRun, signal?: AbortSignal) => Promise<string>;
  fetchCommitDataForSHA: (sha: string) => Promise<void>;
  refresh: () => Promise<void>;
  isAvailable: () => boolean;
}

export function useJenkinsCI(opts: {
  state: AppState;
  actions: AppActions;
  config?: Partial<JenkinsProviderConfig> | Accessor<Partial<JenkinsProviderConfig>>;
}): UseJenkinsCIResult {
  const { state, actions } = opts;
  const configAccessor: Accessor<Partial<JenkinsProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<JenkinsProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<JenkinsProviderConfig>>);

  let config: JenkinsProviderConfig = { ...DEFAULT_JENKINS_CONFIG, ...configAccessor() };
  createEffect(() => {
    config = { ...DEFAULT_JENKINS_CONFIG, ...configAccessor(), jobs: configAccessor().jobs ?? [] };
  });

  const isAvailable = () => {
    if (!config.enabled) return false;
    if (config.jobs.length === 0) return false;
    if (!config.username?.trim()) return false;
    return getJenkinsToken(config.tokenEnvVar) !== null;
  };

  createEffect(() => {
    if (configAccessor().enabled === true) {
      registerProvider({ id: "jenkins", displayName: "jenkins", isAvailable });
    } else {
      unregisterProvider("jenkins");
      if (untrack(state.activeProviderView) === "jenkins") actions.setActiveProviderView("git");
    }
  });

  const commitDataCache = new Map<string, JenkinsCommitData>();
  const [commitDataVersion, setCommitDataVersion] = createSignal(0);
  const jobsCache = new Map<string, JenkinsJobFetchResult>();
  const queriedSHAs = new Set<string>();
  let fetchInFlight = false;

  async function fetchForSHAs(shas: string[], signal?: AbortSignal) {
    const token = getJenkinsToken(config.tokenEnvVar);
    if (!token || shas.length === 0) return { firstError: null };
    const result = await fetchJenkinsDataForSHAs(config.jobs, config.username, token, shas, { signal });
    if (signal?.aborted) return { firstError: null };
    const data = buildJenkinsCommitDataMap(result.data);
    for (const sha of shas) {
      if (!data.has(sha)) data.set(sha, { sha, runs: [] });
    }
    for (const [sha, value] of data) commitDataCache.set(sha, value);
    setCommitDataVersion(v => v + 1);
    const current = new Map(state.graphBadges());
    for (const [sha, badge] of buildJenkinsGraphBadges(result.data)) current.set(sha, badge);
    actions.setGraphBadges(current);
    return { firstError: result.error };
  }

  async function doInitialFetch(signal?: AbortSignal, shas?: string[], showStatus = false) {
    if (fetchInFlight) return;
    if (!isAvailable()) {
      if (showStatus) {
        if (config.jobs.length === 0)
          actions.setProviderStatus(providerUnavailable("Jenkins unavailable: no jobs configured"));
        else if (!config.username?.trim())
          actions.setProviderStatus(providerUnavailable("Jenkins unavailable: username not configured"));
        else actions.setProviderStatus(providerUnavailable(`Jenkins unavailable: missing ${config.tokenEnvVar}`));
      }
      return;
    }
    fetchInFlight = true;
    if (showStatus) actions.setProviderStatus(providerLoading());
    try {
      const target = shas ?? collectTopSHAs(state.graphRows(), INITIAL_SHA_LIMIT).filter(sha => !queriedSHAs.has(sha));
      for (const sha of target) queriedSHAs.add(sha);
      const { firstError } = await fetchForSHAs(target, signal);
      if (firstError) actions.setProviderStatus(providerError(firstError));
      else actions.setProviderStatus(providerIdle());
    } finally {
      fetchInFlight = false;
    }
  }

  createEffect(() => {
    if (state.activeProviderView() !== "jenkins") return;
    state.graphRows();
    const controller = new AbortController();
    void doInitialFetch(controller.signal, undefined, true);
    return () => controller.abort();
  });

  const getCommitData = (sha: string) => {
    commitDataVersion();
    return commitDataCache.get(sha) ?? null;
  };

  return {
    getCommitData,
    fetchJobsForRun: async run => {
      const cached = jobsCache.get(run.id);
      if (cached) return cached;
      const token = getJenkinsToken(config.tokenEnvVar);
      if (!token) return { jobs: [], error: `missing ${config.tokenEnvVar}` };
      const result = await fetchJenkinsRunJobs(run, config.username, token);
      jobsCache.set(run.id, result);
      return result;
    },
    fetchRunLog: async (run, signal) => {
      const token = getJenkinsToken(config.tokenEnvVar);
      return token ? fetchJenkinsConsoleLog(run, config.username, token, signal) : "";
    },
    fetchCommitDataForSHA: async sha => {
      queriedSHAs.add(sha);
      await fetchForSHAs([sha]);
    },
    refresh: async () => {
      queriedSHAs.clear();
      commitDataCache.clear();
      actions.setGraphBadges(new Map());
      await doInitialFetch(undefined, undefined, true);
    },
    isAvailable,
  };
}
