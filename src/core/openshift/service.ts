/**
 * OpenShift for one open repository, without any UI framework: the build list (which commits ran where), the live list
 * of what runs in each namespace and its watches, logs (followed or read), objects and events, what the cache keeps,
 * and the freeze after an expired token. When the build list is fetched is the fetch lifecycle's
 * (core/fetch-lifecycle.ts); when the live session runs is the adapter's (while a view shows live resources).
 *
 * Everything outside comes through ports; the Solid hook (providers/openshift/use-openshift.ts) builds them.
 */

import { sleep } from "../abort";
import { debugError } from "../banner";
import type { ProviderFetchArgs } from "../fetch-lifecycle";
import { failureOf } from "../provider-failure";
import type { ProviderAppPort, ProviderLifecycle } from "../provider-ports";
import type { ProviderCacheLimit } from "../provider-settings";
import { providerError, providerIdle, providerLoading, providerUnavailable, providerWarning } from "../provider-status";
import { collectTopSHAs } from "../sha-selection";
import { OPENSHIFT_BANNER } from "./banner";
import {
  commitDataFromCacheEntry,
  emptyGraphBadge,
  keepFailedLiveSlices,
  markUnlistedBuilds,
  mergeLiveIntoCommit,
  selectOpenShiftCandidateSHAs,
} from "./commit-data";
import { commitFailures, type OpenShiftFailure } from "./failures";
import { mergeById, type OpenShiftCacheEntry, toCachedBuild } from "./merge";
import {
  applyOpenShiftWatchEvent,
  buildOpenShiftCommitMap,
  buildOpenShiftGraphBadges,
  buildOpenShiftNamespaceMarkers,
  isTerminalBuildStatus,
  openShiftBuildLogUrl,
  openShiftKindPath,
  openShiftPodLogUrl,
} from "./resources";
import type {
  OpenShiftClusterConfig,
  OpenShiftCommitData,
  OpenShiftEvent,
  OpenShiftFetchOptions,
  OpenShiftInventoryMode,
  OpenShiftInventoryResult,
  OpenShiftProviderConfig,
  OpenShiftResource,
  OpenShiftWatchResult,
} from "./types";
import { OPENSHIFT_WATCH_KINDS, type OpenShiftListedInventory } from "./types";
import {
  isAboutPresentResource,
  linkWarningsToCommits,
  mergeWarnings,
  type OpenShiftWarning,
  type OpenShiftWarningList,
  sameWarnings,
  warningsAbout,
} from "./warnings";
import type { OpenShiftWatchEvent } from "./watch";
import { appendOpenShiftLogFollow } from "./watch";

