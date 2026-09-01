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
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import {
  applyOpenShiftWatchEvent,
  buildOpenShiftCommitMap,
  buildOpenShiftGraphBadges,
  fetchOpenShiftBuildLog,
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
import type { OpenShiftCommitData, OpenShiftNamespaceData, OpenShiftProviderConfig, OpenShiftResource } from "./types";
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
  loadResourceObject: (resource: OpenShiftResource) => Promise<unknown>;
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
      state.providers.register({ id: "openshift", displayName: "OpenShift", isAvailable });
    else {
      state.providers.unregister("openshift");
      if (untrack(state.activeProviderView) === "openshift") actions.setActiveProviderView("git");
    }
  });

  const commits = new Map<string, OpenShiftCommitData>();
  const seeds = new Map<string, OpenShiftCommitData>();
  const queriedSHAs = new Set<string>();
  const [version, setVersion] = createSignal(0);
  const [liveLabel, setLiveLabel] = createSignal("");
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
    runInitialFetch: async ({ signal, showStatus, epoch }) => {
      await runBuildInventory({ signal, showStatus, epoch });
    },
    runRefresh: async ({ signal, showStatus, epoch }) => {
      await runBuildInventory({ signal, showStatus, epoch });
      if (showStatus) setWatchEpoch(value => value + 1);
    },
    onResetCaches: () => {
      commits.clear();
      seeds.clear();
      live.listed = null;
      setLiveLabel("");
      setWatchEpoch(value => value + 1);
      queriedSHAs.clear();
      setVersion(v => v + 1);
      actions.setGraphBadges("openshift", new Map());
      actions.setProviderStatus("openshift", providerIdle());
    },
  });

  async function hydrateCachedCandidates(repoPath: string, epoch: number): Promise<void> {
    const cached = await disk.list(repoPath);
    if (!lifecycle.isCurrent(epoch, repoPath)) return;
    if (cached.length === 0) return;
    const hints = selectOpenShiftCandidateSHAs(collectTopSHAs(state.graphRows(), config.fetchDepth), cached);
    let changed = false;
    for (const sha of hints) {
      if (commits.has(sha)) continue;
      const entry = await disk.read(repoPath, sha);
      if (!lifecycle.isCurrent(epoch, repoPath)) return;
      if (!entry) continue;
      commits.set(sha, commitDataFromCacheEntry(entry));
      changed = true;
    }
    if (changed) setVersion(v => v + 1);
  }

  async function persistTerminalBuilds(
    repoPath: string,
    data: Map<string, OpenShiftCommitData>,
    epoch: number,
  ): Promise<void> {
    for (const [sha, commit] of data) {
      const incoming = commit.namespaces
        .flatMap(ns => ns.builds)
        .map(toCachedBuild)
        .filter((build): build is NonNullable<typeof build> => build !== null && isTerminalBuildStatus(build.status));
      if (incoming.length === 0) continue;
      const existing = await disk.read(repoPath, sha);
      if (!lifecycle.isCurrent(epoch, repoPath)) return;
      await disk.write(repoPath, { sha, builds: mergeById(existing?.builds ?? [], incoming) });
    }
  }

  function eligibleSHAs(): Set<string> {
    const window = collectTopSHAs(state.graphRows(), config.fetchDepth);
    return new Set(window.map(sha => sha.toLowerCase()));
  }

  function filterToEligible(data: Map<string, OpenShiftCommitData>): Map<string, OpenShiftCommitData> {
    const allowed = eligibleSHAs();
    const next = new Map<string, OpenShiftCommitData>();
    for (const [sha, commit] of data) {
      if (allowed.has(sha.toLowerCase()) || commits.has(sha) || commits.has(sha.toLowerCase())) next.set(sha, commit);
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
      const candidates = selectOpenShiftCandidateSHAs(
        collectTopSHAs(state.graphRows(), config.fetchDepth),
        seeds.keys(),
      );
      const forDisk = filterToEligible(result.data);
      await persistTerminalBuilds(repoPath, forDisk, args.epoch);
      if (!lifecycle.isCurrent(args.epoch, repoPath)) return;
      const allowed = eligibleSHAs();
      for (const sha of [...commits.keys()]) {
        if (allowed.has(sha.toLowerCase()) || candidates.has(sha) || seeds.has(sha)) continue;
        commits.delete(sha);
      }
      for (const sha of candidates) {
        const commit = seeds.get(sha);
        if (commit) commits.set(sha, mergeLiveIntoCommit(commit, commits.get(sha), sha));
      }
      publish();
      lifecycle.noteFetchStarted();
      if (result.error) {
        actions.setProviderStatus("openshift", providerWarning(result.error));
      } else {
        actions.setProviderStatus("openshift", providerIdle());
        actions.setProviderLastSuccessfulRefresh("openshift", new Date());
      }
    } catch (err) {
      if (args.signal?.aborted || !lifecycle.isCurrent(args.epoch, repoPath)) return;
      debugError("OpenShift", err);
      const message =
        err instanceof Error && err.message === BANNER.openshift.tokenExpired
          ? BANNER.openshift.tokenExpired
          : BANNER.openshift.inventoryFailed;
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
    const token = getOpenShiftToken(config.tokenEnvVar);
    if (!token) return;
    const gen = ++watchGen;
    let delayMs = 1000;
    setLiveLabel("loading...");
    try {
      while (!signal.aborted && epoch === lifecycle.getEpoch()) {
        try {
          setLiveLabel("loading...");
          const listed = await fetchOpenShiftResources(config, token, signal, "live", { commitShas: [] });
          if (signal.aborted || epoch !== lifecycle.getEpoch()) return;
          if (listed.error === BANNER.openshift.tokenExpired) {
            actions.setProviderStatus("openshift", providerError(BANNER.openshift.tokenExpired));
            return;
          }
          live.listed = listed;
          applyLive(listed);
          const child = new AbortController();
          const onAbort = () => child.abort();
          signal.addEventListener("abort", onAbort, { once: true });
          const onEvent = (event: Parameters<typeof applyOpenShiftWatchEvent>[1]) => {
            if (!live.listed) return;
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
          const running = watches.filter((job): job is NonNullable<typeof job> => job !== null);
          setLiveLabel(running.length > 0 ? "live" : "");
          const results = running.length > 0 ? await Promise.all(running) : [];
          if (!signal.aborted && epoch === lifecycle.getEpoch()) setLiveLabel("loading...");
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted || epoch !== lifecycle.getEpoch()) return;
          if (results.includes("auth")) {
            actions.setProviderStatus("openshift", providerError(BANNER.openshift.tokenExpired));
            return;
          }
          if (results.length > 0 && results.every(result => result === "forbidden")) {
            actions.setProviderStatus("openshift", providerWarning(BANNER.openshift.watchDenied));
            return;
          }
          delayMs = 1000;
          await sleep(delayMs, signal);
        } catch (err) {
          if (signal.aborted || epoch !== lifecycle.getEpoch()) return;
          debugError("OpenShift", err);
          setLiveLabel("loading...");
          try {
            await sleep(delayMs, signal);
            delayMs = Math.min(delayMs * 2, 10_000);
          } catch {
            return;
          }
        }
      }
    } finally {
      if (gen === watchGen) setLiveLabel("");
    }
  }

  createEffect(() => {
    configAccessor();
    state.repoPath();
    watchEpoch();
    if (state.activeProviderView() !== "openshift" || !isAvailable()) return;
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
    refresh: async () => lifecycle.fetchRefresh(undefined, true),
    fetchCommitDataForSHA: async (sha, force) => {
      try {
        if (!adoptCommit(sha) && !force) return;
        if (force) {
          setLiveLabel("loading...");
          setWatchEpoch(value => value + 1);
          return;
        }
        if (live.listed) applyLive(live.listed, new Set([sha.toLowerCase()]));
      } catch (err) {
        debugError("OpenShift", err);
      }
    },
    isLoading: () => liveLabel() === "loading...",
    liveAge: () => liveLabel(),
    isAvailable,
    invalidate: lifecycle.resetCaches,
    loadBuildLog: async (resource, force = false) => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      const sha = resource.commitSha;
      if (sha && isTerminalBuildStatus(resource.status) && !force) {
        const cached = await disk.readLog(repoPath, sha, resource.namespace, resource.name);
        if (!lifecycle.isCurrent(epoch, repoPath)) return "";
        if (cached) return cached;
      }
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const log = await fetchOpenShiftBuildLog(config.serverUrl, token, resource.namespace, resource.name);
      if (!lifecycle.isCurrent(epoch, repoPath)) return "";
      if (sha && isTerminalBuildStatus(resource.status) && lifecycle.isCurrent(epoch, repoPath)) {
        await disk.writeLog(repoPath, sha, resource.namespace, resource.name, log);
      }
      return log;
    },
    loadPodLog: async (resource, container) => {
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      return fetchOpenShiftPodLog(config.serverUrl, token, resource.namespace, resource.name, container);
    },
    followLog: async (resource, signal, onText) => {
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      let acc = "";
      const url =
        resource.kind === "Pod"
          ? openShiftPodLogUrl(config.serverUrl, resource.namespace, resource.name, undefined, true)
          : openShiftBuildLogUrl(config.serverUrl, resource.namespace, resource.name, true);
      await followOpenShiftLog(url, token, signal, chunk => {
        acc = appendOpenShiftLogFollow(acc, chunk);
        onText(acc);
      });
    },
    loadResourceObject: async resource => {
      const epoch = lifecycle.getEpoch();
      const repoPath = state.repoPath();
      if (resource.object !== undefined) return resource.object;
      if (resource.kind === "Build" && resource.commitSha && isTerminalBuildStatus(resource.status)) {
        const entry = await disk.read(repoPath, resource.commitSha);
        if (!lifecycle.isCurrent(epoch, repoPath)) return null;
        const cached = entry?.builds.find(
          build => build.id === resource.id || (build.namespace === resource.namespace && build.name === resource.name),
        );
        if (cached?.object !== undefined) return cached.object;
      }
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      return fetchOpenShiftObject(config.serverUrl, token, resource);
    },
  };
}
