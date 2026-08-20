import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import {
  providerError,
  providerIdle,
  providerLoading,
  providerUnavailable,
  providerWarning,
} from "../../context/state";
import { registerProvider, unregisterProvider } from "../provider";
import { buildOpenShiftGraphBadges, fetchOpenShiftInventory, getOpenShiftToken } from "./api";
import type { OpenShiftCommitData, OpenShiftProviderConfig } from "./types";
import { DEFAULT_OPENSHIFT_CONFIG } from "./types";

export interface UseOpenShiftResult {
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  refresh: () => Promise<void>;
  fetchCommitDataForSHA: (sha: string) => Promise<void>;
  isAvailable: () => boolean;
}

export function useOpenShift(opts: {
  state: AppState;
  actions: AppActions;
  config?: Partial<OpenShiftProviderConfig> | Accessor<Partial<OpenShiftProviderConfig>>;
}): UseOpenShiftResult {
  const { state, actions } = opts;
  const configAccessor: Accessor<Partial<OpenShiftProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<OpenShiftProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<OpenShiftProviderConfig>>);

  let config: OpenShiftProviderConfig = { ...DEFAULT_OPENSHIFT_CONFIG, ...configAccessor() };

  const isAvailable = () =>
    config.enabled &&
    !!config.serverUrl.trim() &&
    config.namespaces.length > 0 &&
    getOpenShiftToken(config.tokenEnvVar) !== null;

  createEffect(() => {
    if (configAccessor().enabled === true) registerProvider({ id: "openshift", displayName: "OpenShift", isAvailable });
    else {
      unregisterProvider("openshift");
      if (untrack(state.activeProviderView) === "openshift") actions.setActiveProviderView("git");
    }
  });

  const cache = new Map<string, OpenShiftCommitData>();
  const [version, setVersion] = createSignal(0);
  let hasFetchedOnce = false;
  let activeRequest = 0;
  let fetchAbortCtrl: AbortController | null = null;
  let backgroundFetchAbortCtrl: AbortController | null = null;
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  function unavailableMessage(): string {
    if (!config.serverUrl.trim()) return "OpenShift unavailable: server URL not configured";
    if (config.namespaces.length === 0) return "OpenShift unavailable: no namespaces configured";
    if (!getOpenShiftToken(config.tokenEnvVar)) return `OpenShift unavailable: missing ${config.tokenEnvVar}`;
    return "OpenShift unavailable";
  }

  async function doFetch(signal?: AbortSignal, showStatus = false) {
    if (!isAvailable()) {
      if (showStatus) actions.setProviderStatus("openshift", providerUnavailable(unavailableMessage()));
      return;
    }
    const token = getOpenShiftToken(config.tokenEnvVar);
    if (!token) return;
    const request = ++activeRequest;
    const requestConfig = config;
    if (showStatus) actions.setProviderStatus("openshift", providerLoading());
    try {
      const result = await fetchOpenShiftInventory(requestConfig, token, signal);
      if (signal?.aborted || request !== activeRequest) return;
      if (result.successfulRequests === 0 && result.error) {
        actions.setProviderStatus("openshift", providerError(result.error));
        return;
      }
      cache.clear();
      for (const [sha, data] of result.data) cache.set(sha, data);
      actions.setGraphBadges("openshift", buildOpenShiftGraphBadges(cache));
      setVersion(v => v + 1);
      hasFetchedOnce = true;
      if (result.error) {
        for (const failure of result.failures) console.debug("OpenShift inventory request failed", failure);
        actions.setProviderStatus("openshift", providerWarning(result.error));
      } else {
        actions.setProviderStatus("openshift", providerIdle());
        actions.setProviderLastSuccessfulRefresh("openshift", new Date());
      }
    } catch (err) {
      if (!signal?.aborted && request === activeRequest)
        actions.setProviderStatus("openshift", providerError(err instanceof Error ? err.message : String(err)));
    }
  }

  createEffect(() => {
    const partial = configAccessor();
    config = { ...DEFAULT_OPENSHIFT_CONFIG, ...partial, namespaces: partial.namespaces ?? [] };
    activeRequest++;
    fetchAbortCtrl?.abort();
    backgroundFetchAbortCtrl?.abort();
    fetchAbortCtrl = null;
    backgroundFetchAbortCtrl = null;
    hasFetchedOnce = false;
    cache.clear();
    setVersion(version => version + 1);
    actions.setGraphBadges("openshift", new Map());

    if (!isAvailable()) {
      if (untrack(state.activeProviderView) === "openshift")
        actions.setProviderStatus("openshift", providerUnavailable(unavailableMessage()));
      return;
    }
    if (untrack(state.activeProviderView) !== "openshift" || untrack(state.graphRows).length === 0) return;
    fetchAbortCtrl = new AbortController();
    void doFetch(fetchAbortCtrl.signal, true);
  });

  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    fetchAbortCtrl?.abort();
    fetchAbortCtrl = null;
  }

  function startAutoRefresh() {
    if (autoRefreshTimer || state.autoRefreshInterval() <= 0) return;
    autoRefreshTimer = setInterval(() => {
      if (state.activeProviderView() !== "openshift") return;
      fetchAbortCtrl?.abort();
      fetchAbortCtrl = new AbortController();
      void doFetch(fetchAbortCtrl.signal);
    }, state.autoRefreshInterval());
  }

  createEffect(() => {
    if (state.activeProviderView() !== "openshift") {
      stopAutoRefresh();
      return;
    }
    if (!hasFetchedOnce) {
      fetchAbortCtrl = new AbortController();
      void doFetch(fetchAbortCtrl.signal, true);
      return;
    }
    startAutoRefresh();
  });

  createEffect(() => {
    state.autoRefreshInterval();
    if (state.activeProviderView() === "openshift") {
      stopAutoRefresh();
      startAutoRefresh();
    }
  });

  onCleanup(() => {
    stopAutoRefresh();
    backgroundFetchAbortCtrl?.abort();
    backgroundFetchAbortCtrl = null;
  });

  return {
    getCommitData: sha => {
      version();
      return cache.get(sha) ?? null;
    },
    refresh: async () => doFetch(undefined, true),
    fetchCommitDataForSHA: async () => {
      if (!hasFetchedOnce) await doFetch(undefined, true);
    },
    isAvailable,
  };
}
