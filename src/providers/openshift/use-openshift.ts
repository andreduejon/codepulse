/**
 * OpenShift in the app: the Solid side of the OpenShift service (core/openshift/service.ts), which holds the builds and
 * live resources and decides what to ask the cluster. This hook gives it its ports, keeps its settings reactive,
 * registers the provider, runs the live session while a view shows live resources, and makes the service's reads
 * reactive.
 */
import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { createOpenShiftService, type OpenShiftLiveState } from "../../core/openshift/service";
import { providerAppPort } from "../shared/app-port";
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import * as api from "./api";
import { OpenShiftCache, type OpenShiftCacheEntry } from "./cache";
import type { OpenShiftCommitData, OpenShiftEvent, OpenShiftProviderConfig, OpenShiftResource } from "./types";
import { DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS, DEFAULT_OPENSHIFT_CONFIG } from "./types";

export {
  commitDataFromCacheEntry,
  commitHasDigestSeed,
  keepFailedLiveSlices,
  mergeLiveIntoCommit,
  resourceHasImageDigest,
  selectOpenShiftCandidateSHAs,
} from "../../core/openshift/commit-data";

export interface UseOpenShiftResult {
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  /**
   * Every build it holds for the open repository, shaped like its cache entries: the dashboard shows the running ones
   * from here (the cache keeps only what ended). Reactive.
   */
  heldEntries: () => OpenShiftCacheEntry[];
  refresh: () => Promise<void>;
  fetchCommitDataForSHA: (sha: string, force?: boolean) => Promise<void>;
  isLoading: (sha: string) => boolean;
  liveAge: () => string;
  isAvailable: () => boolean;
  invalidate: () => void;
  loadBuildLog: (resource: OpenShiftResource, force?: boolean) => Promise<string>;
  loadPodLog: (resource: OpenShiftResource, container?: string) => Promise<string>;
  followLog: (resource: OpenShiftResource, signal: AbortSignal, onText: (text: string) => void) => Promise<void>;
  /** The resource's object; `force` (refresh) asks the API instead of using the embedded or cached copy. */
  loadResourceObject: (resource: OpenShiftResource, force?: boolean) => Promise<unknown>;
  /** The events about the resource, always from the API (they change by the minute and are not cached). */
  loadResourceEvents: (resource: OpenShiftResource) => Promise<OpenShiftEvent[]>;
}

