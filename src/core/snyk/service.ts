/**
 * Snyk for one open repository, without any UI framework: one scan at a time from a queue (a second request for the
 * same commit waits for the first), the results per commit and their badges, reading the cache for the graph's
 * commits, scanning configured branch tips once each, and the error of a scan that failed while another view showed.
 *
 * Everything outside comes through ports; the Solid hook (providers/snyk/use-snyk.ts) builds them and tells the
 * service what changed (the graph's commits, the branches, suspension, another repository).
 */
import { BANNER } from "../../debug/banner";
import type * as Scanner from "../../providers/snyk/scanner";
import type { ProviderAppPort } from "../provider-ports";
import { providerError, providerIdle, providerLoading, providerUnavailable, providerWarning } from "../provider-status";
import { buildSnykGraphBadges } from "./badges";
import { shouldReplaceSnykResult } from "./results";
import type { SnykCacheLimit, SnykScanResult } from "./types";

export const EXACT_SHA = /^[0-9a-f]{40,64}$/i;

export interface SnykSettings {
  enabled: boolean;
  tokenEnvVar: string;
  autoScanBranches: string[];
  maxCachedScans: SnykCacheLimit;
}

/** The local branch tips the settings opt in to scanning (each once). */
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

/** The graph's commits whose cached scan wasn't read yet. */
export function selectSnykCacheProbes(
  visibleSHAs: readonly string[],
  loadedSHAs: ReadonlySet<string>,
  probedSHAs: ReadonlySet<string>,
): string[] {
  return visibleSHAs.filter(sha => !loadedSHAs.has(sha) && !probedSHAs.has(sha));
}

export interface SnykServicePorts {
  app: ProviderAppPort;
  config: () => SnykSettings;
  hasToken: (envVar: string) => boolean;
  scan: typeof Scanner.scanSnykCommit;
  readCache: typeof Scanner.getCachedSnykScan;
  /** Results changed (getCommitData reads again). */
  onResultsChange: () => void;
  /** Which commits scan changed (isScanning, the footer's activity). */
  onScanningChange: () => void;
  /** A new repository or settings: the cache reads and auto scans start again. */
  onWorkChange: () => void;
  /** The error of a scan that failed out of sight, or none. */
  onBackgroundError: (failed: { sha: string; message: string } | null) => void;
}

interface ScanQueueEntry {
  sha: string;
  force: boolean;
  epoch: number;
  repoPath: string;
  promise: Promise<SnykScanResult | null>;
  resolve: (result: SnykScanResult | null) => void;
}

