/**
 * When a provider fetches, without any UI framework: the first fetch when its view or the Dashboard opens, quiet
 * catch-up for new commits, one fetch a repository's graph asks for once it loads, auto refresh while it is watched,
 * a Reload queued behind a running fetch, backoff after failures, cancelling on leaving, switching and suspending.
 *
 * The provider does the fetching (`runInitialFetch`, `runRefresh`); the app tells the lifecycle what changed (its
 * view, its graph, its identity, suspension) through the `on…` methods, and gives it what it reads and the time.
 * The Solid adapter (providers/shared/use-provider-fetch-lifecycle.ts) calls those methods from effects; a test can
 * call them directly.
 */
import { collectTopSHAs } from "../providers/github-actions/sha-selection";
import { isAbortError } from "../providers/shared/http";
import { monotonicNow, NEVER } from "../utils/monotonic";

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

/** What the lifecycle reads from the app, and the time. */
export interface LifecycleEnvironment {
  /** The view shown: a provider's own id, `dashboard`, `git`. */
  view: () => string;
  repoPath: () => string;
  graphRows: () => readonly { commit: { hash: string } }[];
  /** The app's auto refresh period (ms; 0 is off), unless the provider has its own. */
  autoRefreshInterval: () => number;
  suspended: () => boolean;
  /**
   * Runs `fn` without its reads counting as the caller's dependencies (Solid's `untrack`). The adapter's effects call
   * the `on…` methods inside a tracking scope, so what the lifecycle reads to decide is tracked like the effects did,
   * and what it starts (the fetches) is not.
   */
  untracked: <T>(fn: () => T) => T;
  now?: () => number;
  setInterval?: (run: () => void, ms: number) => unknown;
  clearInterval?: (timer: unknown) => void;
  /** The repository's provider data started over: the app's views of it read again. */
  onReset: () => void;
  /** How many fetches run now (the footer's `… fetching`). */
  onActiveFetches: (count: number) => void;
}

/** What the provider gives the lifecycle. */
export interface LifecycleProvider {
  providerId: string;
  shaLimit?: number | (() => number);
  isAvailable: () => boolean;
  isBackgroundReady: () => boolean;
  queriedSHAs: Set<string>;
  /** Skip graph-SHA background catch-up (inventory providers). */
  skipShaBackground?: boolean;
  /**
   * One quiet first fetch once the repository's graph is read, whatever the view (an inventory provider, which has no
   * graph-SHA catch-up). Once per repository: a failure waits for the provider's view, the dashboard or a Reload.
   */
  fetchOnLoad?: boolean;
  reportUnavailable: (showStatus: boolean) => void;
  runInitialFetch: (args: ProviderFetchArgs) => Promise<void>;
  runRefresh: (args: ProviderFetchArgs) => Promise<void>;
  onResetCaches: () => void;
  /** Override auto-refresh period. 0 or omit uses the app's. */
  refreshInterval?: () => number;
  /** A status-showing fetch was cancelled before it could settle the status: clear a leftover `loading`. */
  onCancelledStatus?: () => void;
}

export class FetchLifecycle {
  private fetchInFlight = false;
  /**
   * A request that arrived while another fetch ran. It keeps what the caller asked for (explicit retry, status,
   * selected SHAs, refresh vs initial) and runs once the current fetch settles; requests merge while waiting.
   */
  private pendingFetch: PendingFetch | null = null;
  /** Counts status-showing fetches as they start: only the latest may settle a `loading` it was cancelled under. */
  private statusFetchSeq = 0;
  private hasFetchedOnce = false;
  /** The `fetchOnLoad` fetch started for this repository. */
  private loadFetchStarted = false;
  /** The `fetchOnLoad` fetch while it runs: a view that opens meanwhile keeps it instead of fetching the same again. */
  private loadFetch: Promise<void> | null = null;
  private lastFetchedAt = NEVER;
  private autoRefreshTimer: unknown = null;
  private fetchAbortCtrl: AbortController | null = null;
  private backgroundFetchAbortCtrl: AbortController | null = null;
  private readonly activeRequestControllers = new Set<AbortController>();
  private cacheEpoch = 0;
  private consecutiveErrors = 0;
  private backoffUntil = 0;
  private activeFetches = 0;

