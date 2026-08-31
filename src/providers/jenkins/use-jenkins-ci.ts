import type { Accessor } from "solid-js";
import { createEffect, createSignal, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { providerError, providerIdle, providerLoading, providerUnavailable } from "../../context/state";
import { BANNER } from "../../debug/banner";
import { collectRunningSHAs, collectTopSHAs } from "../github-actions/sha-selection";
import { DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS } from "../shared/auto-refresh";
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import {
  buildJenkinsCommitDataMap,
  buildJenkinsGraphBadges,
  fetchJenkinsConsoleLog,
  fetchJenkinsDataForSHAs,
  fetchJenkinsGraphDataForSHAs,
  fetchJenkinsRunJobs,
  fetchJenkinsRunsForBuilds,
  getJenkinsToken,
} from "./api";
import { isTerminalJenkinsRun, JenkinsCache, jobsMapFromCache, mergeJenkinsJobs, mergeJenkinsRuns } from "./cache";
import type { JenkinsCommitData, JenkinsJobFetchResult, JenkinsProviderConfig, JenkinsRun } from "./types";
import { DEFAULT_JENKINS_CONFIG } from "./types";

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
  cacheRoot?: string;
}): UseJenkinsCIResult {
  const { state, actions } = opts;
  const configAccessor: Accessor<Partial<JenkinsProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<JenkinsProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<JenkinsProviderConfig>>);

  let config: JenkinsProviderConfig = { ...DEFAULT_JENKINS_CONFIG, ...configAccessor() };
  let disk = new JenkinsCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  createEffect(() => {
    const partial = configAccessor();
    config = { ...DEFAULT_JENKINS_CONFIG, ...partial, jobs: partial.jobs ?? [] };
    disk = new JenkinsCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  });

  const isAvailable = () => {
    if (!config.enabled) return false;
    if (config.jobs.length === 0) return false;
    if (!config.username?.trim()) return false;
    return getJenkinsToken(config.tokenEnvVar) !== null;
  };

  createEffect(() => {
    if (configAccessor().enabled === true) {
      state.providers.register({ id: "jenkins", displayName: "Jenkins", isAvailable });
    } else {
      state.providers.unregister("jenkins");
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
  let discoveredJobs: { url: string }[] | null = null;
  const lastBuildByJob = new Map<string, number>();
  let authFrozen = false;

  function rememberAuthError(error: string | null): void {
    if (error === BANNER.jenkins.tokenExpired || error === BANNER.jenkins.authFailed) authFrozen = true;
  }

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
    actions.setGraphBadges("jenkins", buildJenkinsGraphBadges(allRuns));
    setCommitDataVersion(v => v + 1);
  }

  async function fetchForSHAs(shas: string[], mode: "shallow" | "full", signal?: AbortSignal) {
    const epoch = lifecycle.getEpoch();
    const token = getJenkinsToken(config.tokenEnvVar);
    if (!token || shas.length === 0) return { firstError: null };
    const jobs = discoveredJobs ?? config.jobs;
    const result =
      mode === "shallow"
        ? await fetchJenkinsGraphDataForSHAs(jobs, config.username, token, shas, {
            signal,
            buildLimit: config.fetchDepth,
            knownLastBuilds: lastBuildByJob,
          })
        : await fetchJenkinsDataForSHAs(jobs, config.username, token, shas, {
            signal,
            buildLimit: config.fetchDepth,
          });
    if (signal?.aborted || epoch !== lifecycle.getEpoch()) return { firstError: null, stale: true };
    if (result.error === null) {
      for (const sha of shas) {
        queriedSHAs.add(sha);
        if (mode === "full") resolvedShas.add(sha);
      }
    }
    if (result.discoveryComplete) {
      discoveredJobs = result.jobUrls.map(url => ({ url }));
      const activeJobUrls = new Set(result.jobUrls);
      for (const [key, run] of runCache) {
        if (!activeJobUrls.has(run.jobUrl)) runCache.delete(key);
      }
    }
    if ("lastBuilds" in result) {
      for (const [url, number] of result.lastBuilds) lastBuildByJob.set(url, number);
    }
    for (const run of result.data) {
      runCache.set(`${run.id}:${run.headSha}`, run);
    }
    rebuildCaches();
    await persistTerminalRuns(state.repoPath(), shas);
    return { firstError: result.error, stale: false };
  }

  async function hydrateCachedCandidates(repoPath: string, shas: readonly string[]): Promise<void> {
    const entries = await Promise.all(shas.map(sha => disk.read(repoPath, sha)));
    let changed = false;
    for (const entry of entries) {
      if (!entry) continue;
      for (const run of entry.runs) runCache.set(`${run.id}:${run.headSha}`, run);
      for (const [id, jobs] of Object.entries(entry.jobs ?? {})) {
        if (!jobsCache.has(id)) jobsCache.set(id, { jobs, error: null });
      }
      changed = true;
    }
    if (changed) rebuildCaches();
  }

  async function persistTerminalRuns(repoPath: string, shas: readonly string[]): Promise<void> {
    const writes = await Promise.all(
      shas.map(async sha => {
        const incoming = [...runCache.values()].filter(
          run => isTerminalJenkinsRun(run) && run.headSha.toLowerCase() === sha.toLowerCase(),
        );
        if (incoming.length === 0) return false;
        const existing = await disk.read(repoPath, sha);
        await disk.write(
          repoPath,
          {
            sha,
            runs: mergeJenkinsRuns(existing?.runs ?? [], incoming),
            jobs: mergeJenkinsJobs(
              existing?.jobs,
              jobsMapFromCache(
                jobsCache,
                incoming.map(run => run.id),
              ),
            ),
          },
          { evict: false },
        );
        return true;
      }),
    );
    if (writes.some(Boolean)) await disk.evictForRepo(repoPath);
  }

  const lifecycle = useProviderFetchLifecycle({
    state,
    providerId: "jenkins",
    shaLimit: () => configAccessor().fetchDepth ?? DEFAULT_JENKINS_CONFIG.fetchDepth,
    refreshInterval: () => (configAccessor().autoRefreshSeconds ?? DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS) * 1000,
    identity: () => {
      const partial = configAccessor();
      return JSON.stringify({
        repoPath: state.repoPath(),
        enabled: partial.enabled ?? DEFAULT_JENKINS_CONFIG.enabled,
        username: partial.username ?? "",
        tokenEnvVar: partial.tokenEnvVar ?? DEFAULT_JENKINS_CONFIG.tokenEnvVar,
        fetchDepth: partial.fetchDepth ?? DEFAULT_JENKINS_CONFIG.fetchDepth,
        cacheLimit: partial.cacheLimit ?? DEFAULT_JENKINS_CONFIG.cacheLimit,
        jobs: partial.jobs ?? [],
      });
    },
    isAvailable,
    isBackgroundReady: () => configAccessor().enabled === true && isAvailable(),
    queriedSHAs,
    reportUnavailable: showStatus => {
      if (!showStatus) return;
      if (config.jobs.length === 0) actions.setProviderStatus("jenkins", providerUnavailable(BANNER.jenkins.noJobs));
      else if (!config.username?.trim())
        actions.setProviderStatus("jenkins", providerUnavailable(BANNER.jenkins.noUsername));
      else actions.setProviderStatus("jenkins", providerUnavailable(BANNER.jenkins.missingToken(config.tokenEnvVar)));
    },
    runInitialFetch: async ({ signal, shas, showStatus, epoch }) => {
      if (authFrozen && !showStatus) return;
      if (showStatus) authFrozen = false;
      if (showStatus) actions.setProviderStatus("jenkins", providerLoading());
      const window = shas ?? collectTopSHAs(state.graphRows(), config.fetchDepth);
      await hydrateCachedCandidates(state.repoPath(), window);
      if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
      const target = window.filter(sha => !queriedSHAs.has(sha));
      if (target.length === 0) {
        if (showStatus) actions.setProviderStatus("jenkins", providerIdle());
        lifecycle.noteFetchStarted();
        return;
      }
      const { firstError, stale } = await fetchForSHAs(target, "shallow", signal);
      if (stale || epoch !== lifecycle.getEpoch()) return;
      lifecycle.noteFetchStarted();
      rememberAuthError(firstError ?? null);
      if (!firstError) actions.setProviderLastSuccessfulRefresh("jenkins", new Date());
      if (firstError) actions.setProviderStatus("jenkins", providerError(firstError));
      else actions.setProviderStatus("jenkins", providerIdle());
    },
    runRefresh: async ({ signal, showStatus, epoch }) => {
      if (authFrozen && !showStatus) return;
      if (showStatus) authFrozen = false;
      const target = collectRunningSHAs(state.graphBadges());
      if (target.length === 0) {
        lifecycle.noteRefreshSettled();
        return;
      }
      if (showStatus) actions.setProviderStatus("jenkins", providerLoading());
      const wanted = new Set(target.map(sha => sha.toLowerCase()));
      const runningRuns = [...runCache.values()].filter(
        run => wanted.has(run.headSha.toLowerCase()) && run.status === "running",
      );
      if (runningRuns.length > 0) {
        const token = getJenkinsToken(config.tokenEnvVar);
        if (!token) return;
        const { data, error } = await fetchJenkinsRunsForBuilds(runningRuns, config.username, token, signal);
        if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
        for (const run of data) runCache.set(`${run.id}:${run.headSha}`, run);
        rebuildCaches();
        await persistTerminalRuns(state.repoPath(), target);
        lifecycle.noteRefreshSettled();
        rememberAuthError(error);
        if (!error) actions.setProviderLastSuccessfulRefresh("jenkins", new Date());
        if (error) actions.setProviderStatus("jenkins", providerError(error));
        else actions.setProviderStatus("jenkins", providerIdle());
        return;
      }
      const { firstError, stale } = await fetchForSHAs(target, "shallow", signal);
      if (stale || epoch !== lifecycle.getEpoch()) return;
      lifecycle.noteRefreshSettled();
      rememberAuthError(firstError ?? null);
      if (!firstError) actions.setProviderLastSuccessfulRefresh("jenkins", new Date());
      if (firstError) actions.setProviderStatus("jenkins", providerError(firstError));
      else actions.setProviderStatus("jenkins", providerIdle());
    },
    onResetCaches: () => {
      commitDataCache.clear();
      jobsCache.clear();
      logCache.clear();
      runCache.clear();
      resolvedShas.clear();
      queriedSHAs.clear();
      discoveredJobs = null;
      lastBuildByJob.clear();
      authFrozen = false;
      setCommitDataVersion(v => v + 1);
      actions.setGraphBadges("jenkins", new Map());
      actions.setProviderStatus("jenkins", providerIdle());
    },
  });

  const getCommitData = (sha: string) => {
    commitDataVersion();
    return commitDataCache.get(sha) ?? null;
  };

  return {
    getCommitData,
    fetchJobsForRun: async run => {
      const epoch = lifecycle.getEpoch();
      const cached = jobsCache.get(run.id);
      if (cached) return cached;
      const token = getJenkinsToken(config.tokenEnvVar);
      if (!token) return { jobs: [], error: BANNER.jenkins.missingToken(config.tokenEnvVar) };
      const result = await fetchJenkinsRunJobs(run, config.username, token);
      if (epoch !== lifecycle.getEpoch()) return { jobs: [], error: null };
      if (run.status === "completed" && result.error === null) {
        jobsCache.set(run.id, result);
        await persistTerminalRuns(state.repoPath(), [run.headSha]);
      }
      return result;
    },
    fetchRunLog: async (run, signal) => {
      const epoch = lifecycle.getEpoch();
      const cached = logCache.get(run.id);
      if (cached) return cached;
      const repoPath = state.repoPath();
      if (isTerminalJenkinsRun(run)) {
        const diskLog = await disk.readLog(repoPath, run.headSha, run.id).catch(() => null);
        if (diskLog) {
          logCache.set(run.id, diskLog);
          return diskLog;
        }
      }
      const token = getJenkinsToken(config.tokenEnvVar);
      if (!token) return "";
      const log = await fetchJenkinsConsoleLog(run, config.username, token, signal);
      if (epoch !== lifecycle.getEpoch()) return "";
      if (run.status === "completed" && log) {
        logCache.set(run.id, log);
        await disk.writeLog(repoPath, run.headSha, run.id, log).catch(() => {});
      }
      return log;
    },
    fetchCommitDataForSHA: async sha => {
      const existing = commitDataCache.get(sha);
      if (existing && existing.runs.length > 0) {
        await fetchForSHAs([sha], "shallow");
        return;
      }
      await fetchForSHAs([sha], "full");
    },
    refresh: async () => {
      await lifecycle.fetchRefresh(undefined, true);
    },
    isAvailable,
  };
}