export function createSnykService(ports: SnykServicePorts) {
  const { app } = ports;
  const isAvailable = (): boolean => {
    const current = ports.config();
    return current.enabled && ports.hasToken(current.tokenEnvVar);
  };

  let results = new Map<string, SnykScanResult>();
  const scanningSHAs = new Set<string>();
  const autoScanAttempted = new Set<string>();
  const cacheProbeAttempted = new Set<string>();
  const queue: ScanQueueEntry[] = [];
  const queuedBySHA = new Map<string, ScanQueueEntry>();
  let activeEntry: ScanQueueEntry | null = null;
  let activeController: AbortController | null = null;
  let epoch = 0;
  let disposed = false;
  /**
   * A scan that failed out of sight, with its commit: a scan of that commit without an error takes it away. Finished
   * scans need no message, the footer hint just goes away.
   */
  let failedOutOfSight: { sha: string; message: string } | null = null;
  const setFailedOutOfSight = (failed: { sha: string; message: string } | null) => {
    failedOutOfSight = failed;
    ports.onBackgroundError(failed);
  };
  const clearBackgroundError = () => setFailedOutOfSight(null);
  const current = (expectedEpoch: number, repoPath: string) =>
    expectedEpoch === epoch && repoPath === app.repoPath() && !disposed && !app.suspended();

  function publishResults(): void {
    ports.onResultsChange();
    app.setBadges(buildSnykGraphBadges(results.values()));
  }

  function mergeResult(result: SnykScanResult, expectedEpoch: number, rescan = false): void {
    if (disposed || app.suspended() || expectedEpoch !== epoch) return;
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
    ports.onScanningChange();
  }

  /** Suspension: the running scan stops, the queue empties; results stay. */
  function cancelWork(): void {
    epoch++;
    activeController?.abort();
    activeController = null;
    clearQueuedScans();
    cacheProbeAttempted.clear();
    for (const sha of autoScanAttempted) if (!results.has(sha)) autoScanAttempted.delete(sha);
  }

  /** Another repository or other settings: everything starts over. */
  function resetForIdentityChange(): void {
    cancelWork();
    autoScanAttempted.clear();
    clearBackgroundError();
    results = new Map();
    publishResults();
    const settings = ports.config();
    app.setStatus(
      settings.enabled && !ports.hasToken(settings.tokenEnvVar)
        ? providerUnavailable(BANNER.snyk.missingToken(settings.tokenEnvVar))
        : providerIdle(),
    );
    ports.onWorkChange();
  }

  function createQueueEntry(sha: string, force: boolean): ScanQueueEntry {
    let resolve!: (result: SnykScanResult | null) => void;
    const promise = new Promise<SnykScanResult | null>(settle => {
      resolve = settle;
    });
    return { sha, force, epoch, repoPath: app.repoPath(), promise, resolve };
  }

  async function drainQueue(): Promise<void> {
    if (disposed || app.suspended() || activeEntry || queue.length === 0) return;
    const entry = queue.shift();
    if (!entry) return;
    queuedBySHA.delete(entry.sha);
    activeEntry = entry;
    const controller = new AbortController();
    activeController = controller;
    let scanResult: SnykScanResult | null = null;

    if (entry.epoch === epoch) app.setStatus(providerLoading());
    try {
      const settings = ports.config();
      scanResult = await ports.scan({
        repoPath: entry.repoPath,
        sha: entry.sha,
        tokenEnvVar: settings.tokenEnvVar,
        signal: controller.signal,
        force: entry.force,
        maxCachedScans: settings.maxCachedScans,
      });
      if (
        !controller.signal.aborted &&
        !app.suspended() &&
        entry.epoch === epoch &&
        entry.repoPath === app.repoPath()
      ) {
        mergeResult(scanResult, entry.epoch, entry.force);
        if (failedOutOfSight?.sha === entry.sha) clearBackgroundError();
        app.noteSuccess();
        // Coverage gaps (failed or skipped projects) show in the Dependencies tab, not the banner.
        if (queue.length === 0) app.setStatus(providerIdle());
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !app.suspended() &&
        entry.epoch === epoch &&
        entry.repoPath === app.repoPath()
      ) {
        const message = error instanceof Error ? error.message : String(error);
        // A partial rescan kept the complete snapshot: Snyk still works, so it's a warning for the tab notice.
        const partial = message === BANNER.snyk.partialRescan;
        app.setStatus(partial ? providerWarning(message) : providerError(message));
        if (!partial && app.view() !== "snyk") setFailedOutOfSight({ sha: entry.sha, message });
      }
    } finally {
      entry.resolve(controller.signal.aborted || entry.epoch !== epoch ? null : scanResult);
      activeEntry = null;
      if (activeController === controller) activeController = null;
      if (!queuedBySHA.has(entry.sha)) {
        scanningSHAs.delete(entry.sha);
        ports.onScanningChange();
      }
      void drainQueue();
    }
  }

  function enqueueScan(sha: string, force: boolean): Promise<SnykScanResult | null> {
    if (disposed || app.suspended()) return Promise.resolve(null);
    const normalizedSHA = sha.trim().toLowerCase();
    if (!EXACT_SHA.test(normalizedSHA)) {
      app.setStatus(providerError(BANNER.snyk.exactCommit));
      return Promise.resolve(null);
    }
    if (!isAvailable()) {
      const settings = ports.config();
      app.setStatus(
        providerUnavailable(settings.enabled ? BANNER.snyk.missingToken(settings.tokenEnvVar) : BANNER.snyk.disabled),
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
      ports.onScanningChange();
    }
    void drainQueue();
    return entry.promise;
  }

  /** The graph's commits: their cached scans show, read in batches without counting as a use. */
  function readGraphScans(repoPath: string, visibleSHAs: readonly string[]): void {
    const settings = ports.config();
    if (!settings.enabled || !repoPath || visibleSHAs.length === 0) return;
    const toRead = selectSnykCacheProbes(visibleSHAs, new Set(results.keys()), cacheProbeAttempted);
    if (toRead.length === 0) return;
    for (const sha of toRead) cacheProbeAttempted.add(sha);
    const expectedEpoch = epoch;
    void (async () => {
      // SQLite reads are synchronous, so yield between batches on large graphs. Showing a cached scan in the graph
      // is not a use: the reads leave the eviction order alone (auto-scan tips below are read as usual).
      for (let offset = 0; offset < toRead.length; offset += 20) {
        if (!current(expectedEpoch, repoPath)) return;
        const cached = await Promise.all(
          toRead
            .slice(offset, offset + 20)
            .map(sha => ports.readCache(repoPath, sha, { maxCachedScans: settings.maxCachedScans, touch: false })),
        );
        if (!current(expectedEpoch, repoPath)) return;
        for (const result of cached) if (result) mergeResult(result, expectedEpoch);
        if (offset + 20 < toRead.length) await new Promise(resolve => setTimeout(resolve, 0));
      }
    })();
  }

  /** The configured branches' tips: each new tip's cached scan, else a scan, once. */
  function autoScanTips(
    repoPath: string,
    branches: readonly { name: string; isRemote: boolean; lastCommitHash: string }[],
  ): void {
    const settings = ports.config();
    if (!repoPath || !isAvailable() || settings.autoScanBranches.length === 0) return;
    const expectedEpoch = epoch;
    for (const sha of collectSnykAutoScanTips(branches, settings.autoScanBranches)) {
      if (autoScanAttempted.has(sha)) continue;
      autoScanAttempted.add(sha);
      void ports.readCache(repoPath, sha, { maxCachedScans: settings.maxCachedScans }).then(cached => {
        if (!current(expectedEpoch, repoPath)) return;
        if (cached) {
          mergeResult(cached, expectedEpoch);
          return;
        }
        void enqueueScan(sha, false).then(result => {
          if (!result && current(expectedEpoch, repoPath)) autoScanAttempted.delete(sha);
        });
      });
    }
  }

  return {
    /** A commit's scan, or null. Not reactive: the adapter makes it so. */
    getCommitData: (sha: string) => results.get(sha.toLowerCase()) ?? null,
    /** Whether a commit is being scanned or waits for it. Not reactive: the adapter makes it so. */
    isScanning: (sha: string) => scanningSHAs.has(sha.toLowerCase()),
    /** How many commits scan or wait. */
    scanningCount: () => scanningSHAs.size,
    scanCommit: (sha: string, force = false) => enqueueScan(sha, force),
    /**
     * One commit's cached scan, read without scanning (and without counting as a use): for a commit the graph doesn't
     * hold, which the dashboard shows a scan of.
     */
    readCachedScan: async (sha: string) => {
      const key = sha.toLowerCase();
      const repoPath = app.repoPath();
      if (results.has(key) || !repoPath || app.suspended()) return;
      const expectedEpoch = epoch;
      const cached = await ports.readCache(repoPath, key, {
        maxCachedScans: ports.config().maxCachedScans,
        touch: false,
      });
      if (cached && expectedEpoch === epoch && repoPath === app.repoPath() && !disposed) mergeResult(cached, epoch);
    },
    isAvailable,
    cancelWork,
    resetForIdentityChange,
    clearBackgroundError,
    readGraphScans,
    autoScanTips,
    /** The adapter's owner is gone: nothing runs on. */
    dispose: () => {
      disposed = true;
      epoch++;
      activeController?.abort();
      activeController = null;
      clearQueuedScans();
    },
  };
}

export type SnykService = ReturnType<typeof createSnykService>;
