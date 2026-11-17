/**
 * GitHub Actions in the app: the Solid side of the GitHub service (core/github/service.ts), which holds the runs, jobs
 * and annotations and decides what to ask GitHub. This hook gives it its ports — the app's state, GitHub's API, the
 * cache, the token, the fetch lifecycle — keeps its settings and the parsed remote reactive, registers the provider,
 * and makes the service's reads reactive (`getCommitData` and `heldEntries` follow new data).
 *
 * Accepts state/actions directly (not via useContext) because this hook is called during AppContent setup — before
 * the AppStateContext.Provider renders in JSX (see AGENTS.md rule 5).
 */

import type { Accessor } from "solid-js";
import { createEffect, createSignal, untrack } from "solid-js";
import { type AppActions, type AppState, providerIdle } from "../../context/state";
import { parseGitHubRemote } from "../../core/github/host";
import { createGitHubService } from "../../core/github/service";
import type {
  GitHubCommitData,
  GitHubJobFetchResult,
  GitHubProviderConfig,
  GitHubWorkflowRun,
} from "../../core/github/types";
import { DEFAULT_GITHUB_CONFIG } from "../../core/github/types";
import { DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS } from "../../core/provider-settings";
import { providerAppPort } from "../shared/app-port";
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import * as api from "./api";
import { GitHubCache } from "./cache";

export interface UseGitHubCIResult {
  /** Retrieve all runs for a given commit SHA (null if not fetched yet). */
  getCommitData: (sha: string) => GitHubCommitData | null;
  /**
   * Every run it holds for the open repository, shaped like its cache entries: the dashboard shows the running ones
   * from here (the cache keeps only what ended). Reactive.
   */
  heldEntries: () => GitHubCommitData[];
  /**
   * Fetch jobs for a run on demand and cache them.
   * Returns the jobs once fetched (or from cache).
   * Resolves to an empty array on provider errors; cancellation rejects with AbortError.
   */
  fetchJobsForRun: (run: GitHubWorkflowRun, signal?: AbortSignal) => Promise<GitHubJobFetchResult>;
  /**
   * Fetch the plain-text log for a specific job ID.
   * Resolves to an empty string if token or repo is unavailable.
   */
  fetchJobLogForJob: (jobId: number, run: { headSha: string; status: string }, signal?: AbortSignal) => Promise<string>;
  /** Fetch CI data for one selected SHA on demand. `force` re-queries even if already loaded. */
  fetchCommitDataForSHA: (sha: string, force?: boolean) => Promise<void>;
  /** Trigger an immediate (non-conditional) refresh of CI data. */
  refresh: () => Promise<void>;
  /** True when the provider is available (token + GitHub remote detected). */
  isAvailable: () => boolean;
  /** Abort active work and clear repository-scoped provider state. */
  invalidate: () => void;
}

