import { type Accessor, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { AppState } from "../../context/state";
import { collectTopSHAs } from "../github-actions/sha-selection";
import { isAbortError } from "./http";

export const DEFAULT_INITIAL_SHA_LIMIT = 100;

export interface ProviderFetchArgs {
  signal?: AbortSignal;
  shas?: string[];
  showStatus: boolean;
  /**
   * An explicit user retry (Reload commit, `:reload`, `f`): the only thing that lifts an auth freeze. Automatic
   * fetches (view entry, polling) may show status but never count as a retry.
   */
  retry: boolean;
  epoch: number;
}

interface PendingFetch {
  kind: "initial" | "refresh";
  /** Commits a caller named (a Reload of one commit, background catch-up). */
  shas: string[];
  /** A caller asked for the whole graph window; the named commits are fetched alongside it. */
  window: boolean;
  showStatus: boolean;
  retry: boolean;
  /** Callers awaiting the request: settled once it has run, or when a cancel drops it. */
  waiters: (() => void)[];
}

export function useProviderFetchLifecycle(opts: {
  state: AppState;
  providerId: string;
  suspended?: Accessor<boolean>;
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
  /** A status-showing fetch was cancelled before it could settle the status: clear a leftover `loading`. */
  onCancelledStatus?: () => void;
}) {
  const { state, providerId } = opts;

  function currentShaLimit(): number {
    const value = opts.shaLimit;
    if (typeof value === "function") return value();
    return value ?? DEFAULT_INITIAL_SHA_LIMIT;
  }

  let fetchInFlight = false;
  /**
   * A request that arrived while another fetch ran. It keeps what the caller asked for (explicit retry, status,
   * selected SHAs, refresh vs initial) and runs once the current fetch settles; requests merge while waiting.
   */
  let pendingFetch: PendingFetch | null = null;
  /** Counts status-showing fetches as they start: only the latest may settle a `loading` it was cancelled under. */
  let statusFetchSeq = 0;
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
  const [activeFetches, setActiveFetches] = createSignal(0);

  /**
   * Count provider data work while it runs. Provider activity (the footer's `… fetching`) reads this instead of the
   * provider status, which can stay `loading`; the count always drops in `finally`, so it cannot get stuck.
   */
  async function trackFetch<T>(work: () => Promise<T>): Promise<T> {
    setActiveFetches(count => count + 1);
    try {
      return await work();
    } finally {
      setActiveFetches(count => Math.max(0, count - 1));
    }
  }

  function getEpoch() {
    return cacheEpoch;
  }

  function isCurrent(epoch: number, repoPath: string): boolean {
    return !opts.suspended?.() && epoch === cacheEpoch && repoPath === state.repoPath();
  }

  async function runRequest<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const ctrl = new AbortController();
    if (opts.suspended?.()) ctrl.abort();
    const onAbort = () => ctrl.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    activeRequestControllers.add(ctrl);
    try {
      ctrl.signal.throwIfAborted();
      return await run(ctrl.signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      activeRequestControllers.delete(ctrl);
    }
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

  /** Queue a request behind the running fetch; the promise settles once the queued request has run (or is dropped). */
  function queueFetch(next: Omit<PendingFetch, "waiters">): Promise<void> {
    return new Promise(resolve => {
      const current = pendingFetch;
      pendingFetch = current
        ? {
            kind: current.kind === "initial" || next.kind === "initial" ? "initial" : "refresh",
            shas: [...new Set([...current.shas, ...next.shas])],
            window: current.window || next.window,
            showStatus: current.showStatus || next.showStatus,
            retry: current.retry || next.retry,
            waiters: [...current.waiters, resolve],
          }
        : { ...next, waiters: [resolve] };
    });
  }

  function settleWaiters(request: PendingFetch | null) {
    for (const resolve of request?.waiters ?? []) resolve();
  }

  function finishFetch(epoch: number) {
    if (opts.suspended?.() || epoch !== cacheEpoch) return;
    fetchInFlight = false;
    const next = pendingFetch;
    if (!next) return;
    pendingFetch = null;
    const ctrl = new AbortController();
    backgroundFetchAbortCtrl = ctrl;
    let run: Promise<void>;
    if (next.kind === "refresh") run = fetchRefresh(ctrl.signal, next.showStatus, next.retry);
    else {
      // The window and the commits callers named; no named commits means the provider's own window (undefined).
      const shas = !next.window
        ? next.shas
        : next.shas.length > 0
          ? [...new Set([...collectTopSHAs(state.graphRows(), currentShaLimit()), ...next.shas])]
          : undefined;
      run = fetchInitial(ctrl.signal, shas, next.showStatus, next.retry);
    }
    void run.finally(() => settleWaiters(next));
  }

  /**
   * A fetch that showed `loading` was cancelled (view switch): let the provider settle that status, unless a newer
   * status-showing fetch (e.g. after a repository switch) has started and owns it now.
   */
  function settleIfCancelled(signal: AbortSignal | undefined, seq: number | null) {
    if (seq !== null && seq === statusFetchSeq && signal?.aborted) opts.onCancelledStatus?.();
  }

  async function fetchInitial(signal?: AbortSignal, shas?: string[], showStatus = false, retry = false) {
    if (opts.suspended?.()) return;
    const epoch = cacheEpoch;
    if (!showStatus && inBackoff()) return;
    if (fetchInFlight) return queueFetch({ kind: "initial", shas: shas ?? [], window: !shas, showStatus, retry });
    if (!opts.isAvailable()) {
      opts.reportUnavailable(showStatus);
      return;
    }
    fetchInFlight = true;
    const seq = showStatus ? ++statusFetchSeq : null;
    try {
      await trackFetch(() =>
        runRequest(signal => opts.runInitialFetch({ signal, shas, showStatus, retry, epoch }), signal),
      );
    } catch (err) {
      if (epoch === cacheEpoch && !isAbortError(err, signal)) throw err;
    } finally {
      settleIfCancelled(signal, seq);
      finishFetch(epoch);
    }
  }

  async function fetchRefresh(signal?: AbortSignal, showStatus = false, retry = false) {
    if (opts.suspended?.()) return;
    const epoch = cacheEpoch;
    if (!showStatus && inBackoff()) return;
    if (fetchInFlight) return queueFetch({ kind: "refresh", shas: [], window: true, showStatus, retry });
    if (!opts.isAvailable()) return;
    fetchInFlight = true;
    const seq = showStatus ? ++statusFetchSeq : null;
    try {
      await trackFetch(() => runRequest(signal => opts.runRefresh({ signal, showStatus, retry, epoch }), signal));
    } catch (err) {
      if (epoch === cacheEpoch && !isAbortError(err, signal)) throw err;
    } finally {
      settleIfCancelled(signal, seq);
      finishFetch(epoch);
    }
  }

  function currentInterval(): number {
    return opts.refreshInterval?.() ?? state.autoRefreshInterval();
  }

  function startAutoRefresh() {
    if (opts.suspended?.()) return;
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

  function cancelRequests() {
    cacheEpoch++;
    if (fetchInFlight) lastFetchedAt = 0;
    stopAutoRefresh();
    fetchAbortCtrl?.abort();
    fetchAbortCtrl = null;
    backgroundFetchAbortCtrl?.abort();
    backgroundFetchAbortCtrl = null;
    for (const ctrl of activeRequestControllers) ctrl.abort();
    activeRequestControllers.clear();
    fetchInFlight = false;
    const dropped = pendingFetch;
    pendingFetch = null;
    settleWaiters(dropped);
  }

  function resetCaches() {
    cancelRequests();
    hasFetchedOnce = false;
    lastFetchedAt = 0;
    consecutiveErrors = 0;
    backoffUntil = 0;
    opts.onResetCaches();
    setIdentityVersion(v => v + 1);
  }

  createEffect(() => {
    if (opts.suspended?.()) untrack(cancelRequests);
  });

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
    if (opts.suspended?.()) return;
    const view = state.activeProviderView();
    if (view !== providerId) {
      stopAutoRefresh();
      return;
    }
    if (!hasFetchedOnce) {
      const controller = new AbortController();
      fetchAbortCtrl = controller;
      // Untracked: signals the fetch reads (badges, repo) must not re-run this effect, whose cleanup would abort it.
      untrack(() => void fetchInitial(controller.signal, undefined, true));
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
        untrack(() => void fetchRefresh(controller.signal, true));
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
    if (opts.suspended?.()) return;
    if (opts.skipShaBackground) return;
    const rows = state.graphRows();
    if (rows.length === 0) return;
    if (!opts.isBackgroundReady()) return;

    const allSHAs = collectTopSHAs(rows, currentShaLimit());
    const newSHAs = allSHAs.filter(sha => !opts.queriedSHAs.has(sha));
    if (newSHAs.length === 0) return;

    if (fetchInFlight) {
      void queueFetch({ kind: "initial", shas: allSHAs, window: false, showStatus: false, retry: false });
      return;
    }
    const ctrl = new AbortController();
    backgroundFetchAbortCtrl = ctrl;
    untrack(() => void fetchInitial(ctrl.signal, allSHAs, false));
  });

  createEffect(() => {
    if (opts.suspended?.()) return;
    opts.refreshInterval?.();
    state.autoRefreshInterval();
    if (state.activeProviderView() === providerId) {
      clearRefreshTimer();
      startAutoRefresh();
    }
  });

  onCleanup(cancelRequests);

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
    runRequest,
    trackFetch,
    /** True while a graph fetch, refresh or tracked reload runs. */
    isFetching: () => activeFetches() > 0,
  };
}