  constructor(
    private readonly env: LifecycleEnvironment,
    private readonly provider: LifecycleProvider,
  ) {}

  private now(): number {
    return (this.env.now ?? monotonicNow)();
  }

  private currentShaLimit(): number {
    const value = this.provider.shaLimit;
    if (typeof value === "function") return value();
    return value ?? DEFAULT_INITIAL_SHA_LIMIT;
  }

  /**
   * Count provider data work while it runs. Provider activity (the footer's `… fetching`) reads this instead of the
   * provider status, which can stay `loading`; the count always drops in `finally`, so it cannot get stuck.
   */
  readonly trackFetch = async <T>(work: () => Promise<T>): Promise<T> => {
    this.setActiveFetches(this.activeFetches + 1);
    try {
      return await work();
    } finally {
      this.setActiveFetches(Math.max(0, this.activeFetches - 1));
    }
  };

  private setActiveFetches(count: number) {
    this.activeFetches = count;
    this.env.onActiveFetches(count);
  }

  readonly getEpoch = () => this.cacheEpoch;

  readonly isCurrent = (epoch: number, repoPath: string): boolean =>
    !this.env.suspended() && epoch === this.cacheEpoch && repoPath === this.env.repoPath();

  readonly runRequest = async <T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const ctrl = new AbortController();
    if (this.env.suspended()) ctrl.abort();
    const onAbort = () => ctrl.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    this.activeRequestControllers.add(ctrl);
    try {
      ctrl.signal.throwIfAborted();
      return await run(ctrl.signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.activeRequestControllers.delete(ctrl);
    }
  };

  readonly noteFetchStarted = () => {
    this.hasFetchedOnce = true;
    this.lastFetchedAt = this.now();
  };

  readonly noteRefreshSettled = () => {
    this.lastFetchedAt = this.now();
  };

  readonly noteFetchResult = (ok: boolean) => {
    if (ok) {
      this.consecutiveErrors = 0;
      this.backoffUntil = 0;
      return;
    }
    this.consecutiveErrors++;
    const delayMs = Math.min(30_000 * 2 ** (this.consecutiveErrors - 1), 300_000);
    this.backoffUntil = this.now() + delayMs;
  };

  private inBackoff() {
    return this.now() < this.backoffUntil;
  }