export function useOpenShift(opts: {
  state: AppState;
  actions: AppActions;
  config?: Partial<OpenShiftProviderConfig> | Accessor<Partial<OpenShiftProviderConfig>>;
  cacheRoot?: string;
  suspended?: Accessor<boolean>;
}): UseOpenShiftResult {
  const { state, actions } = opts;
  const configAccessor: Accessor<Partial<OpenShiftProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<OpenShiftProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<OpenShiftProviderConfig>>);

  // A plain snapshot of the merged config: reads of it while fetching must not track the config signal.
  let config: OpenShiftProviderConfig = { ...DEFAULT_OPENSHIFT_CONFIG, ...configAccessor() };
  let disk = new OpenShiftCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  createEffect(() => {
    const partial = configAccessor();
    config = { ...DEFAULT_OPENSHIFT_CONFIG, ...partial, namespaces: partial.namespaces ?? [] };
    disk = new OpenShiftCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  });

  /** Bumped when the service's builds or resources change: what reads them reads again. */
  const [dataVersion, setDataVersion] = createSignal(0);
  /** Live list/watch state: `loading` while a live list is requested, `live` while watches stream. */
  const [liveState, setLiveState] = createSignal<OpenShiftLiveState>("idle");
  /** Bumped to start the live session again (a retry, a reset, the token freeze). */
  const [watchEpoch, setWatchEpoch] = createSignal(0);
  let lifecycle!: ReturnType<typeof useProviderFetchLifecycle>;
  const service = createOpenShiftService({
    app: providerAppPort(state, actions, "openshift", opts.suspended),
    // Through the module at call time: tests replace these functions.
    api: {
      fetchOpenShiftInventory: (...args) => api.fetchOpenShiftInventory(...args),
      fetchOpenShiftResources: (...args) => api.fetchOpenShiftResources(...args),
      watchOpenShiftStream: (...args) => api.watchOpenShiftStream(...args),
      fetchOpenShiftBuildLog: (...args) => api.fetchOpenShiftBuildLog(...args),
      fetchOpenShiftPodLog: (...args) => api.fetchOpenShiftPodLog(...args),
      followOpenShiftLog: (...args) => api.followOpenShiftLog(...args),
      fetchOpenShiftObject: (...args) => api.fetchOpenShiftObject(...args),
      fetchOpenShiftEvents: (...args) => api.fetchOpenShiftEvents(...args),
    },
    cache: () => disk,
    config: () => config,
    token: api.getOpenShiftToken,
    lifecycle: () => lifecycle,
    onDataChange: () => setDataVersion(version => version + 1),
    onLiveState: setLiveState,
    restartLive: () => setWatchEpoch(value => value + 1),
  });

  createEffect(() => {
    if (configAccessor().enabled === true)
      state.providers.register({
        id: "openshift",
        displayName: "OpenShift",
        isAvailable: service.isAvailable,
        // Build inventory (lifecycle) or the live list before watches start; streaming watches are not "fetching".
        activity: () => (lifecycle.isFetching() || liveState() === "loading" ? "fetching" : null),
      });
    else {
      state.providers.unregister("openshift");
      if (untrack(state.activeProviderView) === "openshift") actions.setActiveProviderView("git");
    }
  });

  lifecycle = useProviderFetchLifecycle({
    state,
    suspended: opts.suspended,
    providerId: "openshift",
    skipShaBackground: true,
    // The build list once the repository loads, so the graph and the dashboard show builds before the tab is opened.
    fetchOnLoad: true,
    identity: () => {
      const partial = configAccessor();
      return JSON.stringify({
        repoPath: state.repoPath(),
        enabled: partial.enabled ?? DEFAULT_OPENSHIFT_CONFIG.enabled,
        serverUrl: partial.serverUrl ?? "",
        tokenEnvVar: partial.tokenEnvVar ?? DEFAULT_OPENSHIFT_CONFIG.tokenEnvVar,
        namespaces: partial.namespaces ?? [],
        commitShaAnnotation: partial.commitShaAnnotation ?? DEFAULT_OPENSHIFT_CONFIG.commitShaAnnotation,
        cacheLimit: partial.cacheLimit ?? DEFAULT_OPENSHIFT_CONFIG.cacheLimit,
        fetchDepth: partial.fetchDepth ?? DEFAULT_OPENSHIFT_CONFIG.fetchDepth,
      });
    },
    isAvailable: service.isAvailable,
    isBackgroundReady: () => false,
    refreshInterval: () => (configAccessor().autoRefreshSeconds ?? DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS) * 1000,
    queriedSHAs: service.queriedSHAs,
    reportUnavailable: service.reportUnavailable,
    onCancelledStatus: service.onCancelledStatus,
    runInitialFetch: service.runInitialFetch,
    runRefresh: service.runRefresh,
    onResetCaches: service.onResetCaches,
  });

  /**
   * The views that show live resources: its own, and the dashboard's details of a build. A memo, so moving between the
   * two keeps the running list and watches.
   */
  const liveShown = createMemo(() => {
    const view = state.activeProviderView();
    return view === "openshift" || view === "dashboard";
  });
  createEffect(() => {
    if (opts.suspended?.()) {
      setLiveState("idle");
      return;
    }
    configAccessor();
    state.repoPath();
    watchEpoch();
    if (!liveShown() || !service.isAvailable() || service.isFrozen()) return;
    const epoch = lifecycle.getEpoch();
    const ctrl = new AbortController();
    void service.runWatchSession(ctrl.signal, epoch);
    onCleanup(() => {
      ctrl.abort();
    });
  });

  return {
    getCommitData: sha => {
      dataVersion();
      return service.getCommitData(sha);
    },
    heldEntries: () => {
      dataVersion();
      return service.heldEntries();
    },
    refresh: service.refresh,
    fetchCommitDataForSHA: service.fetchCommitDataForSHA,
    isLoading: () => liveState() === "loading",
    liveAge: () => (liveState() === "live" ? "live" : ""),
    isAvailable: service.isAvailable,
    invalidate: lifecycle.resetCaches,
    loadBuildLog: service.loadBuildLog,
    loadPodLog: service.loadPodLog,
    followLog: service.followLog,
    loadResourceObject: service.loadResourceObject,
    loadResourceEvents: service.loadResourceEvents,
  };
}
