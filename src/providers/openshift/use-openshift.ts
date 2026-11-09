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
import { BANNER, debugError } from "../../debug/banner";
import { collectTopSHAs } from "../github-actions/sha-selection";
import { sleep } from "../shared/http";
import { persistMergedSnapshots } from "../shared/sha-sqlite-cache";
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import {
  applyOpenShiftWatchEvent,
  buildOpenShiftCommitMap,
  buildOpenShiftGraphBadges,
  fetchOpenShiftBuildLog,
  fetchOpenShiftEvents,
  fetchOpenShiftInventory,
  fetchOpenShiftObject,
  fetchOpenShiftPodLog,
  fetchOpenShiftResources,
  followOpenShiftLog,
  getOpenShiftToken,
  isTerminalBuildStatus,
  type OpenShiftListedInventory,
  openShiftBuildLogUrl,
  openShiftKindPath,
  openShiftPodLogUrl,
  watchOpenShiftStream,
} from "./api";
import { cachedBuildToResource, mergeById, OpenShiftCache, type OpenShiftCacheEntry, toCachedBuild } from "./cache";
import type {
  OpenShiftCommitData,
  OpenShiftEvent,
  OpenShiftNamespaceData,
  OpenShiftProviderConfig,
  OpenShiftResource,
} from "./types";
import { DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS, DEFAULT_OPENSHIFT_CONFIG, OPENSHIFT_WATCH_KINDS } from "./types";
import { appendOpenShiftLogFollow } from "./watch";

export interface UseOpenShiftResult {
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  refresh: () => Promise<void>;
  fetchCommitDataForSHA: (sha: string, force?: boolean) => Promise<void>;
  isLoading: (sha: string) => boolean;
  liveAge: () => string;
  isAvailable: () => boolean;
  invalidate: () => void;
  loadBuildLog: (resource: OpenShiftResource, force?: boolean) => Promise<string>;
  loadPodLog: (resource: OpenShiftResource, container?: string) => Promise<string>;
  followLog: (resource: OpenShiftResource, signal: AbortSignal, onText: (text: string) => void) => Promise<void>;
  /** The resource's object; `force` (refresh) asks the API instead of using the embedded or cached copy. */
  loadResourceObject: (resource: OpenShiftResource, force?: boolean) => Promise<unknown>;
  /** The events about the resource, always from the API (they change by the minute and are not cached). */
  loadResourceEvents: (resource: OpenShiftResource) => Promise<OpenShiftEvent[]>;
}

function emptyNamespace(namespace: string): OpenShiftNamespaceData {
  return {
    namespace,
    builds: [],
    imageStreamTags: [],
    deployments: [],
    deploymentConfigs: [],
    pods: [],
  };
}

/**
 * A live list that failed for some namespace/kind keeps that slice of the previous list, so a failed request does not
 * look like the workloads went away. Successful slices replace their previous contents as usual.
 */
export function keepFailedLiveSlices(
  previous: OpenShiftListedInventory | null | undefined,
  next: OpenShiftListedInventory,
): OpenShiftListedInventory {
  if (!previous || next.failures.length === 0) return next;
  const failed = new Set(next.failures.map(failure => `${failure.namespace}:${failure.kind}`));
  const keep = (item: { namespace: string; kind: string }) => failed.has(`${item.namespace}:${item.kind}`);
  return {
    ...next,
    resources: [...next.resources, ...previous.resources.filter(keep)],
    controllers: [...next.controllers, ...previous.controllers.filter(keep)],
  };
}

export function commitDataFromCacheEntry(entry: OpenShiftCacheEntry): OpenShiftCommitData {
  const namespaces = new Map<string, OpenShiftNamespaceData>();
  for (const build of entry.builds) {
    const ns = namespaces.get(build.namespace) ?? emptyNamespace(build.namespace);
    ns.builds.push(cachedBuildToResource(build));
    namespaces.set(build.namespace, ns);
  }
  return { sha: entry.sha, namespaces: [...namespaces.values()], liveFetched: false };
}

export function resourceHasImageDigest(resource: OpenShiftResource): boolean {
  return resource.imageRefs.some(ref => /sha256:[a-fA-F0-9]+/i.test(ref));
}