export function useGitHubCI(opts: {
  state: AppState;
  actions: AppActions;
  /**
   * Provider config — a plain object snapshot or a reactive accessor. Pass the signal (not its value) so that toggling
   * `enabled` in the Providers menu is reflected immediately without a restart.
   */
  config?: Partial<GitHubProviderConfig> | Accessor<Partial<GitHubProviderConfig>>;
  cacheRoot?: string;
  suspended?: Accessor<boolean>;
}): UseGitHubCIResult {
  const { state, actions } = opts;
  const configAccessor: Accessor<Partial<GitHubProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<GitHubProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<GitHubProviderConfig>>);

  // A plain snapshot of the merged config, renewed by an effect: reads of it while fetching (inside other effects) must
  // not track the config signal, or every effect that asks isAvailable() would run again on each settings change.
  let config: GitHubProviderConfig = { ...DEFAULT_GITHUB_CONFIG, ...configAccessor() };
  let disk = new GitHubCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  createEffect(() => {
    config = { ...DEFAULT_GITHUB_CONFIG, ...configAccessor() };
    disk = new GitHubCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  });

  // The remote as a GitHub repository: signals, so effects that ask isAvailable() run again once it is parsed.
  const [parsedGitHubRepo, setParsedGitHubRepo] = createSignal(parseGitHubRemote(state.remoteUrl()));
  const [cachedGitHubRepo, setCachedGitHubRepo] = createSignal<ReturnType<typeof parseGitHubRemote>>(null);
  createEffect(() => {
    const repo = parseGitHubRemote(state.remoteUrl());
    setParsedGitHubRepo(repo);
    setCachedGitHubRepo(
      repo && api.isTrustedGitHubHost(repo.hostname, configAccessor().trustedEnterpriseHost ?? null) ? repo : null,
    );
  });

  /** Bumped when the service's runs or jobs change: what reads them reads again. */
  const [dataVersion, setDataVersion] = createSignal(0);
  let lifecycle!: ReturnType<typeof useProviderFetchLifecycle>;
  const service = createGitHubService({
    app: providerAppPort(state, actions, "github-actions", opts.suspended),
    // Through the module at call time: tests replace these functions.
    api: {
      fetchCIDataForSHAs: (...args) => api.fetchCIDataForSHAs(...args),
      fetchRunJobs: (...args) => api.fetchRunJobs(...args),
      fetchJobAnnotations: (...args) => api.fetchJobAnnotations(...args),
      fetchJobLog: (...args) => api.fetchJobLog(...args),
    },
    cache: () => disk,
    config: () => config,
    repo: cachedGitHubRepo,
    parsedRepo: parsedGitHubRepo,
    token: api.getGitHubToken,
    lifecycle: () => lifecycle,
    onDataChange: () => setDataVersion(version => version + 1),
  });

  // Registered while turned on (also without a token or remote: its tab then says what is missing); turned off, it
  // leaves the tab row, and its open tab goes back to Git.
  createEffect(() => {
    if (configAccessor().enabled === true) {
      state.providers.register({
        id: "github-actions",
        displayName: "GitHub",
        isAvailable: service.isAvailable,
        // Runs in every view: graph fetches, auto refresh and Reload commit all go through the lifecycle.
        activity: () => (lifecycle.isFetching() ? "fetching" : null),
      });
    } else {
      state.providers.unregister("github-actions");
      if (untrack(state.activeProviderView) === "github-actions") actions.setActiveProviderView("git");
    }
  });

  lifecycle = useProviderFetchLifecycle({
    state,
    suspended: opts.suspended,
    providerId: "github-actions",
    shaLimit: () => configAccessor().fetchDepth ?? DEFAULT_GITHUB_CONFIG.fetchDepth,
    refreshInterval: () => (configAccessor().autoRefreshSeconds ?? DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS) * 1000,
    identity: () => {
      const partial = configAccessor();
      return JSON.stringify({
        repoPath: state.repoPath(),
        remoteUrl: state.remoteUrl(),
        enabled: partial.enabled ?? DEFAULT_GITHUB_CONFIG.enabled,
        tokenEnvVar: partial.tokenEnvVar ?? DEFAULT_GITHUB_CONFIG.tokenEnvVar,
        trustedEnterpriseHost: partial.trustedEnterpriseHost ?? null,
        fetchDepth: partial.fetchDepth ?? DEFAULT_GITHUB_CONFIG.fetchDepth,
        cacheLimit: partial.cacheLimit ?? DEFAULT_GITHUB_CONFIG.cacheLimit,
      });
    },
    isAvailable: service.isAvailable,
    isBackgroundReady: () => cachedGitHubRepo() !== null,
    queriedSHAs: service.queriedSHAs,
    reportUnavailable: service.reportUnavailable,
    onCancelledStatus: () => {
      if (state.providerStatusFor("github-actions").kind === "loading")
        actions.setProviderStatus("github-actions", providerIdle());
    },
    runInitialFetch: service.runInitialFetch,
    runRefresh: service.runRefresh,
    onResetCaches: service.onResetCaches,
  });

  return {
    getCommitData: (sha: string) => {
      // Tracks new data: a tab already open shows runs that arrive later.
      dataVersion();
      return service.getCommitData(sha);
    },
    heldEntries: () => {
      dataVersion();
      return service.heldEntries();
    },
    fetchJobsForRun: service.fetchJobsForRun,
    fetchJobLogForJob: service.fetchJobLogForJob,
    fetchCommitDataForSHA: service.fetchCommitDataForSHA,
    refresh: service.refreshWindow,
    isAvailable: service.isAvailable,
    invalidate: lifecycle.resetCaches,
  };
}
