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
import { useProviderFetchLifecycle } from "../shared/use-provider-fetch-lifecycle";
import {
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
  openShiftBuildLogUrl,
  openShiftKindPath,
  openShiftPodLogUrl,
  applyOpenShiftWatchEvent,
  watchOpenShiftStream,
  type OpenShiftListedInventory,
} from "./api";
import {
  cachedBuildToResource,
  OpenShiftCache,
  toCachedBuild,
  type OpenShiftCacheEntry,
} from "./cache";
import { sleep } from "../shared/http";
import type { OpenShiftCommitData, OpenShiftNamespaceData, OpenShiftProviderConfig, OpenShiftResource } from "./types";
import {
  DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS,
  DEFAULT_OPENSHIFT_CONFIG,
  OPENSHIFT_WATCH_KINDS,
} from "./types";
import { appendOpenShiftLogFollow } from "./watch";

export interface UseOpenShiftResult {
  getCommitData: (sha: string) => OpenShiftCommitData | null;
  refresh: () => Promise<void>;
  fetchCommitDataForSHA: (sha: string, force?: boolean) => Promise<void>;
  isLoading: (sha: string) => boolean;
  lastLiveAt: () => number | null;
  liveAge: () => string;
  isAvailable: () => boolean;
  loadBuildLog: (resource: OpenShiftResource, force?: boolean) => Promise<string>;
  loadPodLog: (resource: OpenShiftResource, container?: string) => Promise<string>;
  followLog: (
    resource: OpenShiftResource,
    signal: AbortSignal,
    onText: (text: string) => void,
  ) => Promise<void>;
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

export function mergeLiveIntoCommit(
  base: OpenShiftCommitData | null,
  live: OpenShiftCommitData | undefined,
  sha: string,
  liveFetched = false,
): OpenShiftCommitData {
  if (!live) {
    if (!base) return { sha, namespaces: [], liveFetched };
    return liveFetched ? { ...base, sha, liveFetched: true } : base;
  }
  if (!base) return { ...live, sha, liveFetched: liveFetched || live.liveFetched };
  const namespaces = new Map(base.namespaces.map(ns => [ns.namespace, { ...ns }]));
  for (const ns of live.namespaces) {
    const current = namespaces.get(ns.namespace) ?? emptyNamespace(ns.namespace);
    namespaces.set(ns.namespace, {
      ...current,
      imageStreamTags: ns.imageStreamTags.length > 0 ? ns.imageStreamTags : current.imageStreamTags,
      deployments: ns.deployments,
      deploymentConfigs: ns.deploymentConfigs,
      pods: ns.pods,
      builds: current.builds.length > 0 ? current.builds : ns.builds,
    });
  }
  return {
    sha,
    namespaces: [...namespaces.values()],
    liveFetched: liveFetched || base.liveFetched || live.liveFetched,
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
  const [loadingVersion, setLoadingVersion] = createSignal(0);
  const [lastLiveAt, setLastLiveAt] = createSignal<number | null>(null);
  const [watchEpoch, setWatchEpoch] = createSignal(0);
  const live = {
    listed: null as OpenShiftListedInventory | null,
    inflight: null as Promise<void> | null,
    inflightShas: new Set<string>(),
    showLoading: false,
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
    refreshInterval: () =>
      (configAccessor().autoRefreshSeconds ?? DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS) * 1000,
    queriedSHAs,
    reportUnavailable: showStatus => {
      if (showStatus) actions.setProviderStatus("openshift", providerUnavailable(unavailableMessage()));
    },
    runInitialFetch: async ({ signal, showStatus, epoch }) => {
      await runBuildInventory({ signal, showStatus, epoch });
      if (!signal?.aborted && epoch === lifecycle.getEpoch()) void ensureLive(false, signal, epoch);
    },
    runRefresh: async ({ signal, showStatus, epoch }) => {
      await runBuildInventory({ signal, showStatus, epoch });
      if (showStatus) setWatchEpoch(value => value + 1);
    },
    onResetCaches: () => {
      commits.clear();
      seeds.clear();
      live.listed = null;
      live.inflight = null;
      live.inflightShas.clear();
      live.showLoading = false;
      setLastLiveAt(null);
      setWatchEpoch(value => value + 1);
      queriedSHAs.clear();
      setLoadingVersion(v => v + 1);
      setVersion(v => v + 1);
      actions.setGraphBadges("openshift", new Map());
      actions.setProviderStatus("openshift", providerIdle());
    },
  });

  async function hydrateCachedCandidates(repoPath: string): Promise<void> {
    const cached = await disk.list(repoPath);
    if (cached.length === 0) return;
    const hints = selectOpenShiftCandidateSHAs(collectTopSHAs(state.graphRows(), config.fetchDepth), cached);
    let changed = false;
    for (const sha of hints) {
      if (commits.has(sha)) continue;
      const entry = await disk.read(repoPath, sha);
      if (!entry) continue;
      commits.set(sha, commitDataFromCacheEntry(entry));
      changed = true;
    }
    if (changed) {
      setVersion(v => v + 1);
      setLoadingVersion(v => v + 1);
    }
  }

  async function persistTerminalBuilds(repoPath: string, data: Map<string, OpenShiftCommitData>): Promise<void> {
    for (const [sha, commit] of data) {
      const builds = commit.namespaces
        .flatMap(ns => ns.builds)
        .map(toCachedBuild)
        .filter((build): build is NonNullable<typeof build> => build !== null && isTerminalBuildStatus(build.status));
      if (builds.length === 0) continue;
      await disk.write(repoPath, { sha, builds });
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
    if (args.showStatus) {
      setLastLiveAt(null);
      actions.setProviderStatus("openshift", providerLoading());
    }
    try {
      await hydrateCachedCandidates(repoPath);
      if (args.signal?.aborted || args.epoch !== lifecycle.getEpoch()) return;
      const window = collectTopSHAs(state.graphRows(), config.fetchDepth);
      const result = await fetchOpenShiftInventory(requestConfig, token, args.signal, "seeds", {
        commitShas: window,
      });
      if (args.signal?.aborted || args.epoch !== lifecycle.getEpoch()) return;
      if (result.error === BANNER.openshift.tokenExpired) {
        actions.setProviderStatus("openshift", providerError(BANNER.openshift.tokenExpired));
        return;
      }
      if (result.successfulRequests === 0 && result.error) {
        actions.setProviderStatus("openshift", providerError(result.error));
        return;
      }
      seeds.clear();
      for (const [sha, commit] of result.data) seeds.set(sha.toLowerCase(), commit);
      const candidates = selectOpenShiftCandidateSHAs(collectTopSHAs(state.graphRows(), config.fetchDepth), seeds.keys());
      const forDisk = filterToEligible(result.data);
      await persistTerminalBuilds(repoPath, forDisk);
      for (const sha of [...commits.keys()]) {
        if (!candidates.has(sha) && !seeds.has(sha)) commits.delete(sha);
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
      if (args.signal?.aborted || args.epoch !== lifecycle.getEpoch()) return;
      debugError("OpenShift", err);
      const message =
        err instanceof Error && err.message === BANNER.openshift.tokenExpired
          ? BANNER.openshift.tokenExpired
          : BANNER.openshift.inventoryFailed;
      actions.setProviderStatus("openshift", providerError(message));
    }
  }

  function applyLive(listed: OpenShiftListedInventory, targets?: Set<string>): void {
    const seedResources = [...commits.values()].flatMap(commit =>
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

  function markLiveFetched(targets: Iterable<string>): void {
    for (const sha of targets) {
      const commit = commits.get(sha);
      if (commit) commits.set(sha, { ...commit, liveFetched: true });
    }
    publish();
  }

  async function ensureLive(
    force: boolean,
    signal?: AbortSignal,
    epoch = lifecycle.getEpoch(),
    sha?: string,
    opts?: { silent?: boolean },
  ): Promise<void> {
    const targets = sha ? [sha.toLowerCase()] : [...commits.keys()];
    if (targets.length === 0) return;
    if (!targets.some(target => {
      const commit = commits.get(target);
      return commit ? commitHasDigestSeed(commit) : false;
    })) {
      markLiveFetched(targets);
      return;
    }
    if (live.inflight) return live.inflight;
    if (!force && live.listed) {
      applyLive(live.listed, new Set(targets));
      return;
    }
    const token = getOpenShiftToken(config.tokenEnvVar);
    if (!token) return;
    live.inflightShas = new Set(targets);
    live.showLoading = opts?.silent !== true;
    if (live.showLoading) setLastLiveAt(null);
    setLoadingVersion(v => v + 1);
    const run = (async () => {
      const listed = await fetchOpenShiftResources(config, token, signal, "live", {
        commitShas: targets,
      });
      if (signal?.aborted || epoch !== lifecycle.getEpoch()) return;
      if (listed.error === BANNER.openshift.tokenExpired) {
        actions.setProviderStatus("openshift", providerError(BANNER.openshift.tokenExpired));
        return;
      }
      live.listed = listed;
      applyLive(listed, new Set(targets));
      setLastLiveAt(Date.now());
    })();
    live.inflight = run.then(
      () => {},
      () => {},
    );
    try {
      await run;
    } finally {
      if (epoch === lifecycle.getEpoch()) {
        live.inflight = null;
        live.inflightShas.clear();
        live.showLoading = false;
        setLoadingVersion(v => v + 1);
      }
    }
  }

  async function runWatchSession(signal: AbortSignal, epoch: number): Promise<void> {
    const token = getOpenShiftToken(config.tokenEnvVar);
    if (!token) return;
    while (!signal.aborted && epoch === lifecycle.getEpoch()) {
      try {
        const listed = await fetchOpenShiftResources(config, token, signal, "live", { commitShas: [] });
        if (signal.aborted || epoch !== lifecycle.getEpoch()) return;
        if (listed.error === BANNER.openshift.tokenExpired) {
          actions.setProviderStatus("openshift", providerError(BANNER.openshift.tokenExpired));
          return;
        }
        live.listed = listed;
        applyLive(listed);
        setLastLiveAt(Date.now());
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
            setLastLiveAt(Date.now());
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
        const results = running.length > 0 ? await Promise.all(running) : [];
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted || epoch !== lifecycle.getEpoch()) return;
        if (results.includes("auth")) {
          actions.setProviderStatus("openshift", providerError(BANNER.openshift.tokenExpired));
          return;
        }
        if (results.length > 0 && results.every(result => result === "forbidden")) return;
        if (results.every(result => result === "end" || result === "forbidden")) await sleep(1000, signal);
      } catch (err) {
        if (signal.aborted || epoch !== lifecycle.getEpoch()) return;
        debugError("OpenShift", err);
        try {
          await sleep(1000, signal);
        } catch {
          return;
        }
      }
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
    onCleanup(() => ctrl.abort());
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
        await ensureLive(force === true, undefined, lifecycle.getEpoch(), sha);
      } catch (err) {
        debugError("OpenShift", err);
      }
    },
    isLoading: sha => {
      loadingVersion();
      version();
      return live.showLoading && live.inflight !== null && live.inflightShas.has(sha.toLowerCase());
    },
    lastLiveAt,
    liveAge: () => (lastLiveAt() == null ? "" : "live"),
    isAvailable,
    loadBuildLog: async (resource, force = false) => {
      const sha = resource.commitSha;
      if (sha && isTerminalBuildStatus(resource.status) && !force) {
        const cached = await disk.readLog(state.repoPath(), sha, resource.namespace, resource.name);
        if (cached) return cached;
      }
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const log = await fetchOpenShiftBuildLog(config.serverUrl, token, resource.namespace, resource.name);
      if (sha && isTerminalBuildStatus(resource.status)) {
        await disk.writeLog(state.repoPath(), sha, resource.namespace, resource.name, log);
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
      const token = getOpenShiftToken(config.tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      return fetchOpenShiftObject(config.serverUrl, token, resource);
    },
  };
}
