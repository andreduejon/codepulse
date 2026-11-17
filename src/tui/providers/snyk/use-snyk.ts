/**
 * Snyk in the app: the Solid side of the Snyk service (core/snyk/service.ts), which runs the scan queue and holds the
 * results. This hook gives it its ports, tells it what changed (the graph's commits, the branches, suspension, the
 * settings), registers the provider, and makes the service's reads reactive.
 */

import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { BANNER } from "../../../core/banner";
import type { SnykAdapters } from "../../../core/snyk/service";
import { createSnykService, EXACT_SHA, type SnykSettings } from "../../../core/snyk/service";
import type { SnykScanResult } from "../../../core/snyk/types";
import { DEFAULT_SNYK_CACHE_LIMIT } from "../../../core/snyk/types";
import type { AppActions, AppState } from "../../context/state";
import { providerIdle, providerUnavailable } from "../../context/state";
import { providerAppPort } from "../shared/app-port";

export { collectSnykAutoScanTips, selectSnykCacheProbes } from "../../../core/snyk/service";

/** Snyk's settings, merged with the defaults. */
export type SnykProviderConfig = SnykSettings;

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
  /**
   * One commit's cached scan, read without scanning (and without counting as a use): for a commit the graph doesn't
   * hold, which the dashboard shows a scan of.
   */
  readCachedScan: (sha: string) => Promise<void>;
  /** The error of a scan that failed while another view was open; cleared when the Snyk view opens. */
  backgroundError: () => string | null;
  dismissBackgroundError: () => void;
}

export function useSnyk(opts: {
  state: AppState;
  actions: AppActions;
  config: Accessor<Partial<SnykProviderConfig>>;
  suspended?: Accessor<boolean>;
  /** Scanning, its cache and the token check: the root's (src/ports.ts). */
  adapters: SnykAdapters;
}): UseSnykResult {
  const { state, actions } = opts;
  const config = (): SnykProviderConfig => {
    const partial = opts.config();
    return { ...DEFAULT_SNYK_PROVIDER_CONFIG, ...partial, autoScanBranches: partial.autoScanBranches ?? [] };
  };
  const hasToken = opts.adapters.hasToken;

  const [resultsVersion, setResultsVersion] = createSignal(0);
  const [scanningVersion, setScanningVersion] = createSignal(0);
  const [workVersion, setWorkVersion] = createSignal(0);
  const [failedOutOfSight, setFailedOutOfSight] = createSignal<{ sha: string; message: string } | null>(null);
  const service = createSnykService({
    app: providerAppPort(state, actions, "snyk", opts.suspended),
    // Read untracked: what a scan reads must not become the dependency of the effect that started it.
    config: () => untrack(config),
    hasToken,
    scan: opts.adapters.scan,
    readCache: opts.adapters.readCache,
    onResultsChange: () => setResultsVersion(version => version + 1),
    onScanningChange: () => setScanningVersion(version => version + 1),
    onWorkChange: () => setWorkVersion(version => version + 1),
    onBackgroundError: setFailedOutOfSight,
  });

  createEffect(() => {
    const current = config();
    if (current.enabled) {
      state.providers.register({
        id: "snyk",
        displayName: "Snyk",
        isAvailable: service.isAvailable,
        activity: () => {
          scanningVersion();
          return service.scanningCount() > 0 ? "scanning" : null;
        },
      });
      actions.setProviderStatus(
        "snyk",
        hasToken(current.tokenEnvVar)
          ? providerIdle()
          : providerUnavailable(BANNER.snyk.missingToken(current.tokenEnvVar)),
      );
    } else {
      state.providers.unregister("snyk");
      if (untrack(state.activeProviderView) === "snyk") actions.setActiveProviderView("git");
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
    if (!identity) identity = nextIdentity;
    else if (nextIdentity !== identity) {
      identity = nextIdentity;
      untrack(service.resetForIdentityChange);
    }
  });

  createEffect(() => {
    if (opts.suspended?.()) untrack(service.cancelWork);
  });

  // Opening the Snyk view shows the error there, so the background banner has done its job.
  createEffect(() => {
    if (state.activeProviderView() === "snyk") untrack(service.clearBackgroundError);
  });

  // The graph's commits: their cached scans show.
  createEffect(() => {
    workVersion();
    if (opts.suspended?.()) return;
    config();
    const repoPath = state.repoPath();
    const visibleSHAs = [
      ...new Set(
        state
          .graphRows()
          .map(row => row.commit.hash.toLowerCase())
          .filter(sha => EXACT_SHA.test(sha)),
      ),
    ];
    untrack(() => service.readGraphScans(repoPath, visibleSHAs));
  });

  // On every view, from when the repository loads: the configured branch tips are opted in per repository, and each
  // new tip is scanned once.
  createEffect(() => {
    workVersion();
    if (opts.suspended?.()) return;
    config();
    const repoPath = state.repoPath();
    const branches = state.branches();
    untrack(() => service.autoScanTips(repoPath, branches));
  });

  onCleanup(() => {
    service.dispose();
    state.providers.unregister("snyk");
  });

  return {
    getCommitData: sha => {
      resultsVersion();
      return service.getCommitData(sha);
    },
    isScanning: sha => {
      scanningVersion();
      return service.isScanning(sha);
    },
    scanCommit: service.scanCommit,
    readCachedScan: service.readCachedScan,
    isAvailable: service.isAvailable,
    invalidate: service.resetForIdentityChange,
    backgroundError: () => failedOutOfSight()?.message ?? null,
    dismissBackgroundError: service.clearBackgroundError,
  };
}
