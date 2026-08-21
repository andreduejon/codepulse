import type { Accessor } from "solid-js";
import { createEffect, createSignal, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import {
  providerError,
  providerIdle,
  providerLoading,
  providerUnavailable,
  providerWarning,
} from "../../context/state";
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
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
  createEffect(() => {
    const partial = configAccessor();
    config = { ...DEFAULT_OPENSHIFT_CONFIG, ...partial, namespaces: partial.namespaces ?? [] };
  });

  const isAvailable = () =>
    config.enabled &&
    !!config.serverUrl.trim() &&
    config.namespaces.length > 0 &&
    getOpenShiftToken(config.tokenEnvVar) !== null;

  createEffect(() => {
    if (configAccessor().enabled === true)
      state.providers.register({ id: "openshift", displayName: "OpenShift", isAvailable });
    else {
      state.providers.unregister("openshift");
      if (untrack(state.activeProviderView) === "openshift") actions.setActiveProviderView("git");
    }
  });

  const cache = new Map<string, OpenShiftCommitData>();
  const [version, setVersion] = createSignal(0);
  const queriedSHAs = new Set<string>();

  function unavailableMessage(): string {
    if (!config.serverUrl.trim()) return "OpenShift unavailable: server URL not configured";
    if (config.namespaces.length === 0) return "OpenShift unavailable: no namespaces configured";
    if (!getOpenShiftToken(config.tokenEnvVar)) return `OpenShift unavailable: missing ${config.tokenEnvVar}`;
    return "OpenShift unavailable";
  }

  const lifecycle = useProviderFetchLifecycle({
    state,
    providerId: "openshift",
    skipShaBackground: true,
    identity: () => {
      const partial = configAccessor();
      return JSON.stringify({
        repoPath: state.repoPath(),
        enabled: partial.enabled ?? DEFAULT_OPENSHIFT_CONFIG.enabled,
        serverUrl: partial.serverUrl ?? "",
        tokenEnvVar: partial.tokenEnvVar ?? DEFAULT_OPENSHIFT_CONFIG.tokenEnvVar,
        namespaces: partial.namespaces ?? [],
        commitShaAnnotation: partial.commitShaAnnotation ?? DEFAULT_OPENSHIFT_CONFIG.commitShaAnnotation,
      });
    },
    isAvailable,
    isBackgroundReady: () => false,
    queriedSHAs,
    reportUnavailable: showStatus => {
      if (showStatus) actions.setProviderStatus("openshift", providerUnavailable(unavailableMessage()));
    },
    runInitialFetch: async ({ signal, showStatus, epoch }) => {
      await runInventory({ signal, showStatus, epoch });
    },
    runRefresh: async ({ signal, showStatus, epoch }) => {
      await runInventory({ signal, showStatus, epoch });
    },
    onResetCaches: () => {
      cache.clear();
      queriedSHAs.clear();
      setVersion(v => v + 1);
      actions.setGraphBadges("openshift", new Map());
      actions.setProviderStatus("openshift", providerIdle());
    },
  });

  async function runInventory(args: { signal?: AbortSignal; showStatus: boolean; epoch: number }) {
    const token = getOpenShiftToken(config.tokenEnvVar);
    if (!token) return;
    const requestConfig = config;
    if (args.showStatus) actions.setProviderStatus("openshift", providerLoading());
    try {
      const result = await fetchOpenShiftInventory(requestConfig, token, args.signal);
      if (args.signal?.aborted || args.epoch !== lifecycle.getEpoch()) return;
      if (result.successfulRequests === 0 && result.error) {
        actions.setProviderStatus("openshift", providerError(result.error));
        return;
      }
      if (result.error && cache.size > 0) {
        for (const failure of result.failures) console.debug("OpenShift inventory request failed", failure);
        actions.setProviderStatus("openshift", providerWarning(result.error));
        return;
      }
      cache.clear();
      for (const [sha, data] of result.data) cache.set(sha, data);
      actions.setGraphBadges("openshift", buildOpenShiftGraphBadges(cache));
      setVersion(v => v + 1);
      lifecycle.noteFetchStarted();
      if (result.error) {
        for (const failure of result.failures) console.debug("OpenShift inventory request failed", failure);
        actions.setProviderStatus("openshift", providerWarning(result.error));
      } else {
        actions.setProviderStatus("openshift", providerIdle());
        actions.setProviderLastSuccessfulRefresh("openshift", new Date());
      }
    } catch (err) {
      if (!args.signal?.aborted && args.epoch === lifecycle.getEpoch())
        actions.setProviderStatus("openshift", providerError(err instanceof Error ? err.message : String(err)));
    }
  }

  return {
    getCommitData: sha => {
      version();
      return cache.get(sha) ?? null;
    },
    refresh: async () => lifecycle.fetchRefresh(undefined, true),
    fetchCommitDataForSHA: async () => {
      await lifecycle.fetchInitial(undefined, undefined, true);
    },
    isAvailable,
  };
}
