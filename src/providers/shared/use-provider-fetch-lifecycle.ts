import { createEffect, createSignal, onCleanup } from "solid-js";
import type { AppState } from "../../context/state";
import { collectTopSHAs } from "../github-actions/sha-selection";
import { isAbortError } from "./http";

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
  shaLimit?: number | (() => number);
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
  /** Override auto-refresh period. 0 or omit uses `state.autoRefreshInterval()`. */
  refreshInterval?: () => number;
}) {
  const { state, providerId } = opts;

  function currentShaLimit(): number {
    const value = opts.shaLimit;
    if (typeof value === "function") return value();
    return value ?? DEFAULT_INITIAL_SHA_LIMIT;
  }

  let fetchInFlight = false;
  let pendingBackgroundFetch = false;
  let hasFetchedOnce = false;
  let lastFetchedAt = 0;
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let fetchAbortCtrl: AbortController | null = null;
  let backgroundFetchAbortCtrl: AbortController | null = null;
  const activeRequestControllers = new Set<AbortController>();
  let cacheEpoch = 0;
  let consecutiveErrors = 0;
  let backoffUntil = 0;
  const [identityVersion, setIdentityVersion] = createSignal(0);

  function getEpoch() {
    return cacheEpoch;
  }

  function isCurrent(epoch: number, repoPath: string): boolean {
    return epoch === cacheEpoch && repoPath === state.repoPath();
  }

  function noteFetchStarted() {
    hasFetchedOnce = true;
    lastFetchedAt = Date.now();
  }

  function noteRefreshSettled() {
    lastFetchedAt = Date.now();
  }

  function noteFetchResult(ok: boolean) {
    if (ok) {
      consecutiveErrors = 0;
      backoffUntil = 0;
      return;
    }
    consecutiveErrors++;
    const delayMs = Math.min(30_000 * 2 ** (consecutiveErrors - 1), 300_000);
    backoffUntil = Date.now() + delayMs;
  }

  function inBackoff() {
    return Date.now() < backoffUntil;
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
    if (!showStatus && inBackoff()) return;
    if (fetchInFlight) {
      pendingBackgroundFetch = true;
      return;
    }
    if (!opts.isAvailable()) {
      opts.reportUnavailable(showStatus);
      return;
    }
    fetchInFlight = true;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    activeRequestControllers.add(ctrl);
    try {
      await opts.runInitialFetch({ signal: ctrl.signal, shas, showStatus, epoch });
    } catch (err) {
      if (!isAbortError(err, ctrl.signal)) throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      activeRequestControllers.delete(ctrl);
      finishFetch(epoch);
    }
  }

  async function fetchRefresh(signal?: AbortSignal, showStatus = false) {
    const epoch = cacheEpoch;
    if (!showStatus && inBackoff()) return;
    if (fetchInFlight) {
      pendingBackgroundFetch = true;
      return;
    }
    if (!opts.isAvailable()) return;
    fetchInFlight = true;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    activeRequestControllers.add(ctrl);
    try {
      await opts.runRefresh({ signal: ctrl.signal, showStatus, epoch });
    } catch (err) {
      if (!isAbortError(err, ctrl.signal)) throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      activeRequestControllers.delete(ctrl);
      finishFetch(epoch);
    }
  }

  function currentInterval(): number {
    return opts.refreshInterval?.() ?? state.autoRefreshInterval();
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) return;
    const interval = currentInterval();
    if (interval <= 0) return;
    autoRefreshTimer = setInterval(() => {
      if (state.activeProviderView() !== providerId) return;
      if (fetchInFlight) return;
      const ctrl = new AbortController();
      fetchAbortCtrl = ctrl;
      void fetchRefresh(ctrl.signal);
    }, interval);
  }

  function clearRefreshTimer() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function stopAutoRefresh() {
    clearRefreshTimer();
    if (fetchAbortCtrl) {
      fetchAbortCtrl.abort();
      fetchAbortCtrl = null;
    }
  }

  function resetCaches() {
    cacheEpoch++;
    stopAutoRefresh();
    fetchAbortCtrl?.abort();
    fetchAbortCtrl = null;
    backgroundFetchAbortCtrl?.abort();
    backgroundFetchAbortCtrl = null;
    for (const ctrl of activeRequestControllers) ctrl.abort();
    activeRequestControllers.clear();
    fetchInFlight = false;
    pendingBackgroundFetch = false;
    hasFetchedOnce = false;
    lastFetchedAt = 0;
    consecutiveErrors = 0;
    backoffUntil = 0;
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
      const interval = currentInterval();
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

    const allSHAs = collectTopSHAs(rows, currentShaLimit());
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
    opts.refreshInterval?.();
    state.autoRefreshInterval();
    if (state.activeProviderView() === providerId) {
      clearRefreshTimer();
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
    isCurrent,
    noteFetchStarted,
    noteRefreshSettled,
    noteFetchResult,
    resetCaches,
    startAutoRefresh,
    fetchInitial,
    fetchRefresh,
  };
}
