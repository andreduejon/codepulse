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
import { BANNER } from "../../debug/banner";
import type { ProviderView } from "../provider";
import { buildSnykGraphBadges } from "./badges";
import { DEFAULT_SNYK_CACHE_LIMIT } from "./cache";
import { shouldReplaceSnykResult } from "./parser";
import { getCachedSnykScan, scanSnykCommit } from "./scanner";
import type { SnykCacheLimit, SnykScanResult } from "./types";

// provider.ts adds this identifier as part of the provider registration change.
const SNYK_PROVIDER_ID = "snyk" as ProviderView;
const EXACT_SHA = /^[0-9a-f]{40,64}$/i;

export function collectSnykAutoScanTips(
  branches: readonly { name: string; isRemote: boolean; lastCommitHash: string }[],
  configuredBranchNames: readonly string[],
): string[] {
  const configured = new Set(configuredBranchNames);
  return [
    ...new Set(
      branches
        .filter(branch => !branch.isRemote && configured.has(branch.name))
        .map(branch => branch.lastCommitHash.toLowerCase())
        .filter(sha => EXACT_SHA.test(sha)),
    ),
  ];
}

export function selectSnykCacheProbes(
  visibleSHAs: readonly string[],
  loadedSHAs: ReadonlySet<string>,
  probedSHAs: ReadonlySet<string>,
): string[] {
  return visibleSHAs.filter(sha => !loadedSHAs.has(sha) && !probedSHAs.has(sha));
}

export interface SnykProviderConfig {
  enabled: boolean;
  tokenEnvVar: string;
  autoScanBranches: string[];
  maxCachedScans: SnykCacheLimit;
}

export const DEFAULT_SNYK_PROVIDER_CONFIG: SnykProviderConfig = {
  enabled: false,
  tokenEnvVar: "SNYK_TOKEN",
  autoScanBranches: [],
  maxCachedScans: DEFAULT_SNYK_CACHE_LIMIT,
};

export interface UseSnykResult {
  getCommitData: (sha: string) => SnykScanResult | null;
  isScanning: (sha: string) => boolean;
  scanCommit: (sha: string, force?: boolean) => Promise<SnykScanResult | null>;
  isAvailable: () => boolean;
  invalidate: () => void;
  /** The error of a scan that failed while another view was open; cleared when the Snyk view opens. */
  backgroundError: () => string | null;
  dismissBackgroundError: () => void;
}

interface ScanQueueEntry {
  sha: string;
  force: boolean;
  epoch: number;
  repoPath: string;
  promise: Promise<SnykScanResult | null>;
  resolve: (result: SnykScanResult | null) => void;
}