  /** Queue a request behind the running fetch; the promise settles once the queued request has run (or is dropped). */
  private queueFetch(next: Omit<PendingFetch, "waiters">): Promise<void> {
    return new Promise(resolve => {
      const current = this.pendingFetch;
      this.pendingFetch = current
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

  private settleWaiters(request: PendingFetch | null) {
    for (const resolve of request?.waiters ?? []) resolve();
  }

  private finishFetch(epoch: number) {
    if (this.env.suspended() || epoch !== this.cacheEpoch) return;
    this.fetchInFlight = false;
    const next = this.pendingFetch;
    if (!next) return;
    this.pendingFetch = null;
    const ctrl = new AbortController();
    this.backgroundFetchAbortCtrl = ctrl;
    let run: Promise<void>;
    if (next.kind === "refresh") run = this.fetchRefresh(ctrl.signal, next.showStatus, next.retry);
    else {
      // The window and the commits callers named; no named commits means the provider's own window (undefined).
      const shas = !next.window
        ? next.shas
        : next.shas.length > 0
          ? [...new Set([...collectTopSHAs(this.env.graphRows(), this.currentShaLimit()), ...next.shas])]
          : undefined;
      run = this.fetchInitial(ctrl.signal, shas, next.showStatus, next.retry);
    }
    void run.finally(() => this.settleWaiters(next));
  }

  /**
   * A fetch that showed `loading` was cancelled (view switch): let the provider settle that status, unless a newer
   * status-showing fetch (e.g. after a repository switch) has started and owns it now.
   */
  private settleIfCancelled(signal: AbortSignal | undefined, seq: number | null) {
    if (seq !== null && seq === this.statusFetchSeq && signal?.aborted) this.provider.onCancelledStatus?.();
  }

  readonly fetchInitial = async (signal?: AbortSignal, shas?: string[], showStatus = false, retry = false) => {
    if (this.env.suspended()) return;
    const epoch = this.cacheEpoch;
    if (!showStatus && this.inBackoff()) return;
    if (this.fetchInFlight)
      return this.queueFetch({ kind: "initial", shas: shas ?? [], window: !shas, showStatus, retry });
    if (!this.provider.isAvailable()) {
      this.provider.reportUnavailable(showStatus);
      return;
    }
    this.fetchInFlight = true;
    const seq = showStatus ? ++this.statusFetchSeq : null;
    try {
      await this.trackFetch(() =>
        this.runRequest(signal => this.provider.runInitialFetch({ signal, shas, showStatus, retry, epoch }), signal),
      );
    } catch (err) {
      if (epoch === this.cacheEpoch && !isAbortError(err, signal)) throw err;
    } finally {
      this.settleIfCancelled(signal, seq);
      this.finishFetch(epoch);
    }
  };

  readonly fetchRefresh = async (signal?: AbortSignal, showStatus = false, retry = false) => {
    if (this.env.suspended()) return;
    const epoch = this.cacheEpoch;
    if (!showStatus && this.inBackoff()) return;
    if (this.fetchInFlight) return this.queueFetch({ kind: "refresh", shas: [], window: true, showStatus, retry });
    if (!this.provider.isAvailable()) return;
    this.fetchInFlight = true;
    const seq = showStatus ? ++this.statusFetchSeq : null;
    try {
      await this.trackFetch(() =>
        this.runRequest(signal => this.provider.runRefresh({ signal, showStatus, retry, epoch }), signal),
      );
    } catch (err) {
      if (epoch === this.cacheEpoch && !isAbortError(err, signal)) throw err;
    } finally {
      this.settleIfCancelled(signal, seq);
      this.finishFetch(epoch);
    }
  };

  /**
   * The views that keep this provider fresh: its own tab, and the dashboard, which shows its events. Only its own tab
   * shows loading: on the dashboard it fetches quietly.
   */
  private watched(): boolean {
    const view = this.env.view();
    return view === this.provider.providerId || view === "dashboard";
  }

  private currentInterval(): number {
    return this.provider.refreshInterval?.() ?? this.env.autoRefreshInterval();
  }

  readonly startAutoRefresh = () => {
    if (this.env.suspended()) return;
    if (this.autoRefreshTimer) return;
    const interval = this.currentInterval();
    if (interval <= 0) return;
    const schedule = this.env.setInterval ?? ((run: () => void, ms: number) => setInterval(run, ms));
    this.autoRefreshTimer = schedule(() => {
      if (!this.watched()) return;
      if (this.fetchInFlight) return;
      const ctrl = new AbortController();
      this.fetchAbortCtrl = ctrl;
      void this.fetchRefresh(ctrl.signal);
    }, interval);
  };

  private clearRefreshTimer() {
    if (this.autoRefreshTimer) {
      (this.env.clearInterval ?? (timer => clearInterval(timer as ReturnType<typeof setInterval>)))(
        this.autoRefreshTimer,
      );
      this.autoRefreshTimer = null;
    }
  }

  private stopAutoRefresh() {
    this.clearRefreshTimer();
    if (this.fetchAbortCtrl) {
      this.fetchAbortCtrl.abort();
      this.fetchAbortCtrl = null;
    }
  }

  /** Everything running or waiting stops: suspension, a reset, disposal. */
  readonly cancelRequests = () => {
    this.cacheEpoch++;
    if (this.fetchInFlight) this.lastFetchedAt = NEVER;
    this.stopAutoRefresh();
    this.fetchAbortCtrl?.abort();
    this.fetchAbortCtrl = null;
    this.backgroundFetchAbortCtrl?.abort();
    this.backgroundFetchAbortCtrl = null;
    this.loadFetch = null;
    for (const ctrl of this.activeRequestControllers) ctrl.abort();
    this.activeRequestControllers.clear();
    this.fetchInFlight = false;
    const dropped = this.pendingFetch;
    this.pendingFetch = null;
    this.settleWaiters(dropped);
  };

  /** The repository's provider data starts over (another repository, other settings, a cache removed). */
  readonly resetCaches = () => {
    this.cancelRequests();
    this.hasFetchedOnce = false;
    this.loadFetchStarted = false;
    this.lastFetchedAt = NEVER;
    this.consecutiveErrors = 0;
    this.backoffUntil = 0;
    this.provider.onResetCaches();
    this.env.onReset();
  };

  // ── What changed: the adapter calls these when what they read changes ─────────────────────────────

  /** The view, the suspension or the provider's data changed: a watched view fetches, others stop refreshing. */
  readonly onViewChange = () => {
    if (this.env.suspended()) return;
    const view = this.env.view();
    if (!this.watched()) {
      // Leaving both views cancels what entering them started (stopAutoRefresh aborts fetchAbortCtrl).
      this.stopAutoRefresh();
      return;
    }
    // Moving between the dashboard and the provider's tab keeps a running fetch: it is the same data.
    const showStatus = view === this.provider.providerId;
    if (!this.hasFetchedOnce) {
      if (this.fetchInFlight && (this.fetchAbortCtrl || this.loadFetch)) return this.startAutoRefresh();
      const controller = new AbortController();
      this.fetchAbortCtrl = controller;
      this.env.untracked(() => void this.fetchInitial(controller.signal, undefined, showStatus));
    } else {
      const interval = this.currentInterval();
      const staleThreshold = interval > 0 ? interval : 30_000;
      if (this.now() - this.lastFetchedAt > staleThreshold && !this.fetchInFlight) {
        const controller = new AbortController();
        this.fetchAbortCtrl = controller;
        this.env.untracked(() => void this.fetchRefresh(controller.signal, showStatus));
      }
    }
    this.startAutoRefresh();
  };

  /** The graph or the suspension changed: an inventory provider's one fetch once the repository loads. */
  readonly onGraphLoad = () => {
    if (!this.provider.fetchOnLoad) return;
    // Suspension cancels it: the fetch starts again after.
    if (this.env.suspended()) {
      if (!this.hasFetchedOnce) this.loadFetchStarted = false;
      return;
    }
    if (
      this.env.graphRows().length === 0 ||
      this.loadFetchStarted ||
      this.hasFetchedOnce ||
      !this.provider.isAvailable()
    )
      return;
    // A view's first fetch runs already: it is the same list.
    if (this.fetchInFlight) return;
    this.loadFetchStarted = true;
    const ctrl = new AbortController();
    this.backgroundFetchAbortCtrl = ctrl;
    const run = this.env.untracked(() => this.fetchInitial(ctrl.signal, undefined, false));
    this.loadFetch = run;
    void run.finally(() => {
      if (this.loadFetch === run) this.loadFetch = null;
    });
  };

  /** The graph changed: commits not asked about yet are fetched quietly. */
  readonly onGraphCommits = () => {
    if (this.env.suspended()) return;
    if (this.provider.skipShaBackground) return;
    const rows = this.env.graphRows();
    if (rows.length === 0) return;
    if (!this.provider.isBackgroundReady()) return;

    const allSHAs = collectTopSHAs(rows, this.currentShaLimit());
    const newSHAs = allSHAs.filter(sha => !this.provider.queriedSHAs.has(sha));
    if (newSHAs.length === 0) return;

    if (this.fetchInFlight) {
      void this.queueFetch({ kind: "initial", shas: allSHAs, window: false, showStatus: false, retry: false });
      return;
    }
    const ctrl = new AbortController();
    this.backgroundFetchAbortCtrl = ctrl;
    this.env.untracked(() => void this.fetchInitial(ctrl.signal, allSHAs, false));
  };

  /** The auto refresh period changed: a watched view restarts its timer with it. */
  readonly onIntervalChange = () => {
    if (this.env.suspended()) return;
    this.provider.refreshInterval?.();
    this.env.autoRefreshInterval();
    if (this.watched()) {
      this.clearRefreshTimer();
      this.startAutoRefresh();
    }
  };

  /** The adapter's owner is gone: nothing runs on. */
  readonly dispose = () => this.cancelRequests();
}
