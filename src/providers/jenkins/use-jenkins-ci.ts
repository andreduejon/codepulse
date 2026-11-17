/**
 * Jenkins in the app: the Solid side of the Jenkins service (core/jenkins/service.ts), which holds the builds, stages
 * and logs and decides what to ask Jenkins. This hook gives it its ports, keeps its settings reactive, registers the
 * provider, and makes the service's reads reactive.
 */
import type { Accessor } from "solid-js";
import { createEffect, createSignal, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { createJenkinsService } from "../../core/jenkins/service";
import { providerAppPort } from "../shared/app-port";
import { DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS } from "../shared/auto-refresh";
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import * as api from "./api";
import { JenkinsCache } from "./cache";
import type { JenkinsCommitData, JenkinsJobFetchResult, JenkinsProviderConfig, JenkinsRun } from "./types";
import { DEFAULT_JENKINS_CONFIG } from "./types";

export interface UseJenkinsCIResult {
  getCommitData: (sha: string) => JenkinsCommitData | null;
  /**
   * Every build it holds for the open repository, shaped like its cache entries: the dashboard shows the running ones
   * from here (the cache keeps only what ended). Reactive.
   */
  heldEntries: () => JenkinsCommitData[];
  fetchJobsForRun: (run: JenkinsRun, signal?: AbortSignal) => Promise<JenkinsJobFetchResult>;
  fetchRunLog: (run: JenkinsRun, signal?: AbortSignal) => Promise<string>;
  fetchCommitDataForSHA: (sha: string, force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  isAvailable: () => boolean;
  invalidate: () => void;
}

export function useJenkinsCI(opts: {
  state: AppState;
  actions: AppActions;
  config?: Partial<JenkinsProviderConfig> | Accessor<Partial<JenkinsProviderConfig>>;
  cacheRoot?: string;
  suspended?: Accessor<boolean>;
}): UseJenkinsCIResult {
  const { state, actions } = opts;
  const configAccessor: Accessor<Partial<JenkinsProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<JenkinsProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<JenkinsProviderConfig>>);

  // A plain snapshot of the merged config: reads of it while fetching must not track the config signal.
  let config: JenkinsProviderConfig = { ...DEFAULT_JENKINS_CONFIG, ...configAccessor() };
  let disk = new JenkinsCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  createEffect(() => {
    const partial = configAccessor();
    config = { ...DEFAULT_JENKINS_CONFIG, ...partial, jobs: partial.jobs ?? [] };
    disk = new JenkinsCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  });

  /** Bumped when the service's builds change: what reads them reads again. */
  const [dataVersion, setDataVersion] = createSignal(0);
  let lifecycle!: ReturnType<typeof useProviderFetchLifecycle>;
  const service = createJenkinsService({
    app: providerAppPort(state, actions, "jenkins", opts.suspended),
    // Through the module at call time: tests replace these functions.
    api: {
      fetchJenkinsGraphDataForSHAs: (...args) => api.fetchJenkinsGraphDataForSHAs(...args),
      fetchJenkinsDataForSHAs: (...args) => api.fetchJenkinsDataForSHAs(...args),
      fetchJenkinsRunsForBuilds: (...args) => api.fetchJenkinsRunsForBuilds(...args),
      fetchJenkinsRunJobs: (...args) => api.fetchJenkinsRunJobs(...args),
      fetchJenkinsConsoleLog: (...args) => api.fetchJenkinsConsoleLog(...args),
    },
    cache: () => disk,
    config: () => config,
    token: api.getJenkinsToken,
    lifecycle: () => lifecycle,
    onDataChange: () => setDataVersion(version => version + 1),
  });

  createEffect(() => {
    if (configAccessor().enabled === true) {
      state.providers.register({
        id: "jenkins",
        displayName: "Jenkins",
        isAvailable: service.isAvailable,
        activity: () => (lifecycle.isFetching() ? "fetching" : null),
      });
    } else {
      state.providers.unregister("jenkins");
      if (untrack(state.activeProviderView) === "jenkins") actions.setActiveProviderView("git");
    }
  });

  lifecycle = useProviderFetchLifecycle({
    state,
    suspended: opts.suspended,
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
    isAvailable: service.isAvailable,
    isBackgroundReady: () => configAccessor().enabled === true && service.isAvailable(),
    queriedSHAs: service.queriedSHAs,
    reportUnavailable: service.reportUnavailable,
    onCancelledStatus: service.onCancelledStatus,
    runInitialFetch: service.runInitialFetch,
    runRefresh: service.runRefresh,
    onResetCaches: service.onResetCaches,
  });

  return {
    getCommitData: (sha: string) => {
      dataVersion();
      return service.getCommitData(sha);
    },
    heldEntries: () => {
      dataVersion();
      return service.heldEntries();
    },
    fetchJobsForRun: service.fetchJobsForRun,
    fetchRunLog: service.fetchRunLog,
    fetchCommitDataForSHA: service.fetchCommitDataForSHA,
    refresh: service.refreshWindow,
    isAvailable: service.isAvailable,
    invalidate: lifecycle.resetCaches,
  };
}