export function commitHasDigestSeed(commit: OpenShiftCommitData): boolean {
  return commit.namespaces.some(ns => [...ns.builds, ...ns.imageStreamTags].some(resourceHasImageDigest));
}

export function selectOpenShiftCandidateSHAs(
  graphSHAs: readonly string[],
  annotatedSHAs: Iterable<string>,
  selectedSHA?: string | null,
): Set<string> {
  const annotated = new Set([...annotatedSHAs].map(sha => sha.toLowerCase()));
  const out = new Set<string>();
  for (const sha of graphSHAs) {
    const key = sha.toLowerCase();
    if (annotated.has(key)) out.add(key);
  }
  if (selectedSHA) {
    const key = selectedSHA.toLowerCase();
    if (annotated.has(key)) out.add(key);
  }
  return out;
}

function clearLiveLane(ns: OpenShiftNamespaceData): OpenShiftNamespaceData {
  return { ...ns, deployments: [], deploymentConfigs: [], pods: [], imageStreamTags: [] };
}

export function mergeLiveIntoCommit(
  base: OpenShiftCommitData | null,
  live: OpenShiftCommitData | undefined,
  sha: string,
  liveFetched = false,
): OpenShiftCommitData {
  if (!live) {
    if (!base) return { sha, namespaces: [], liveFetched };
    if (!liveFetched) return base;
    return { sha, liveFetched: true, namespaces: base.namespaces.map(clearLiveLane) };
  }
  if (!base) return { ...live, sha, liveFetched: liveFetched || live.liveFetched };
  const fetched = liveFetched || base.liveFetched || live.liveFetched;
  const namespaces = new Map(base.namespaces.map(ns => [ns.namespace, { ...ns }]));
  const liveNamespaces = new Set(live.namespaces.map(ns => ns.namespace));
  for (const ns of live.namespaces) {
    const current = namespaces.get(ns.namespace) ?? emptyNamespace(ns.namespace);
    namespaces.set(ns.namespace, {
      ...current,
      imageStreamTags: liveFetched
        ? ns.imageStreamTags
        : current.imageStreamTags.length > 0
          ? current.imageStreamTags
          : ns.imageStreamTags,
      deployments: ns.deployments,
      deploymentConfigs: ns.deploymentConfigs,
      pods: ns.pods,
      builds: mergeById(ns.builds, current.builds),
    });
  }
  if (fetched) {
    for (const [name, current] of namespaces) {
      if (!liveNamespaces.has(name)) namespaces.set(name, clearLiveLane(current));
    }
  }
  return {
    sha,
    namespaces: [...namespaces.values()],
    liveFetched: fetched,
  };
}

