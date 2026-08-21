import { createEffect, createSignal, onCleanup } from "solid-js";
import type { AppState } from "../../context/state";
import { collectTopSHAs } from "../github-actions/sha-selection";

export const DEFAULT_INITIAL_SHA_LIMIT = 100;

export interface ProviderFetchArgs {
  signal?: AbortSignal;
  shas?: string[];
  showStatus: boolean;
  epoch: number;
}

export function useProviderFetchLifecycle(opts: {
  state: AppState;
  providerId: string;
  shaLimit?: number;
  identity: () => string;
  isAvailable: () => boolean;
  isBackgroundReady: () => boolean;
  queriedSHAs: Set<string>;
  /** Skip graph-SHA background catch-up (inventory providers). */
  skipShaBackground?: boolean;
  reportUnavailable: (showStatus: boolean) => void;
  runInitialFetch: (args: ProviderFetchArgs) => Promise<void>;
  runRefresh: (args: ProviderFetchArgs) => Promise<void>;
  onResetCaches: () => void;
}) {
  const { state, providerId } = opts;
  const shaLimit = opts.shaLimit ?? DEFAULT_INITIAL_SHA_LIMIT;

  let fetchInFlight = false;
  let pendingBackgroundFetch = false;
  let hasFetchedOnce = false;
  let lastFetchedAt = 0;
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let fetchAbortCtrl: AbortController | null = null;
  let backgroundFetchAbortCtrl: AbortController | null = null;
  let cacheEpoch = 0;
  const [identityVersion, setIdentityVersion] = createSignal(0);

  function getEpoch() {
    return cacheEpoch;
  }

  function noteFetchStarted() {
    hasFetchedOnce = true;
    lastFetchedAt = Date.now();
  }

  function noteRefreshSettled() {
    lastFetchedAt = Date.now();
  }

  function finishFetch(epoch: number) {
    if (epoch !== cacheEpoch) return;
    fetchInFlight = false;
    if (!pendingBackgroundFetch) return;
    pendingBackgroundFetch = false;
    const ctrl = new AbortController();
    backgroundFetchAbortCtrl = ctrl;
    void fetchInitial(ctrl.signal, undefined, false);
  }

  async function fetchInitial(signal?: AbortSignal, shas?: string[], showStatus = false) {
    const epoch = cacheEpoch;
    if (fetchInFlight) {
      pendingBackgroundFetch = true;
      return;
    }
    if (!opts.isAvailable()) {
      opts.reportUnavailable(showStatus);
      return;
    }
    fetchInFlight = true;
    try {
      await opts.runInitialFetch({ signal, shas, showStatus, epoch });
    } finally {
      finishFetch(epoch);
    }
  }

  async function fetchRefresh(signal?: AbortSignal, showStatus = false) {
    const epoch = cacheEpoch;
    if (fetchInFlight) {
      pendingBackgroundFetch = true;
      return;
    }
    if (!opts.isAvailable()) return;
    fetchInFlight = true;
    try {
      await opts.runRefresh({ signal, showStatus, epoch });
    } finally {
      finishFetch(epoch);
    }
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) return;
    const interval = state.autoRefreshInterval();
    if (interval <= 0) return;
    autoRefreshTimer = setInterval(() => {
      if (state.activeProviderView() !== providerId) return;
      if (fetchAbortCtrl) fetchAbortCtrl.abort();
      const ctrl = new AbortController();
      fetchAbortCtrl = ctrl;
      void fetchRefresh(ctrl.signal);
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

  function resetCaches() {
    cacheEpoch++;
    stopAutoRefresh();
    backgroundFetchAbortCtrl?.abort();
    backgroundFetchAbortCtrl = null;
    fetchInFlight = false;
    pendingBackgroundFetch = false;
    hasFetchedOnce = false;
    lastFetchedAt = 0;
    opts.onResetCaches();
    setIdentityVersion(v => v + 1);
  }

  let previousIdentity = "";
  createEffect(() => {
    const identity = opts.identity();
    if (!previousIdentity) {
      previousIdentity = identity;
      return;
    }
    if (identity === previousIdentity) return;
    previousIdentity = identity;
    resetCaches();
  });

  createEffect(() => {
    identityVersion();
    const view = state.activeProviderView();
    if (view !== providerId) {
      stopAutoRefresh();
      return;
    }
    if (!hasFetchedOnce) {
      const controller = new AbortController();
      fetchAbortCtrl = controller;
      void fetchInitial(controller.signal, undefined, true);
      onCleanup(() => {
        controller.abort();
        if (fetchAbortCtrl === controller) fetchAbortCtrl = null;
      });
    } else {
      const interval = state.autoRefreshInterval();
      const staleThreshold = interval > 0 ? interval : 30_000;
      if (Date.now() - lastFetchedAt > staleThreshold) {
        const controller = new AbortController();
        fetchAbortCtrl = controller;
        void fetchRefresh(controller.signal, true);
        onCleanup(() => {
          controller.abort();
          if (fetchAbortCtrl === controller) fetchAbortCtrl = null;
        });
      }
    }
    startAutoRefresh();
    onCleanup(stopAutoRefresh);
  });

  createEffect(() => {
    identityVersion();
    if (opts.skipShaBackground) return;
    const rows = state.graphRows();
    if (rows.length === 0) return;
    if (!opts.isBackgroundReady()) return;

    const allSHAs = collectTopSHAs(rows, shaLimit);
    const newSHAs = allSHAs.filter(sha => !opts.queriedSHAs.has(sha));
    if (newSHAs.length === 0) return;

    if (fetchInFlight) {
      pendingBackgroundFetch = true;
      return;
    }
    const ctrl = new AbortController();
    backgroundFetchAbortCtrl = ctrl;
    void fetchInitial(ctrl.signal, allSHAs, false);
  });

  createEffect(() => {
    const _interval = state.autoRefreshInterval();
    if (state.activeProviderView() === providerId) {
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

  return {
    getEpoch,
    noteFetchStarted,
    noteRefreshSettled,
    resetCaches,
    startAutoRefresh,
    fetchInitial,
    fetchRefresh,
  };
}