/** OpenShift's API: the requests the service makes. */
export interface OpenShiftApiPort {
  fetchOpenShiftInventory: (
    config: OpenShiftClusterConfig,
    token: string,
    signal?: AbortSignal,
    mode?: OpenShiftInventoryMode,
    options?: OpenShiftFetchOptions,
  ) => Promise<OpenShiftInventoryResult>;
  fetchOpenShiftResources: (
    config: OpenShiftClusterConfig,
    token: string,
    signal?: AbortSignal,
    mode?: OpenShiftInventoryMode,
    options?: OpenShiftFetchOptions,
  ) => Promise<OpenShiftListedInventory>;
  /** Watches a list path from a version until it ends; each change goes to `onEvent`. */
  watchOpenShiftStream: (
    serverUrl: string,
    token: string,
    path: string,
    resourceVersion: string,
    signal: AbortSignal,
    onEvent: (event: OpenShiftWatchEvent) => void,
  ) => Promise<OpenShiftWatchResult>;
  fetchOpenShiftBuildLog: (
    serverUrl: string,
    token: string,
    namespace: string,
    buildName: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  fetchOpenShiftPodLog: (
    serverUrl: string,
    token: string,
    namespace: string,
    podName: string,
    container?: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  /** Streams a log from `url` until it ends or `signal` stops it. */
  followOpenShiftLog: (
    url: string,
    token: string,
    signal: AbortSignal,
    onChunk: (text: string) => void,
  ) => Promise<void>;
  fetchOpenShiftObject: (
    serverUrl: string,
    token: string,
    resource: OpenShiftResource,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  fetchOpenShiftEvents: (
    serverUrl: string,
    token: string,
    resource: OpenShiftResource,
    signal?: AbortSignal,
  ) => Promise<OpenShiftEvent[]>;
  /** Every configured namespace's warnings. */
  fetchOpenShiftWarnings: (
    config: OpenShiftClusterConfig,
    token: string,
    signal?: AbortSignal,
  ) => Promise<OpenShiftWarningList>;
}

/** The cache: finished builds per commit, and build logs. */
export interface OpenShiftCachePort {
  read: (repoPath: string, sha: string) => Promise<OpenShiftCacheEntry | null>;
  peekAll: (repoPath: string) => Promise<OpenShiftCacheEntry[]>;
  readLog: (repoPath: string, sha: string, namespace: string, name: string) => Promise<string | null>;
  writeLog: (repoPath: string, sha: string, namespace: string, name: string, log: string) => Promise<void>;
  mergeMany: <I>(
    repoPath: string,
    items: readonly { sha: string; incoming: readonly I[] }[],
    merge: (sha: string, existing: OpenShiftCacheEntry | null, incoming: I[]) => OpenShiftCacheEntry,
    isCurrent?: () => boolean,
    /** `touch: false`: an entry only shown keeps its place for eviction. */
    options?: { touch?: boolean },
  ) => Promise<number>;
}

export type OpenShiftLiveState = "idle" | "loading" | "live";

/**
 * What the app gives the provider from outside: its API, a cache with a limit, and the token in an environment
 * variable. The terminal app's are in src/providers/openshift/adapters.ts.
 */
export interface OpenShiftAdapters {
  api: OpenShiftApiPort;
  cache: (maxEntries: ProviderCacheLimit) => OpenShiftCachePort;
  token: (envVar: string) => string | null;
}

export interface OpenShiftServicePorts {
  app: ProviderAppPort;
  api: OpenShiftApiPort;
  cache: () => OpenShiftCachePort;
  config: () => OpenShiftProviderConfig;
  token: (envVar: string) => string | null;
  lifecycle: () => ProviderLifecycle;
  onDataChange: () => void;
  /** The live list's state: `loading` while it is requested, `live` while watches stream. */
  onLiveState: (state: OpenShiftLiveState) => void;
  /** The live session should start again (a retry, a reset): the adapter runs a new one. */
  restartLive: () => void;
}

/** Whether two lists hold the same failures, each saying the same: nothing to redraw. */
const sameFailures = (a: readonly OpenShiftFailure[], b: readonly OpenShiftFailure[]) =>
  a.length === b.length && a.every((entry, i) => entry.id === b[i]?.id && entry.message === b[i]?.message);

/** Merge each commit's incoming items into its cached snapshot, in one go, while `isCurrent`. */
async function persistMerged<I>(
  cache: OpenShiftCachePort,
  repoPath: string,
  shas: readonly string[],
  isCurrent: () => boolean,
  incomingFor: (sha: string) => I[],
  merge: (sha: string, existing: OpenShiftCacheEntry | null, incoming: I[]) => OpenShiftCacheEntry,
  options?: { touch?: boolean },
): Promise<void> {
  if (!isCurrent()) return;
  const items = shas.map(sha => ({ sha, incoming: incomingFor(sha) })).filter(item => item.incoming.length > 0);
  if (items.length === 0) return;
  await cache.mergeMany(repoPath, items, merge, isCurrent, options);
}

export function createOpenShiftService(ports: OpenShiftServicePorts) {
  const { app } = ports;
  const lifecycle = () => ports.lifecycle();
  const isAvailable = () => {
    const config = ports.config();
    return (
      config.enabled &&
      !!config.serverUrl.trim() &&
      config.namespaces.length > 0 &&
      ports.token(config.tokenEnvVar) !== null
    );
  };

  const commits = new Map<string, OpenShiftCommitData>();
  const seeds = new Map<string, OpenShiftCommitData>();
  /** Commits in the ports.cache() cache at the last hydration: a refresh keeps them, also below the fetch depth. */
  const cachedSHAs = new Set<string>();
  /**
   * Older commits only shown from the cache. A refresh does not save them again (that would mark every one as used
   * for eviction); opening one makes it a commit the user works with, saved like before.
   */
  const shownFromCache = new Set<string>();
  const queriedSHAs = new Set<string>();
  let watchGen = 0;
  const live = {
    listed: null as OpenShiftListedInventory | null,
  };
  /**
   * Each commit's warnings: the cached ones and every one read since. The cluster keeps an event for a few hours;
   * a commit keeps its warnings until the cache limit evicts it.
   */
  const warningsBySha = new Map<string, OpenShiftWarning[]>();
  /** The warnings the cluster listed last, linked again whenever the commits' resources change. */
  let listedWarnings: OpenShiftWarning[] = [];
  /** The Normal events the cluster listed last: shown with their commits while listed, never saved. */
  let listedNormal: OpenShiftWarning[] = [];
  /**
   * Each commit's Normal events. One keeps its commit while the cluster lists it, also once the pod it is about is
   * gone (then cached), as a warning does; it goes when the list no longer has it.
   */
  const normalBySha = new Map<string, OpenShiftWarning[]>();
  /** Namespaces whose events the token may not list, for the Events tab's notice. */
  let warningsDenied: string[] = [];
  /**
   * The event uids each namespace's last list had. A saved warning missing from it is one OpenShift deleted: only the
   * cache has it. A list that failed leaves its namespace's entry as it was.
   */
  const listedIds = new Map<string, Set<string>>();

  /**
   * Whether the commit still has what the warning is about. Known only once the live list loaded: before it, every
   * warning counts as present.
   */
  /** Whether only the cache has the event: its namespace's last list didn't (or none was read yet). */
  const warningIsCached = (warning: OpenShiftWarning) => !(listedIds.get(warning.namespace)?.has(warning.id) ?? false);

  /** The live list's pods that ran a Build: no commit holds them, their Build's commit shows their events. */
  const buildPods = (): OpenShiftResource[] =>
    (live.listed?.resources ?? []).filter(
      resource =>
        resource.kind === "Pod" &&
        (!!resource.labels?.["openshift.io/build.name"] ||
          (resource.ownerReferences ?? []).some(owner => owner.kind === "Build")),
    );

  function warningIsPresent(sha: string, warning: OpenShiftWarning): boolean {
    if (!live.listed) return true;
    if (isAboutPresentResource(warning, commits.get(sha.toLowerCase()), live.listed.controllers)) return true;
    // A build's pod is there while the live list has it.
    return (
      warning.kind === "Pod" &&
      buildPods().some(
        pod =>
          pod.namespace === warning.namespace &&
          pod.name === warning.name &&
          (!warning.uid || !pod.uid || pod.uid === warning.uid),
      )
    );
  }

  /** Links the listed warnings to the commits now held, attaches each commit's, and saves what is new. */
  function attachWarnings(): void {
    const controllers = live.listed?.controllers ?? [];
    const pods = buildPods();
    const linked = linkWarningsToCommits(listedWarnings, commits, controllers, pods);
    const linkedNormal = linkWarningsToCommits(listedNormal, commits, controllers, pods);
    const changed: string[] = [];
    for (const [sha, incoming] of linked) {
      const kept = warningsBySha.get(sha) ?? [];
      const merged = mergeWarnings(kept, incoming);
      if (sameWarnings(kept, merged)) continue;
      warningsBySha.set(sha, merged);
      changed.push(sha);
    }
    const listedById = new Map(listedNormal.map(entry => [entry.id, entry]));
    for (const sha of commits.keys()) {
      const now = linkedNormal.get(sha) ?? [];
      const before = (normalBySha.get(sha) ?? []).flatMap(entry => listedById.get(entry.id) ?? []);
      const events = mergeWarnings(before, now);
      if (events.length > 0) normalBySha.set(sha, events);
      else normalBySha.delete(sha);
    }
    for (const [sha, commit] of commits) {
      const warnings = warningsBySha.get(sha);
      const listed = normalBySha.get(sha);
      // The same events read again keep their list, so nothing that shows them redraws.
      const normalEvents =
        listed && commit.normalEvents && sameWarnings(commit.normalEvents, listed) ? commit.normalEvents : listed;
      const found = commitFailures(commit, pods);
      const failures: OpenShiftFailure[] | undefined =
        found.length === 0
          ? undefined
          : commit.failures && sameFailures(commit.failures, found)
            ? commit.failures
            : found;
      if (commit.warnings !== warnings || commit.normalEvents !== normalEvents || commit.failures !== failures)
        commits.set(sha, { ...commit, warnings, normalEvents, failures });
    }
    // An older commit only shown from the cache keeps its new warnings too, without counting as a use for eviction.
    const used = changed.filter(sha => !shownFromCache.has(sha));
    const shown = changed.filter(sha => shownFromCache.has(sha));
    if (used.length > 0) void persistWarnings(used, true);
    if (shown.length > 0) void persistWarnings(shown, false);
  }

  async function persistWarnings(shas: string[], touch: boolean): Promise<void> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    try {
      await persistMerged(
        ports.cache(),
        repoPath,
        shas,
        () => lifecycle().isCurrent(epoch, repoPath) && !app.suspended(),
        sha => warningsBySha.get(sha) ?? [],
        (sha, existing, incoming: OpenShiftWarning[]) => ({
          sha,
          builds: existing?.builds ?? [],
          warnings: mergeWarnings(existing?.warnings ?? [], incoming),
        }),
        { touch },
      );
    } catch (err) {
      debugError("OpenShift", err);
    }
  }

  function publish(): void {
    attachWarnings();
    ports.onDataChange();
    // The Events tab's `(cached)`: the event or the resource it is about is gone from the cluster.
    const badges = buildOpenShiftGraphBadges(
      commits,
      (sha, warning) => !warningIsPresent(sha, warning) || warningIsCached(warning),
      (sha, event) => !warningIsPresent(sha, event),
    );
    // What each namespace runs comes from the whole live list, so a deployed commit below the window is marked too.
    const markers = live.listed
      ? buildOpenShiftNamespaceMarkers(live.listed.resources, ports.config().namespaces)
      : new Map();
    for (const [sha, namespaces] of markers) {
      const badge = badges.get(sha);
      if (badge) badges.set(sha, { ...badge, namespaces });
      else badges.set(sha, { ...emptyGraphBadge(sha), namespaces });
    }
    app.setBadges(badges);
  }

  function unavailableMessage(): string {
    if (!ports.config().serverUrl.trim()) return OPENSHIFT_BANNER.noServer;
    if (ports.config().namespaces.length === 0) return OPENSHIFT_BANNER.noNamespaces;
    if (!ports.token(ports.config().tokenEnvVar)) return OPENSHIFT_BANNER.missingToken(ports.config().tokenEnvVar);
    return OPENSHIFT_BANNER.unavailable;
  }

  /**
   * The status message the live list itself set (a failed or partial list). A later good list clears only that one,
   * never a build-inventory or other error it does not own.
   */
  // Owned by identity, not wording: the build inventory can report the very same banner text.
  let liveStatus: ReturnType<typeof providerError> | null = null;
  const setLiveStatus = (kind: "error" | "warning", message: string) => {
    liveStatus = kind === "error" ? providerError(message) : providerWarning(message);
    app.setStatus(liveStatus);
  };
  const clearLiveStatus = () => {
    if (liveStatus && app.status() === liveStatus) app.setStatus(providerIdle());
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
    ports.restartLive();
  };
  /** Start the live list again after a retry or a status-showing refresh: it may have stopped on a 401. */
  const restartLive = (signal: AbortSignal | undefined, epoch: number) => {
    if (!signal?.aborted && epoch === lifecycle().getEpoch() && !authFrozen) ports.restartLive();
  };

  /**
   * Every cached commit shows its builds, also below the fetch depth (the cache limit decides how many commits keep
   * builds, the fetch depth only which ones the inventory asks about). Commits in the fetch window are read, which
   * counts as a use for eviction; older ones are only peeked.
   */
  async function hydrateCachedCandidates(repoPath: string, epoch: number): Promise<void> {
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    const peeked = await ports.cache().peekAll(repoPath);
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    cachedSHAs.clear();
    for (const entry of peeked) cachedSHAs.add(entry.sha.toLowerCase());
    const window = new Set(collectTopSHAs(app.graphRows(), ports.config().fetchDepth).map(sha => sha.toLowerCase()));
    let changed = false;
    for (const cached of peeked) {
      const sha = cached.sha.toLowerCase();
      if (commits.has(sha)) continue;
      const entry = window.has(sha) ? await ports.cache().read(repoPath, sha) : cached;
      if (!lifecycle().isCurrent(epoch, repoPath)) return;
      if (!entry) continue;
      commits.set(sha, commitDataFromCacheEntry(entry));
      if (entry.warnings?.length) warningsBySha.set(sha, mergeWarnings(warningsBySha.get(sha) ?? [], entry.warnings));
      if (!window.has(sha)) shownFromCache.add(sha);
      changed = true;
    }
    if (changed) ports.onDataChange();
  }

  async function persistTerminalBuilds(
    repoPath: string,
    data: Map<string, OpenShiftCommitData>,
    epoch: number,
  ): Promise<void> {
    await persistMerged(
      ports.cache(),
      repoPath,
      [...data.keys()],
      () => lifecycle().isCurrent(epoch, repoPath),
      sha =>
        (data.get(sha)?.namespaces ?? [])
          .flatMap(ns => ns.builds)
          .map(toCachedBuild)
          .filter((build): build is NonNullable<typeof build> => build !== null && isTerminalBuildStatus(build.status)),
      (sha, existing, incoming) => ({
        sha,
        builds: mergeById(existing?.builds ?? [], incoming),
        ...(existing?.warnings ? { warnings: existing.warnings } : {}),
      }),
    );
  }

  function eligibleSHAs(): Set<string> {
    const window = collectTopSHAs(app.graphRows(), ports.config().fetchDepth);
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
    const token = ports.token(ports.config().tokenEnvVar);
    if (!token) return;
    const requestConfig = ports.config();
    const repoPath = app.repoPath();
    if (args.showStatus) app.setStatus(providerLoading());
    try {
      await hydrateCachedCandidates(repoPath, args.epoch);
      if (args.signal?.aborted || !lifecycle().isCurrent(args.epoch, repoPath)) return;
      const window = collectTopSHAs(app.graphRows(), ports.config().fetchDepth);
      const result = await ports.api.fetchOpenShiftInventory(requestConfig, token, args.signal, "seeds", {
        commitShas: window,
      });
      if (args.signal?.aborted || !lifecycle().isCurrent(args.epoch, repoPath)) return;
      if (result.failure === "auth") {
        lifecycle().noteFetchResult(false);
        freezeAuth();
        publish();
        app.setStatus(providerError(OPENSHIFT_BANNER.tokenExpired));
        return;
      }
      if (result.successfulRequests === 0 && result.error) {
        // Failures back off like GitHub's and Jenkins': quiet fetches (the Dashboard, auto refresh) wait.
        lifecycle().noteFetchResult(false);
        publish();
        app.setStatus(providerError(result.error));
        return;
      }
      const warningList = await fetchWarnings(requestConfig, token, args.signal);
      if (args.signal?.aborted || !lifecycle().isCurrent(args.epoch, repoPath)) return;
      // An expired token on the warnings: the builds still show, then requests stop as after any 401.
      const warningsAuth = warningList?.failure === "auth";
      if (warningList && !warningsAuth) applyWarningList(requestConfig, warningList);
      seeds.clear();
      for (const [sha, commit] of result.data) seeds.set(sha.toLowerCase(), commit);
      // Window commits and cached older ones take the builds the cluster still lists for them.
      const candidates = selectOpenShiftCandidateSHAs(
        [...collectTopSHAs(app.graphRows(), ports.config().fetchDepth), ...cachedSHAs],
        seeds.keys(),
      );
      const forDisk = filterToEligible(result.data);
      await persistTerminalBuilds(repoPath, forDisk, args.epoch);
      if (!lifecycle().isCurrent(args.epoch, repoPath)) return;
      const allowed = eligibleSHAs();
      for (const sha of [...commits.keys()]) {
        if (allowed.has(sha.toLowerCase()) || candidates.has(sha) || seeds.has(sha)) continue;
        if (cachedSHAs.has(sha.toLowerCase())) continue;
        commits.delete(sha);
        warningsBySha.delete(sha);
        normalBySha.delete(sha);
      }
      for (const sha of candidates) {
        const commit = seeds.get(sha);
        if (commit) commits.set(sha, mergeLiveIntoCommit(commit, commits.get(sha), sha));
      }
      // The commits it asked about: a build it no longer lists was pruned while the app ran.
      const failedNamespaces = new Set(
        result.failures.filter(failure => failure.kind === "Build").map(failure => failure.namespace),
      );
      for (const sha of window.map(entry => entry.toLowerCase())) {
        const commit = commits.get(sha);
        if (!commit) continue;
        const listed = new Set(
          (seeds.get(sha)?.namespaces ?? []).flatMap(ns => ns.builds.filter(b => !b.cacheOnly).map(b => b.id)),
        );
        commits.set(sha, markUnlistedBuilds(commit, listed, failedNamespaces));
      }
      // The live list may have landed first: commits this build list adds get their live resources now, not on the
      // next watch event or selection.
      if (live.listed) applyLive(live.listed);
      else publish();
      lifecycle().noteFetchStarted();
      if (warningsAuth) {
        lifecycle().noteFetchResult(false);
        freezeAuth();
        app.setStatus(providerError(OPENSHIFT_BANNER.tokenExpired));
        return;
      }
      // Some namespaces answered: a warning, not a failure to back off from.
      lifecycle().noteFetchResult(true);
      // A status the live list set (a live 401 that froze requests, a failed list) is the live list's to clear.
      const liveOwned = liveStatus !== null && app.status() === liveStatus;
      if (result.error) {
        if (!liveOwned) app.setStatus(providerWarning(result.error));
      } else {
        if (!liveOwned) app.setStatus(providerIdle());
        app.noteSuccess();
      }
    } catch (err) {
      if (args.signal?.aborted || !lifecycle().isCurrent(args.epoch, repoPath)) return;
      debugError("OpenShift", err);
      const auth = failureOf(err) === "auth";
      const message = auth ? OPENSHIFT_BANNER.tokenExpired : OPENSHIFT_BANNER.inventoryFailed;
      if (auth) freezeAuth();
      lifecycle().noteFetchResult(false);
      publish();
      app.setStatus(providerError(message));
    }
  }

  /** Reads the warnings again, or null when the request failed: the warnings keep what they had. */
  async function fetchWarnings(
    config: OpenShiftClusterConfig,
    token: string,
    signal?: AbortSignal,
  ): Promise<OpenShiftWarningList | null> {
    try {
      return await ports.api.fetchOpenShiftWarnings(config, token, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      debugError("OpenShift", err);
      return null;
    }
  }

  /** Keeps what the cluster listed; the warnings are linked to commits when the commits are published. */
  function applyWarningList(config: OpenShiftClusterConfig, list: OpenShiftWarningList): void {
    warningsDenied = list.denied;
    const unanswered = new Set([...list.denied, ...list.failed]);
    // A namespace that did not answer keeps what it listed last, to link once what it is about shows.
    const keptOf = (listed: readonly OpenShiftWarning[]) => listed.filter(entry => unanswered.has(entry.namespace));
    listedWarnings = [...keptOf(listedWarnings), ...list.warnings];
    listedNormal = [...keptOf(listedNormal), ...(list.normal ?? [])];
    for (const namespace of config.namespaces) {
      if (unanswered.has(namespace)) continue;
      listedIds.set(namespace, new Set(list.warnings.filter(entry => entry.namespace === namespace).map(entry => entry.id)));
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
    const repoPath = app.repoPath();
    const token = ports.token(ports.config().tokenEnvVar);
    if (!token) return;
    const gen = ++watchGen;
    let delayMs = 1000;
    ports.onLiveState("loading");
    try {
      while (!signal.aborted && lifecycle().isCurrent(epoch, repoPath)) {
        try {
          ports.onLiveState("loading");
          const listed = await ports.api.fetchOpenShiftResources(ports.config(), token, signal, "live", {
            commitShas: [],
          });
          if (signal.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
          if (listed.failure === "auth") {
            authFrozen = true;
            setLiveStatus("error", OPENSHIFT_BANNER.tokenExpired);
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
            if (signal.aborted || !lifecycle().isCurrent(epoch, repoPath) || !live.listed) return;
            const result = applyOpenShiftWatchEvent(live.listed, event, ports.config().commitShaAnnotation);
            if (result === "gone") {
              child.abort();
              return;
            }
            if (result === "applied") {
              applyLive(live.listed);
            }
          };
          const watches = ports.config().namespaces.flatMap(ns =>
            OPENSHIFT_WATCH_KINDS.map(kind => {
              const resourceVersion = listed.resourceVersions.get(`${ns}:${kind}`);
              if (!resourceVersion || resourceVersion === "0") return null;
              return ports.api.watchOpenShiftStream(
                ports.config().serverUrl,
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
          ports.onLiveState(running.length > 0 ? "live" : "idle");
          const results = running.length > 0 ? await Promise.all(running) : [];
          if (!signal.aborted && lifecycle().isCurrent(epoch, repoPath)) ports.onLiveState("loading");
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
          if (results.includes("auth")) {
            authFrozen = true;
            setLiveStatus("error", OPENSHIFT_BANNER.tokenExpired);
            return;
          }
          if (results.length > 0 && results.every(result => result === "forbidden")) {
            // The live list's own warning: a build inventory that lands later must not clear it, a good list after
            // Reload does.
            setLiveStatus("warning", OPENSHIFT_BANNER.watchDenied);
            return;
          }
          delayMs = 1000;
          await sleep(delayMs, signal);
        } catch (err) {
          if (signal.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
          debugError("OpenShift", err);
          ports.onLiveState("loading");
          try {
            await sleep(delayMs, signal);
            delayMs = Math.min(delayMs * 2, 10_000);
          } catch {
            return;
          }
        }
      }
    } finally {
      if (gen === watchGen) ports.onLiveState("idle");
    }
  }

  // ── What the lifecycle runs ─────────────────────────────────────────────────────────────────────

  const reportUnavailable = (showStatus: boolean) => {
    if (showStatus) app.setStatus(providerUnavailable(unavailableMessage()));
  };
  const onCancelledStatus = () => {
    if (app.status().kind === "loading") app.setStatus(providerIdle());
  };
  const runInitialFetch = async ({ signal, showStatus, retry, epoch }: ProviderFetchArgs) => {
    if (authFrozen && !retry) return;
    if (retry) authFrozen = false;
    await runBuildInventory({ signal, showStatus, epoch });
    // A retry the queue merged into a first fetch restarts the live list too.
    if (retry) restartLive(signal, epoch);
  };
  const runRefresh = async ({ signal, showStatus, retry, epoch }: ProviderFetchArgs) => {
    if (authFrozen && !retry) return;
    if (retry) authFrozen = false;
    await runBuildInventory({ signal, showStatus, epoch });
    if (showStatus || retry) restartLive(signal, epoch);
  };
  const onResetCaches = () => {
    authFrozen = false;
    commits.clear();
    seeds.clear();
    cachedSHAs.clear();
    shownFromCache.clear();
    live.listed = null;
    warningsBySha.clear();
    listedWarnings = [];
    listedNormal = [];
    normalBySha.clear();
    warningsDenied = [];
    listedIds.clear();
    ports.onLiveState("idle");
    ports.restartLive();
    queriedSHAs.clear();
    ports.onDataChange();
    app.setBadges(new Map());
    app.setStatus(providerIdle());
  };

  return {
    /** A commit's builds and resources, or null. Not reactive: the adapter makes it so. */
    getCommitData: (sha: string) => commits.get(sha.toLowerCase()) ?? null,
    /** Every build held for the open repository, shaped like cache entries. Not reactive: the adapter makes it so. */
    heldEntries: (): OpenShiftCacheEntry[] =>
      [...commits.values()].map(commit => ({
        sha: commit.sha,
        builds: commit.namespaces
          .flatMap(namespace => namespace.builds)
          .map(toCachedBuild)
          .filter(build => build !== null),
      })),
    queriedSHAs,
    /** Whether the commit still has what the warning is about (the Events tab's sections, the graph's count). */
    warningIsPresent,
    /** Whether only the cache has this warning: its namespace's last list didn't (or none was read yet). */
    warningIsCached,
    /** Every warning kept about a resource, newest first: the resource dialog shows the ones OpenShift deleted. */
    warningsAboutResource: (resource: OpenShiftResource): OpenShiftWarning[] =>
      mergeWarnings(
        [],
        [...warningsBySha.values()].flatMap(list => warningsAbout(resource, list)),
      ),
    /** The namespaces whose warnings the token may not read: the Events tab says so. */
    warningsDenied: (): readonly string[] => warningsDenied,
    /** Frozen after a 401: no live session starts until a Reload. */
    isFrozen: () => authFrozen,
    isAvailable,
    reportUnavailable,
    onCancelledStatus,
    runInitialFetch,
    runRefresh,
    onResetCaches,
    runWatchSession,
    refresh: async () => lifecycle().fetchRefresh(undefined, true, true),
    fetchCommitDataForSHA: async (sha: string, force?: boolean) => {
      if (app.suspended()) return;
      try {
        shownFromCache.delete(sha.toLowerCase());
        if (!adoptCommit(sha) && !force) return;
        if (force) {
          // Setup missing: nothing can load, so do not look busy (the row is disabled; guard the direct call too).
          if (!isAvailable()) return;
          // Reload commit is an explicit retry: it lifts an auth freeze and reloads the build inventory as well as
          // the live list (OpenShift matches by window, so this is the same as :reload).
          await lifecycle().fetchRefresh(undefined, true, true);
          return;
        }
        if (live.listed) applyLive(live.listed, new Set([sha.toLowerCase()]));
      } catch (err) {
        debugError("OpenShift", err);
      }
    },
    loadBuildLog: async (resource: OpenShiftResource, force = false) => {
      const epoch = lifecycle().getEpoch();
      const repoPath = app.repoPath();
      if (!lifecycle().isCurrent(epoch, repoPath)) return "";
      const sha = resource.commitSha;
      // A build only the cache has: its saved log or none, also on refresh. The cluster would only answer 404.
      if (sha && isTerminalBuildStatus(resource.status) && (!force || resource.cacheOnly)) {
        const cached = await ports.cache().readLog(repoPath, sha, resource.namespace, resource.name);
        if (!lifecycle().isCurrent(epoch, repoPath)) return "";
        if (cached) return cached;
      }
      if (resource.cacheOnly) return "";
      const token = ports.token(ports.config().tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const log = await lifecycle().runRequest(signal =>
        ports.api.fetchOpenShiftBuildLog(ports.config().serverUrl, token, resource.namespace, resource.name, signal),
      );
      if (!lifecycle().isCurrent(epoch, repoPath)) return "";
      if (sha && isTerminalBuildStatus(resource.status) && lifecycle().isCurrent(epoch, repoPath)) {
        await ports.cache().writeLog(repoPath, sha, resource.namespace, resource.name, log);
      }
      return log;
    },
    loadPodLog: async (resource: OpenShiftResource, container?: string) => {
      const epoch = lifecycle().getEpoch();
      const repoPath = app.repoPath();
      if (!lifecycle().isCurrent(epoch, repoPath)) return "";
      const token = ports.token(ports.config().tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const log = await lifecycle().runRequest(signal =>
        ports.api.fetchOpenShiftPodLog(
          ports.config().serverUrl,
          token,
          resource.namespace,
          resource.name,
          container,
          signal,
        ),
      );
      return lifecycle().isCurrent(epoch, repoPath) ? log : "";
    },
    followLog: async (resource: OpenShiftResource, signal: AbortSignal, onText: (text: string) => void) => {
      const epoch = lifecycle().getEpoch();
      const repoPath = app.repoPath();
      if (!lifecycle().isCurrent(epoch, repoPath)) return;
      const token = ports.token(ports.config().tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      let acc = "";
      const url =
        resource.kind === "Pod"
          ? openShiftPodLogUrl(ports.config().serverUrl, resource.namespace, resource.name, undefined, true)
          : openShiftBuildLogUrl(ports.config().serverUrl, resource.namespace, resource.name, true);
      await lifecycle().runRequest(
        signal =>
          ports.api.followOpenShiftLog(url, token, signal, chunk => {
            if (signal.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
            acc = appendOpenShiftLogFollow(acc, chunk);
            onText(acc);
          }),
        signal,
      );
    },
    loadResourceObject: async (resource: OpenShiftResource, force = false) => {
      const epoch = lifecycle().getEpoch();
      const repoPath = app.repoPath();
      if (!force && resource.object !== undefined) return resource.object;
      if (!lifecycle().isCurrent(epoch, repoPath)) return null;
      if (!force && resource.kind === "Build" && resource.commitSha && isTerminalBuildStatus(resource.status)) {
        const entry = await ports.cache().read(repoPath, resource.commitSha);
        if (!lifecycle().isCurrent(epoch, repoPath)) return null;
        const cached = entry?.builds.find(
          build => build.id === resource.id || (build.namespace === resource.namespace && build.name === resource.name),
        );
        if (cached?.object !== undefined) return cached.object;
      }
      const token = ports.token(ports.config().tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const object = await lifecycle().runRequest(signal =>
        ports.api.fetchOpenShiftObject(ports.config().serverUrl, token, resource, signal),
      );
      return lifecycle().isCurrent(epoch, repoPath) ? object : null;
    },
    loadResourceEvents: async (resource: OpenShiftResource) => {
      const epoch = lifecycle().getEpoch();
      const repoPath = app.repoPath();
      const token = ports.token(ports.config().tokenEnvVar);
      if (!token) throw new Error(unavailableMessage());
      const events = await lifecycle().runRequest(signal =>
        ports.api.fetchOpenShiftEvents(ports.config().serverUrl, token, resource, signal),
      );
      return lifecycle().isCurrent(epoch, repoPath) ? events : [];
    },
  };
}

export type OpenShiftService = ReturnType<typeof createOpenShiftService>;