export function useSnyk(opts: {
  state: AppState;
  actions: AppActions;
  config: Accessor<Partial<SnykProviderConfig>>;
  suspended?: Accessor<boolean>;
  scan?: typeof scanSnykCommit;
  readCache?: typeof getCachedSnykScan;
}): UseSnykResult {
  const { state, actions } = opts;
  const runScan = opts.scan ?? scanSnykCommit;
  const readCache = opts.readCache ?? getCachedSnykScan;
  const config = (): SnykProviderConfig => {
    const partial = opts.config();
    return {
      ...DEFAULT_SNYK_PROVIDER_CONFIG,
      ...partial,
      autoScanBranches: partial.autoScanBranches ?? [],
    };
  };
  const hasToken = (envVar: string): boolean => !!process.env[envVar]?.trim();
  const isAvailable = (): boolean => {
    const current = config();
    return current.enabled && hasToken(current.tokenEnvVar);
  };

  let results = new Map<string, SnykScanResult>();
  const [resultsVersion, setResultsVersion] = createSignal(0);
  const scanningSHAs = new Set<string>();
  const [scanningVersion, setScanningVersion] = createSignal(0);
  const autoScanAttempted = new Set<string>();
  const cacheProbeAttempted = new Set<string>();
  const queue: ScanQueueEntry[] = [];
  const queuedBySHA = new Map<string, ScanQueueEntry>();
  let activeEntry: ScanQueueEntry | null = null;
  let activeController: AbortController | null = null;
  let epoch = 0;
  let disposed = false;
  const [workVersion, setWorkVersion] = createSignal(0);
  /** A scan that failed out of sight; finished scans need no message, the footer hint just goes away. */
  const [backgroundError, setBackgroundError] = createSignal<string | null>(null);

  function publishResults(): void {
    setResultsVersion(version => version + 1);
    actions.setGraphBadges(SNYK_PROVIDER_ID, buildSnykGraphBadges(results.values()));
  }

  function mergeResult(result: SnykScanResult, expectedEpoch: number, rescan = false): void {
    if (disposed || opts.suspended?.() || expectedEpoch !== epoch) return;
    const sha = result.sha.toLowerCase();
    const existing = results.get(sha);
    if (!shouldReplaceSnykResult(existing, result, rescan)) return;
    results.set(sha, result);
    publishResults();
  }

  function clearQueuedScans(): void {
    for (const entry of queue.splice(0)) entry.resolve(null);
    queuedBySHA.clear();
    scanningSHAs.clear();
    setScanningVersion(version => version + 1);
  }

  function cancelWork(): void {
    epoch++;
    activeController?.abort();
    activeController = null;
    clearQueuedScans();
    cacheProbeAttempted.clear();
    for (const sha of autoScanAttempted) {
      if (!results.has(sha)) autoScanAttempted.delete(sha);
    }
  }

  function resetForIdentityChange(): void {
    cancelWork();
    autoScanAttempted.clear();
    setBackgroundError(null);
    results = new Map();
    publishResults();
    const current = config();
    actions.setProviderStatus(
      SNYK_PROVIDER_ID,
      current.enabled && !hasToken(current.tokenEnvVar)
        ? providerUnavailable(BANNER.snyk.missingToken(current.tokenEnvVar))
        : providerIdle(),
    );
    setWorkVersion(version => version + 1);
  }

  function createQueueEntry(sha: string, force: boolean): ScanQueueEntry {
    let resolve!: (result: SnykScanResult | null) => void;
    const promise = new Promise<SnykScanResult | null>(settle => {
      resolve = settle;
    });
    return { sha, force, epoch, repoPath: untrack(state.repoPath), promise, resolve };
  }

  async function drainQueue(): Promise<void> {
    if (disposed || opts.suspended?.() || activeEntry || queue.length === 0) return;
    const entry = queue.shift();
    if (!entry) return;
    queuedBySHA.delete(entry.sha);
    activeEntry = entry;
    const controller = new AbortController();
    activeController = controller;
    let scanResult: SnykScanResult | null = null;

    if (entry.epoch === epoch) actions.setProviderStatus(SNYK_PROVIDER_ID, providerLoading());
    try {
      const currentConfig = config();
      scanResult = await runScan({
        repoPath: entry.repoPath,
        sha: entry.sha,
        tokenEnvVar: currentConfig.tokenEnvVar,
        signal: controller.signal,
        force: entry.force,
        maxCachedScans: currentConfig.maxCachedScans,
      });
      if (
        !controller.signal.aborted &&
        !opts.suspended?.() &&
        entry.epoch === epoch &&
        entry.repoPath === state.repoPath()
      ) {
        mergeResult(scanResult, entry.epoch, entry.force);
        actions.setProviderLastSuccessfulRefresh(SNYK_PROVIDER_ID, new Date());
        // Coverage gaps (failed or skipped projects) show in the Dependencies tab, not the banner.
        if (queue.length === 0) actions.setProviderStatus(SNYK_PROVIDER_ID, providerIdle());
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !opts.suspended?.() &&
        entry.epoch === epoch &&
        entry.repoPath === state.repoPath()
      ) {
        const message = error instanceof Error ? error.message : String(error);
        // A partial rescan kept the complete snapshot: Snyk still works, so it's a warning for the tab notice.
        const partial = message === BANNER.snyk.partialRescan;
        actions.setProviderStatus(SNYK_PROVIDER_ID, partial ? providerWarning(message) : providerError(message));
        if (!partial && untrack(state.activeProviderView) !== SNYK_PROVIDER_ID) setBackgroundError(message);
      }
    } finally {
      entry.resolve(controller.signal.aborted || entry.epoch !== epoch ? null : scanResult);
      activeEntry = null;
      if (activeController === controller) activeController = null;
      if (!queuedBySHA.has(entry.sha)) {
        scanningSHAs.delete(entry.sha);
        setScanningVersion(version => version + 1);
      }
      void drainQueue();
    }
  }

  function enqueueScan(sha: string, force: boolean): Promise<SnykScanResult | null> {
    if (disposed || opts.suspended?.()) return Promise.resolve(null);
    const normalizedSHA = sha.trim().toLowerCase();
    if (!EXACT_SHA.test(normalizedSHA)) {
      actions.setProviderStatus(SNYK_PROVIDER_ID, providerError(BANNER.snyk.exactCommit));
      return Promise.resolve(null);
    }
    if (!isAvailable()) {
      const current = config();
      actions.setProviderStatus(
        SNYK_PROVIDER_ID,
        providerUnavailable(current.enabled ? BANNER.snyk.missingToken(current.tokenEnvVar) : BANNER.snyk.disabled),
      );
      return Promise.resolve(null);
    }

    if (activeEntry?.epoch === epoch && activeEntry.sha === normalizedSHA) {
      if (!force || activeEntry.force) return activeEntry.promise;
    }
    const queued = queuedBySHA.get(normalizedSHA);
    if (queued) {
      if (force) queued.force = true;
      return queued.promise;
    }

    const entry = createQueueEntry(normalizedSHA, force);
    queue.push(entry);
    queuedBySHA.set(normalizedSHA, entry);
    if (!scanningSHAs.has(normalizedSHA)) {
      scanningSHAs.add(normalizedSHA);
      setScanningVersion(version => version + 1);
    }
    void drainQueue();
    return entry.promise;
  }

  createEffect(() => {
    const current = config();
    if (current.enabled) {
      state.providers.register({
        id: SNYK_PROVIDER_ID,
        displayName: "Snyk",
        isAvailable,
        activity: () => {
          scanningVersion();
          return scanningSHAs.size > 0 ? "scanning" : null;
        },
      });
      actions.setProviderStatus(
        SNYK_PROVIDER_ID,
        hasToken(current.tokenEnvVar)
          ? providerIdle()
          : providerUnavailable(BANNER.snyk.missingToken(current.tokenEnvVar)),
      );
    } else {
      state.providers.unregister(SNYK_PROVIDER_ID);
      if (untrack(state.activeProviderView) === SNYK_PROVIDER_ID) actions.setActiveProviderView("git");
    }
  });

  let identity = "";
  createEffect(() => {
    const current = config();
    const nextIdentity = JSON.stringify({
      repoPath: state.repoPath(),
      enabled: current.enabled,
      tokenEnvVar: current.tokenEnvVar,
      autoScanBranches: current.autoScanBranches,
      maxCachedScans: current.maxCachedScans,
    });
    if (!identity) {
      identity = nextIdentity;
    } else if (nextIdentity !== identity) {
      identity = nextIdentity;
      resetForIdentityChange();
    }
  });

  createEffect(() => {
    if (opts.suspended?.()) untrack(cancelWork);
  });

  // Opening the Snyk view shows the error there, so the background banner has done its job.
  createEffect(() => {
    if (state.activeProviderView() === SNYK_PROVIDER_ID) setBackgroundError(null);
  });

  createEffect(() => {
    workVersion();
    if (opts.suspended?.()) return;
    const current = config();
    const repoPath = state.repoPath();
    const visibleSHAs = [
      ...new Set(
        state
          .graphRows()
          .map(row => row.commit.hash.toLowerCase())
          .filter(sha => EXACT_SHA.test(sha)),
      ),
    ];
    if (!current.enabled || !repoPath || visibleSHAs.length === 0) return;
    const toRead = selectSnykCacheProbes(visibleSHAs, new Set(results.keys()), cacheProbeAttempted);
    if (toRead.length === 0) return;
    for (const sha of toRead) cacheProbeAttempted.add(sha);
    const expectedEpoch = epoch;
    void (async () => {
      // SQLite reads are synchronous, so yield between batches on large graphs. Showing a cached scan in the graph
      // is not a use: the reads leave the eviction order alone (auto-scan tips below are read as usual).
      for (let offset = 0; offset < toRead.length; offset += 20) {
        if (expectedEpoch !== epoch || repoPath !== state.repoPath() || disposed || opts.suspended?.()) return;
        const cached = await Promise.all(
          toRead
            .slice(offset, offset + 20)
            .map(sha => readCache(repoPath, sha, { maxCachedScans: current.maxCachedScans, touch: false })),
        );
        if (expectedEpoch !== epoch || repoPath !== state.repoPath() || disposed || opts.suspended?.()) return;
        for (const result of cached) {
          if (result) mergeResult(result, expectedEpoch);
        }
        if (offset + 20 < toRead.length) await Bun.sleep(0);
      }
    })();
  });

  createEffect(() => {
    workVersion();
    if (opts.suspended?.()) return;
    const current = config();
    const repoPath = state.repoPath();
    const branches = state.branches();
    if (state.activeProviderView() !== SNYK_PROVIDER_ID) return;
    if (!repoPath || !isAvailable() || current.autoScanBranches.length === 0) return;

    const branchTipSHAs = collectSnykAutoScanTips(branches, current.autoScanBranches);
    const expectedEpoch = epoch;
    for (const sha of branchTipSHAs) {
      if (autoScanAttempted.has(sha)) continue;
      autoScanAttempted.add(sha);
      void readCache(repoPath, sha, { maxCachedScans: current.maxCachedScans }).then(cached => {
        if (expectedEpoch !== epoch || repoPath !== state.repoPath() || disposed || opts.suspended?.()) return;
        if (cached) {
          mergeResult(cached, expectedEpoch);
          return;
        }
        void enqueueScan(sha, false).then(result => {
          if (!result && expectedEpoch === epoch && repoPath === state.repoPath() && !disposed && !opts.suspended?.())
            autoScanAttempted.delete(sha);
        });
      });
    }
  });

  onCleanup(() => {
    disposed = true;
    epoch++;
    activeController?.abort();
    activeController = null;
    clearQueuedScans();
    state.providers.unregister(SNYK_PROVIDER_ID);
  });

  return {
    getCommitData: sha => {
      resultsVersion();
      return results.get(sha.toLowerCase()) ?? null;
    },
    isScanning: sha => {
      scanningVersion();
      return scanningSHAs.has(sha.toLowerCase());
    },
    scanCommit: (sha, force = false) => enqueueScan(sha, force),
    isAvailable,
    invalidate: resetForIdentityChange,
    backgroundError,
    dismissBackgroundError: () => setBackgroundError(null),
  };
}
