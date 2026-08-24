import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { providerError, providerIdle, providerLoading, providerUnavailable } from "../../context/state";
import type { ProviderView } from "../provider";
import { buildSnykGraphBadges } from "./badges";
import { DEFAULT_SNYK_CACHE_LIMIT } from "./cache";
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
}

interface ScanQueueEntry {
  sha: string;
  force: boolean;
  epoch: number;
  promise: Promise<SnykScanResult | null>;
  resolve: (result: SnykScanResult | null) => void;
}

export function useSnyk(opts: {
  state: AppState;
  actions: AppActions;
  config: Accessor<Partial<SnykProviderConfig>>;
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
  const queue: ScanQueueEntry[] = [];
  const queuedBySHA = new Map<string, ScanQueueEntry>();
  let activeEntry: ScanQueueEntry | null = null;
  let activeController: AbortController | null = null;
  let epoch = 0;
  let disposed = false;

  function publishResults(): void {
    setResultsVersion(version => version + 1);
    actions.setGraphBadges(SNYK_PROVIDER_ID, buildSnykGraphBadges(results.values()));
  }

  function mergeResult(result: SnykScanResult, expectedEpoch: number): void {
    if (disposed || expectedEpoch !== epoch) return;
    const sha = result.sha.toLowerCase();
    const existing = results.get(sha);
    if (existing && existing.scannedAt > result.scannedAt) return;
    results.set(sha, result);
    publishResults();
  }

  function clearQueuedScans(): void {
    for (const entry of queue.splice(0)) entry.resolve(null);
    queuedBySHA.clear();
    scanningSHAs.clear();
    setScanningVersion(version => version + 1);
  }

  function resetForIdentityChange(): void {
    epoch++;
    activeController?.abort();
    activeController = null;
    clearQueuedScans();
    autoScanAttempted.clear();
    results = new Map();
    publishResults();
    const current = config();
    actions.setProviderStatus(
      SNYK_PROVIDER_ID,
      current.enabled && !hasToken(current.tokenEnvVar)
        ? providerUnavailable(`Snyk unavailable: missing ${current.tokenEnvVar}`)
        : providerIdle(),
    );
  }

  function createQueueEntry(sha: string, force: boolean): ScanQueueEntry {
    let resolve!: (result: SnykScanResult | null) => void;
    const promise = new Promise<SnykScanResult | null>(settle => {
      resolve = settle;
    });
    return { sha, force, epoch, promise, resolve };
  }

  async function drainQueue(): Promise<void> {
    if (disposed || activeEntry || queue.length === 0) return;
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
        repoPath: untrack(state.repoPath),
        sha: entry.sha,
        tokenEnvVar: currentConfig.tokenEnvVar,
        signal: controller.signal,
        force: entry.force,
        maxCachedScans: currentConfig.maxCachedScans,
      });
      if (!controller.signal.aborted && entry.epoch === epoch) {
        mergeResult(scanResult, entry.epoch);
        actions.setProviderLastSuccessfulRefresh(SNYK_PROVIDER_ID, new Date());
        if (queue.length === 0) actions.setProviderStatus(SNYK_PROVIDER_ID, providerIdle());
      }
    } catch (error) {
      if (!controller.signal.aborted && entry.epoch === epoch) {
        const message = error instanceof Error ? error.message : String(error);
        actions.setProviderStatus(SNYK_PROVIDER_ID, providerError(`Snyk scan failed: ${message}`));
      }
    } finally {
      entry.resolve(scanResult);
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
    if (disposed) return Promise.resolve(null);
    const normalizedSHA = sha.trim().toLowerCase();
    if (!EXACT_SHA.test(normalizedSHA)) {
      actions.setProviderStatus(SNYK_PROVIDER_ID, providerError("Snyk scan requires an exact commit SHA"));
      return Promise.resolve(null);
    }
    if (!isAvailable()) {
      const current = config();
      actions.setProviderStatus(
        SNYK_PROVIDER_ID,
        providerUnavailable(
          current.enabled ? `Snyk unavailable: missing ${current.tokenEnvVar}` : "Snyk provider disabled",
        ),
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
      state.providers.register({ id: SNYK_PROVIDER_ID, displayName: "Snyk", isAvailable });
      actions.setProviderStatus(
        SNYK_PROVIDER_ID,
        hasToken(current.tokenEnvVar)
          ? providerIdle()
          : providerUnavailable(`Snyk unavailable: missing ${current.tokenEnvVar}`),
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
    const expectedEpoch = epoch;
    const controller = new AbortController();
    void Promise.all(visibleSHAs.map(sha => readCache(repoPath, sha, { maxCachedScans: current.maxCachedScans }))).then(
      cached => {
        if (controller.signal.aborted || expectedEpoch !== epoch) return;
        for (const result of cached) {
          if (result) mergeResult(result, expectedEpoch);
        }
      },
    );
    onCleanup(() => controller.abort());
  });

  createEffect(() => {
    const current = config();
    const repoPath = state.repoPath();
    const branches = state.branches();
    if (!repoPath || !isAvailable() || current.autoScanBranches.length === 0) return;

    const branchTipSHAs = collectSnykAutoScanTips(branches, current.autoScanBranches);
    const expectedEpoch = epoch;
    for (const sha of branchTipSHAs) {
      if (autoScanAttempted.has(sha)) continue;
      autoScanAttempted.add(sha);
      void readCache(repoPath, sha, { maxCachedScans: current.maxCachedScans }).then(cached => {
        if (expectedEpoch !== epoch || disposed) return;
        if (cached) {
          mergeResult(cached, expectedEpoch);
          return;
        }
        void enqueueScan(sha, false).then(result => {
          if (!result && expectedEpoch === epoch) autoScanAttempted.delete(sha);
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
  };
}