export function useOpenShift(opts: {
  state: AppState;
  actions: AppActions;
  config?: Partial<OpenShiftProviderConfig> | Accessor<Partial<OpenShiftProviderConfig>>;
  cacheRoot?: string;
  suspended?: Accessor<boolean>;
}): UseOpenShiftResult {
  const { state, actions } = opts;
  const configAccessor: Accessor<Partial<OpenShiftProviderConfig>> =
    typeof opts.config === "function"
      ? (opts.config as Accessor<Partial<OpenShiftProviderConfig>>)
      : ((() => opts.config ?? {}) as Accessor<Partial<OpenShiftProviderConfig>>);

  let config: OpenShiftProviderConfig = { ...DEFAULT_OPENSHIFT_CONFIG, ...configAccessor() };
  let disk = new OpenShiftCache({
    root: opts.cacheRoot,
    maxEntries: config.cacheLimit,
  });
  createEffect(() => {
    const partial = configAccessor();
    config = {
      ...DEFAULT_OPENSHIFT_CONFIG,
      ...partial,
      namespaces: partial.namespaces ?? [],
    };
    disk = new OpenShiftCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit });
  });

  const isAvailable = () =>
    config.enabled &&
    !!config.serverUrl.trim() &&
    config.namespaces.length > 0 &&
    getOpenShiftToken(config.tokenEnvVar) !== null;

  createEffect(() => {
    if (configAccessor().enabled === true)
      state.providers.register({
        id: "openshift",
        displayName: "OpenShift",
        isAvailable,
        // Build inventory (lifecycle) or the live list before watches start; streaming watches are not "fetching".
        activity: () => (lifecycle.isFetching() || liveState() === "loading" ? "fetching" : null),
      });
    else {
      state.providers.unregister("openshift");
      if (untrack(state.activeProviderView) === "openshift") actions.setActiveProviderView("git");
    }
  });

  const commits = new Map<string, OpenShiftCommitData>();
  const seeds = new Map<string, OpenShiftCommitData>();
  /** Commits in the disk cache at the last hydration: a refresh keeps them, also below the fetch depth. */
  const cachedSHAs = new Set<string>();
  /**
   * Older commits only shown from the cache. A refresh does not save them again (that would mark every one as used
   * for eviction); opening one makes it a commit the user works with, saved like before.
   */
  const shownFromCache = new Set<string>();
  const queriedSHAs = new Set<string>();
  const [version, setVersion] = createSignal(0);
  /** Live list/watch state: `loading` while a live list is requested, `live` while watches stream. */
  const [liveState, setLiveState] = createSignal<"idle" | "loading" | "live">("idle");
  const [watchEpoch, setWatchEpoch] = createSignal(0);
  let watchGen = 0;
  const live = {
    listed: null as OpenShiftListedInventory | null,
  };

  function publish(): void {
    setVersion(v => v + 1);
    actions.setGraphBadges("openshift", buildOpenShiftGraphBadges(commits));
  }

  function unavailableMessage(): string {
    if (!config.serverUrl.trim()) return BANNER.openshift.noServer;
    if (config.namespaces.length === 0) return BANNER.openshift.noNamespaces;
    if (!getOpenShiftToken(config.tokenEnvVar)) return BANNER.openshift.missingToken(config.tokenEnvVar);
    return BANNER.openshift.unavailable;
  }

  /**
   * The status message the live list itself set (a failed or partial list). A later good list clears only that one,
   * never a build-inventory or other error it does not own.
   */
  // Owned by identity, not wording: the build inventory can report the very same banner text.
  let liveStatus: ReturnType<typeof providerError> | null = null;
  const setLiveStatus = (kind: "error" | "warning", message: string) => {
    liveStatus = kind === "error" ? providerError(message) : providerWarning(message);
    actions.setProviderStatus("openshift", liveStatus);
  };
  const clearLiveStatus = () => {
    if (liveStatus && state.providerStatusFor("openshift") === liveStatus)
      actions.setProviderStatus("openshift", providerIdle());
    liveStatus = null;
  };

  /**
   * After a 401, automatic requests (polls, watches, view switches, selections) stop until an explicit Reload or
   * Fetch retries, like GitHub and Jenkins. Cached data stays visible meanwhile.
   */
  let authFrozen = false;
  /** Enter the freeze from any path: running watches stop now instead of streaming on. */
  const freezeAuth = () => {
    authFrozen = true;
    setWatchEpoch(value => value + 1);
  };
  /** Start the live list again after a retry or a status-showing refresh: it may have stopped on a 401. */
  const restartLive = (signal: AbortSignal | undefined, epoch: number) => {
    if (!signal?.aborted && epoch === lifecycle.getEpoch() && !authFrozen) setWatchEpoch(value => value + 1);
  };

  const lifecycle = useProviderFetchLifecycle({
    state,
    suspended: opts.suspended,
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
        cacheLimit: partial.cacheLimit ?? DEFAULT_OPENSHIFT_CONFIG.cacheLimit,
        fetchDepth: partial.fetchDepth ?? DEFAULT_OPENSHIFT_CONFIG.fetchDepth,
      });
    },
    isAvailable,
    isBackgroundReady: () => false,
    refreshInterval: () => (configAccessor().autoRefreshSeconds ?? DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS) * 1000,
    queriedSHAs,
    reportUnavailable: showStatus => {
      if (showStatus) actions.setProviderStatus("openshift", providerUnavailable(unavailableMessage()));
    },
    onCancelledStatus: () => {
      if (state.providerStatusFor("openshift").kind === "loading")
        actions.setProviderStatus("openshift", providerIdle());
    },
    runInitialFetch: async ({ signal, showStatus, retry, epoch }) => {
      if (authFrozen && !retry) return;
      if (retry) authFrozen = false;
      await runBuildInventory({ signal, showStatus, epoch });
      // A retry the queue merged into a first fetch restarts the live list too.
      if (retry) restartLive(signal, epoch);
    },
    runRefresh: async ({ signal, showStatus, retry, epoch }) => {
      if (authFrozen && !retry) return;
      if (retry) authFrozen = false;
      await runBuildInventory({ signal, showStatus, epoch });
      if (showStatus || retry) restartLive(signal, epoch);
    },
    onResetCaches: () => {
      authFrozen = false;
      commits.clear();
      seeds.clear();
      cachedSHAs.clear();
      shownFromCache.clear();
      live.listed = null;
      setLiveState("idle");
      setWatchEpoch(value => value + 1);
      queriedSHAs.clear();
      setVersion(v => v + 1);
      actions.setGraphBadges("openshift", new Map());
      actions.setProviderStatus("openshift", providerIdle());
    },
  });

  /**
   * Every cached commit shows its builds, also below the fetch depth (the cache limit decides how many commits keep
   * builds, the fetch depth only which ones the inventory asks about). Commits in the fetch window are read, which
   * counts as a use for eviction; older ones are only peeked.
   */
  async function hydrateCachedCandidates(repoPath: string, epoch: number): Promise<void> {
    if (!lifecycle.isCurrent(epoch, repoPath)) return;
    const peeked = await disk.peekAll(repoPath);
    if (!lifecycle.isCurrent(epoch, repoPath)) return;
    cachedSHAs.clear();
    for (const entry of peeked) cachedSHAs.add(entry.sha.toLowerCase());
    const window = new Set(collectTopSHAs(state.graphRows(), config.fetchDepth).map(sha => sha.toLowerCase()));
    let changed = false;
    for (const cached of peeked) {
      const sha = cached.sha.toLowerCase();
      if (commits.has(sha)) continue;
      const entry = window.has(sha) ? await disk.read(repoPath, sha) : cached;
      if (!lifecycle.isCurrent(epoch, repoPath)) return;
      if (!entry) continue;
      commits.set(sha, commitDataFromCacheEntry(entry));
      if (!window.has(sha)) shownFromCache.add(sha);
      changed = true;
    }
    if (changed) setVersion(v => v + 1);
  }

  async function persistTerminalBuilds(
    repoPath: string,
    data: Map<string, OpenShiftCommitData>,
    epoch: number,
  ): Promise<void> {
    await persistMergedSnapshots(
      disk,
      repoPath,
      [...data.keys()],
      () => lifecycle.isCurrent(epoch, repoPath),
      sha =>
        (data.get(sha)?.namespaces ?? [])
          .flatMap(ns => ns.builds)
          .map(toCachedBuild)
          .filter((build): build is NonNullable<typeof build> => build !== null && isTerminalBuildStatus(build.status)),
      (sha, existing, incoming) => ({ sha, builds: mergeById(existing?.builds ?? [], incoming) }),
    );
  }

  function eligibleSHAs(): Set<string> {
    const window = collectTopSHAs(state.graphRows(), config.fetchDepth);
    return new Set(window.map(sha => sha.toLowerCase()));
  }

  function filterToEligible(data: Map<string, OpenShiftCommitData>): Map<string, OpenShiftCommitData> {
    const allowed = eligibleSHAs();
    const next = new Map<string, OpenShiftCommitData>();
    for (const [sha, commit] of data) {
      const key = sha.toLowerCase();
      if (allowed.has(key) || ((commits.has(sha) || commits.has(key)) && !shownFromCache.has(key)))
        next.set(sha, commit);
    }
    return next.size > 0 ? next : data;
  }

  async function runBuildInventory(args: { signal?: AbortSignal; showStatus: boolean; epoch: number }) {
    const token = getOpenShiftToken(config.tokenEnvVar);
    if (!token) return;
    const requestConfig = config;
    const repoPath = state.repoPath();
    if (args.showStatus) actions.setProviderStatus("openshift", providerLoading());
    try {
      await hydrateCachedCandidates(repoPath, args.epoch);
      if (args.signal?.aborted || !lifecycle.isCurrent(args.epoch, repoPath)) return;
      const window = collectTopSHAs(state.graphRows(), config.fetchDepth);
      const result = await fetchOpenShiftInventory(requestConfig, token, args.signal, "seeds", {
        commitShas: window,
      });
      if (args.signal?.aborted || !lifecycle.isCurrent(args.epoch, repoPath)) return;
      if (result.error === BANNER.openshift.tokenExpired) {
        freezeAuth();
        publish();
        actions.setProviderStatus("openshift", providerError(BANNER.openshift.tokenExpired));
        return;
      }
      if (result.successfulRequests === 0 && result.error) {
        publish();
        actions.setProviderStatus("openshift", providerError(result.error));
        return;
      }
      seeds.clear();
      for (const [sha, commit] of result.data) seeds.set(sha.toLowerCase(), commit);
      // Window commits and cached older ones take the builds the cluster still lists for them.
      const candidates = selectOpenShiftCandidateSHAs(
        [...collectTopSHAs(state.graphRows(), config.fetchDepth), ...cachedSHAs],
        seeds.keys(),
      );
      const forDisk = filterToEligible(result.data);
      await persistTerminalBuilds(repoPath, forDisk, args.epoch);
      if (!lifecycle.isCurrent(args.epoch, repoPath)) return;
      const allowed = eligibleSHAs();
      for (const sha of [...commits.keys()]) {
        if (allowed.has(sha.toLowerCase()) || candidates.has(sha) || seeds.has(sha)) continue;
        if (cachedSHAs.has(sha.toLowerCase())) continue;
        commits.delete(sha);
      }
      for (const sha of candidates) {
        const commit = seeds.get(sha);
        if (commit) commits.set(sha, mergeLiveIntoCommit(commit, commits.get(sha), sha));
      }
      publish();
      lifecycle.noteFetchStarted();
      // A status the live list set (a live 401 that froze requests, a failed list) is the live list's to clear.
      const liveOwned = liveStatus !== null && state.providerStatusFor("openshift") === liveStatus;
      if (result.error) {
        if (!liveOwned) actions.setProviderStatus("openshift", providerWarning(result.error));
      } else {
        if (!liveOwned) actions.setProviderStatus("openshift", providerIdle());
        actions.setProviderLastSuccessfulRefresh("openshift", new Date());
      }
    } catch (err) {
      if (args.signal?.aborted || !lifecycle.isCurrent(args.epoch, repoPath)) return;
      debugError("OpenShift", err);
      const message =
        err instanceof Error && err.message === BANNER.openshift.tokenExpired
          ? BANNER.openshift.tokenExpired
          : BANNER.openshift.inventoryFailed;
      if (message === BANNER.openshift.tokenExpired) freezeAuth();
      publish();
      actions.setProviderStatus("openshift", providerError(message));
    }
  }

  function applyLive(listed: OpenShiftListedInventory, targets?: Set<string>): void {
    const seedResources = [...seeds.values()].flatMap(commit =>
      commit.namespaces.flatMap(ns => [...ns.builds, ...ns.imageStreamTags]),
    );
    const mapped = buildOpenShiftCommitMap([...seedResources, ...listed.resources], listed.controllers);
    const shas = targets ?? new Set(commits.keys());
    for (const sha of shas) {
      commits.set(sha, mergeLiveIntoCommit(commits.get(sha) ?? null, mapped.get(sha), sha, true));
      queriedSHAs.add(sha);
    }
    publish();
  }

  function adoptCommit(sha: string): boolean {
    const key = sha.toLowerCase();
    if (commits.has(key)) return true;
    const commit = seeds.get(key);
    if (!commit) return false;
    commits.set(key, mergeLiveIntoCommit(commit, undefined, key));
    return true;
  }

  async function runWatchSession(signal: AbortSignal, epoch: number): Promise<void> {
    const repoPath = state.repoPath();
    const token = getOpenShiftToken(config.tokenEnvVar);
    if (!token) return;
    const gen = ++watchGen;
    let delayMs = 1000;
    setLiveState("loading");
    try {
      while (!signal.aborted && lifecycle.isCurrent(epoch, repoPath)) {
        try {
          setLiveState("loading");
          const listed = await fetchOpenShiftResources(config, token, signal, "live", { commitShas: [] });
          if (signal.aborted || !lifecycle.isCurrent(epoch, repoPath)) return;
          if (listed.error === BANNER.openshift.tokenExpired) {
            authFrozen = true;
            setLiveStatus("error", BANNER.openshift.tokenExpired);
            return;
          }
          // Every request failed: keep the last live data visible, report, and retry with backoff.
          if (listed.successfulRequests === 0 && listed.error) {
            setLiveStatus("error", listed.error);
            await sleep(delayMs, signal);
            delayMs = Math.min(delayMs * 2, 10_000);
            continue;
          }
          const merged = keepFailedLiveSlices(live.listed, listed);
          live.listed = merged;
          applyLive(merged);
          if (listed.error) setLiveStatus("warning", listed.error);
          else clearLiveStatus();
          const child = new AbortController();
          const onAbort = () => child.abort();
          signal.addEventListener("abort", onAbort, { once: true });
          const onEvent = (event: Parameters<typeof applyOpenShiftWatchEvent>[1]) => {
            if (signal.aborted || !lifecycle.isCurrent(epoch, repoPath) || !live.listed) return;
            const result = applyOpenShiftWatchEvent(live.listed, event, config.commitShaAnnotation);
            if (result === "gone") {
              child.abort();
              return;
            }
            if (result === "applied") {
              applyLive(live.listed);
            }
          };
          const watches = config.namespaces.flatMap(ns =>
            OPENSHIFT_WATCH_KINDS.map(kind => {
              const resourceVersion = listed.resourceVersions.get(`${ns}:${kind}`);
              if (!resourceVersion || resourceVersion === "0") return null;
              return watchOpenShiftStream(
                config.serverUrl,
                token,
                openShiftKindPath(ns, kind),
                resourceVersion,
                child.signal,
                onEvent,
              );
            }),
          );
          // An auth failure on one watch ends the others too, so the freeze does not wait on long-lived streams.
          const running = watches
            .filter((job): job is NonNullable<typeof job> => job !== null)
            .map(job =>
              job.then(result => {
                if (result === "auth") child.abort();
                return result;
              }),
            );
          setLiveState(running.length > 0 ? "live" : "idle");
          const results = running.length > 0 ? await Promise.all(running) : [];
          if (!signal.aborted && lifecycle.isCurrent(epoch, repoPath)) setLiveState("loading");
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted || !lifecycle.isCurrent(epoch, repoPath)) return;
          if (results.includes("auth")) {
            authFrozen = true;
            setLiveStatus("error", BANNER.openshift.tokenExpired);
            return;
          }
          if (results.length > 0 && results.every(result => result === "forbidden")) {
            actions.setProviderStatus("openshift", providerWarning(BANNER.openshift.watchDenied));
            return;
          }
          delayMs = 1000;
          await sleep(delayMs, signal);
        } catch (err) {
          if (signal.aborted || !lifecycle.isCurrent(epoch, repoPath)) return;
          debugError("OpenShift", err);
          setLiveState("loading");
          try {
            await sleep(delayMs, signal);
            delayMs = Math.min(delayMs * 2, 10_000);
          } catch {
            return;
          }
        }
      }
    } finally {
      if (gen === watchGen) setLiveState("idle");
    }
  }

  createEffect(() => {
    if (opts.suspended?.()) {
      setLiveState("idle");
      return;
    }
    configAccessor();
    state.repoPath();
    watchEpoch();
    if (state.activeProviderView() !== "openshift" || !isAvailable() || authFrozen) return;
    const epoch = lifecycle.getEpoch();
    const ctrl = new AbortController();
    void runWatchSession(ctrl.signal, epoch);
    onCleanup(() => {
      ctrl.abort();
    });
  });

  return {
    getCommitData: sha => {
      version();
      return commits.get(sha.toLowerCase()) ?? null;
    },
    refresh: async () => lifecycle.fetchRefresh(undefined, true, true),
    fetchCommitDataForSHA: async (sha, force) => {
      if (opts.suspended?.()) return;
      try {
        shownFromCache.delete(sha.toLowerCase());
        if (!adoptCommit(sha) && !force) return;
        if (force) {
          // Setup missing: nothing can load, so do not look busy (the row is disabled; guard the direct call too).
          if (!isAvailable()) return;
          // Reload commit is an explicit retry: it lifts an auth freeze and reloads the build inventory as well as
          // the live list (OpenShift matches by window, so this is the same as :reload).
          await lifecycle.fetchRefresh(undefined, true, true);
          return;
        }
        if (live.listed) applyLive(live.listed, new Set([sha.toLowerCase()]));
      } catch (err) {
        debugError("OpenShift", err);
      }
    },
    isLoading: () => liveState() === "loading",
    liveAge: () => (liveState() === "live" ? "live" : ""),
    isAvailable,
    invalidate: lifecycle.resetCaches,
    loadBuildLog: async (resource, force = false) => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      if (!lifecycle.isCurrent(epoch, repoPath)) return "";
      const sha = resource.commitSha;
      if (sha && isTerminalBuildStatus(resource.status) && !force) {
        const cached = await disk.readLog(repoPath, sha, resource.namespace, resource.name);
        if (!lifecycle.isCurrent(epoch, repoPath)) return "";
        if (cached) return cached;
      }
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const log = await lifecycle.runRequest(signal =>
        fetchOpenShiftBuildLog(config.serverUrl, token, resource.namespace, resource.name, signal),
      );
      if (!lifecycle.isCurrent(epoch, repoPath)) return "";
      if (sha && isTerminalBuildStatus(resource.status) && lifecycle.isCurrent(epoch, repoPath)) {
        await disk.writeLog(repoPath, sha, resource.namespace, resource.name, log);
      }
      return log;
    },
    loadPodLog: async (resource, container) => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      if (!lifecycle.isCurrent(epoch, repoPath)) return "";
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const log = await lifecycle.runRequest(signal =>
        fetchOpenShiftPodLog(config.serverUrl, token, resource.namespace, resource.name, container, signal),
      );
      return lifecycle.isCurrent(epoch, repoPath) ? log : "";
    },
    followLog: async (resource, signal, onText) => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      if (!lifecycle.isCurrent(epoch, repoPath)) return;
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      let acc = "";
      const url =
        resource.kind === "Pod"
          ? openShiftPodLogUrl(config.serverUrl, resource.namespace, resource.name, undefined, true)
          : openShiftBuildLogUrl(config.serverUrl, resource.namespace, resource.name, true);
      await lifecycle.runRequest(
        signal =>
          followOpenShiftLog(url, token, signal, chunk => {
            if (signal.aborted || !lifecycle.isCurrent(epoch, repoPath)) return;
            acc = appendOpenShiftLogFollow(acc, chunk);
            onText(acc);
          }),
        signal,
      );
    },
    loadResourceObject: async (resource, force = false) => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      if (!force && resource.object !== undefined) return resource.object;
      if (!lifecycle.isCurrent(epoch, repoPath)) return null;
      if (!force && resource.kind === "Build" && resource.commitSha && isTerminalBuildStatus(resource.status)) {
        const entry = await disk.read(repoPath, resource.commitSha);
        if (!lifecycle.isCurrent(epoch, repoPath)) return null;
        const cached = entry?.builds.find(
          build => build.id === resource.id || (build.namespace === resource.namespace && build.name === resource.name),
        );
        if (cached?.object !== undefined) return cached.object;
      }
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const object = await lifecycle.runRequest(signal =>
        fetchOpenShiftObject(config.serverUrl, token, resource, signal),
      );
      return lifecycle.isCurrent(epoch, repoPath) ? object : null;
    },
    loadResourceEvents: async resource => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const events = await lifecycle.runRequest(signal =>
        fetchOpenShiftEvents(config.serverUrl, token, resource, signal),
      );
      return lifecycle.isCurrent(epoch, repoPath) ? events : [];
    },
  };
}
