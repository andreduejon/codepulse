import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { providerError, providerIdle, providerLoading, providerUnavailable } from "../../context/state";
import { collectTopSHAs } from "../github-actions/sha-selection";
import { registerProvider, unregisterProvider } from "../provider";
import {
  buildJenkinsCommitDataMap,
  buildJenkinsGraphBadges,
  fetchJenkinsConsoleLog,
  fetchJenkinsDataForSHAs,
  fetchJenkinsGraphDataForSHAs,
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
  const logCache = new Map<string, string>();
  const runCache = new Map<string, JenkinsRun>();
  const resolvedShas = new Set<string>();
  const queriedSHAs = new Set<string>();
  let fetchInFlight = false;
  let hasFetchedOnce = false;
  let lastFetchedAt = 0;
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let fetchAbortCtrl: AbortController | null = null;
  let backgroundFetchAbortCtrl: AbortController | null = null;

  function rebuildCaches() {
    const allRuns = [...runCache.values()];
    const rebuilt = buildJenkinsCommitDataMap(allRuns, false);
    commitDataCache.clear();
    for (const sha of queriedSHAs) {
      const existing = rebuilt.get(sha) ?? { sha, runs: [], resolved: resolvedShas.has(sha) };
      existing.resolved = resolvedShas.has(sha);
      commitDataCache.set(sha, existing);
    }
    for (const [sha, data] of rebuilt) {
      data.resolved = resolvedShas.has(sha);
      commitDataCache.set(sha, data);
    }
    actions.setGraphBadges(buildJenkinsGraphBadges(allRuns));
    setCommitDataVersion(v => v + 1);
  }

  async function fetchForSHAs(shas: string[], mode: "shallow" | "full", signal?: AbortSignal) {
    const token = getJenkinsToken(config.tokenEnvVar);
    if (!token || shas.length === 0) return { firstError: null };
    const result =
      mode === "shallow"
        ? await fetchJenkinsGraphDataForSHAs(config.jobs, config.username, token, shas, {
            signal,
            buildLimit: config.graphBuildLimit,
          })
        : await fetchJenkinsDataForSHAs(config.jobs, config.username, token, shas, {
            signal,
            buildLimit: config.graphBuildLimit,
          });
    if (signal?.aborted) return { firstError: null };
    for (const sha of shas) {
      queriedSHAs.add(sha);
      if (mode === "full") resolvedShas.add(sha);
    }
    for (const run of result.data) {
      runCache.set(`${run.id}:${run.headSha}`, run);
    }
    rebuildCaches();
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
      if (target.length === 0) {
        if (showStatus) actions.setProviderStatus(providerIdle());
        return;
      }
      const { firstError } = await fetchForSHAs(target, "shallow", signal);
      hasFetchedOnce = true;
      lastFetchedAt = Date.now();
      if (firstError) actions.setProviderStatus(providerError(firstError));
      else actions.setProviderStatus(providerIdle());
    } finally {
      fetchInFlight = false;
    }
  }

  async function doRefreshVisible(signal?: AbortSignal, showStatus = false) {
    if (fetchInFlight) return;
    if (!isAvailable()) return;
    const target = collectTopSHAs(state.graphRows(), INITIAL_SHA_LIMIT);
    if (target.length === 0) return;
    fetchInFlight = true;
    if (showStatus) actions.setProviderStatus(providerLoading());
    try {
      const { firstError } = await fetchForSHAs(target, "shallow", signal);
      lastFetchedAt = Date.now();
      if (firstError) actions.setProviderStatus(providerError(firstError));
      else actions.setProviderStatus(providerIdle());
    } finally {
      fetchInFlight = false;
    }
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) return;
    const interval = state.autoRefreshInterval();
    if (interval <= 0) return;
    autoRefreshTimer = setInterval(() => {
      if (state.activeProviderView() !== "jenkins") return;
      if (fetchAbortCtrl) fetchAbortCtrl.abort();
      const ctrl = new AbortController();
      fetchAbortCtrl = ctrl;
      void doRefreshVisible(ctrl.signal);
    }, interval);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (fetchAbortCtrl) {
      fetchAbortCtrl.abort();
      fetchAbortCtrl = null;
    }
  }

  createEffect(() => {
    const view = state.activeProviderView();
    if (view === "jenkins") {
      state.graphRows();
      if (!hasFetchedOnce) {
        const controller = new AbortController();
        fetchAbortCtrl = controller;
        void doInitialFetch(controller.signal, undefined, true);
        return () => controller.abort();
      }
      const interval = state.autoRefreshInterval();
      const staleThreshold = interval > 0 ? interval : 30_000;
      if (Date.now() - lastFetchedAt > staleThreshold) {
        const controller = new AbortController();
        fetchAbortCtrl = controller;
        void doRefreshVisible(controller.signal, true);
        return () => controller.abort();
      }
      startAutoRefresh();
      return () => stopAutoRefresh();
    }
    stopAutoRefresh();
  });

  createEffect(() => {
    const rows = state.graphRows();
    if (rows.length === 0) return;
    if (!configAccessor().enabled) return;
    if (!isAvailable()) return;

    const allSHAs = collectTopSHAs(rows, INITIAL_SHA_LIMIT);
    const newSHAs = allSHAs.filter(sha => !queriedSHAs.has(sha));
    if (newSHAs.length === 0) return;

    if (backgroundFetchAbortCtrl) backgroundFetchAbortCtrl.abort();
    const ctrl = new AbortController();
    backgroundFetchAbortCtrl = ctrl;
    void doInitialFetch(ctrl.signal, allSHAs, false);
  });

  createEffect(() => {
    const _interval = state.autoRefreshInterval();
    if (state.activeProviderView() === "jenkins") {
      stopAutoRefresh();
      startAutoRefresh();
    }
  });

  onCleanup(() => {
    stopAutoRefresh();
    if (backgroundFetchAbortCtrl) {
      backgroundFetchAbortCtrl.abort();
      backgroundFetchAbortCtrl = null;
    }
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
      if (run.status === "completed") jobsCache.set(run.id, result);
      return result;
    },
    fetchRunLog: async (run, signal) => {
      const cached = logCache.get(run.id);
      if (cached) return cached;
      const token = getJenkinsToken(config.tokenEnvVar);
      if (!token) return "";
      const log = await fetchJenkinsConsoleLog(run, config.username, token, signal);
      if (run.status === "completed" && log) logCache.set(run.id, log);
      return log;
    },
    fetchCommitDataForSHA: async sha => {
      await fetchForSHAs([sha], "full");
    },
    refresh: async () => {
      await doRefreshVisible(undefined, true);
    },
    isAvailable,
  };
}
