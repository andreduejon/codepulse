/** The OpenShift service with its lifecycle, without Solid: the app is a plain object, the cluster and cache are fakes. */
import { expect, mock, test } from "bun:test";
import { FetchLifecycle } from "../fetch-lifecycle";
import type { GraphRow } from "../git/types";
import type { GraphBadge } from "../provider-model";
import type { ProviderStatus } from "../provider-status";
import { OPENSHIFT_BANNER } from "./banner";
import { commitDataFromCacheEntry } from "./commit-data";
import type { OpenShiftCacheEntry } from "./merge";
import { openShiftBadgeCounts } from "./resources";
import { createOpenShiftService, type OpenShiftApiPort, type OpenShiftCachePort } from "./service";
import type { OpenShiftResource } from "./types";
import { DEFAULT_OPENSHIFT_CONFIG } from "./types";
import type { OpenShiftWarning, OpenShiftWarningList } from "./warnings";

const SHA = "c".repeat(40);
const build: OpenShiftResource = {
  id: "Build:ns:app-1",
  kind: "Build",
  namespace: "ns",
  name: "app-1",
  status: "pass",
  imageRefs: ["sha256:abc"],
  commitSha: SHA,
};

function harness() {
  const app = {
    status: { kind: "idle" } as ProviderStatus,
    badges: new Map<string, GraphBadge>(),
    rows: [{ commit: { hash: SHA, refs: [] } }] as unknown as GraphRow[],
  };
  const saved = new Map<string, OpenShiftCacheEntry>();
  /** Each saved commit and whether the save marked it as used. */
  const touched = new Map<string, boolean>();
  const cache: OpenShiftCachePort = {
    read: async (_repo, sha) => saved.get(sha) ?? null,
    peekAll: async () => [...saved.values()],
    readLog: async () => null,
    writeLog: async () => {},
    mergeMany: async (_repo, items, merge, _isCurrent, options) => {
      for (const item of items) {
        // As the SQLite cache: an entry only shown that the cache dropped is not written back.
        if (options?.touch === false && !saved.has(item.sha)) continue;
        saved.set(item.sha, merge(item.sha, saved.get(item.sha) ?? null, [...item.incoming]));
        touched.set(item.sha, options?.touch !== false);
      }
      return items.length;
    },
  };
  let error: string | null = null;
  // What the cluster lists: the build as the API gives it, not a copy from the cache.
  const fromCache = commitDataFromCacheEntry({ sha: SHA, builds: [{ ...build, commitSha: SHA }] as never });
  const listed = {
    ...fromCache,
    namespaces: fromCache.namespaces.map(ns => ({
      ...ns,
      builds: ns.builds.map(({ cacheOnly: _cacheOnly, ...listedBuild }) => listedBuild),
    })),
  };
  const api = {
    fetchOpenShiftInventory: mock(async () => ({
      data: error ? new Map() : new Map([[SHA, listed]]),
      error,
      failure: error ? ("auth" as const) : undefined,
      failures: [],
      successfulRequests: error ? 0 : 1,
    })),
  };
  const cluster = { warnings: { warnings: [], denied: [], failed: [] } as OpenShiftWarningList };
  Object.assign(api, { fetchOpenShiftWarnings: mock(async () => cluster.warnings) });
  const restarts = { count: 0 };
  let lifecycle!: FetchLifecycle;
  const service = createOpenShiftService({
    app: {
      repoPath: () => "/repo",
      graphRows: () => app.rows,
      badges: () => app.badges,
      status: () => app.status,
      setStatus: status => {
        app.status = status;
      },
      setBadges: badges => {
        app.badges = badges;
      },
      noteSuccess: () => {},
      suspended: () => false,
      view: () => "openshift",
    },
    api: api as unknown as OpenShiftApiPort,
    cache: () => cache,
    config: () => ({ ...DEFAULT_OPENSHIFT_CONFIG, enabled: true, serverUrl: "https://cluster", namespaces: ["ns"] }),
    token: () => "token",
    lifecycle: () => lifecycle,
    onDataChange: () => {},
    onLiveState: () => {},
    restartLive: () => {
      restarts.count++;
    },
  });
  lifecycle = new FetchLifecycle(
    {
      view: () => "openshift",
      repoPath: () => "/repo",
      graphRows: () => app.rows,
      autoRefreshInterval: () => 0,
      suspended: () => false,
      untracked: fn => fn(),
      onReset: () => {},
      onActiveFetches: () => {},
    },
    { providerId: "openshift", isBackgroundReady: () => false, skipShaBackground: true, ...service },
  );
  return {
    app,
    cache,
    saved,
    touched,
    api,
    service,
    lifecycle,
    restarts,
    cluster,
    fail: (next: string | null) => {
      error = next;
    },
  };
}

test("the build list shows the commit's builds and badge, and saves the finished ones", async () => {
  const h = harness();
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.getCommitData(SHA)?.namespaces[0]?.builds.map(b => b.name)).toEqual(["app-1"]);
  expect(h.app.badges.has(SHA)).toBe(true);
  expect(h.saved.get(SHA)?.builds.map(b => b.name)).toEqual(["app-1"]);
  expect(h.app.status.kind).toBe("idle");
});

test("an expired token freezes the live list until a Reload, which starts it again", async () => {
  const h = harness();
  h.fail(OPENSHIFT_BANNER.tokenExpired);
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.isFrozen()).toBe(true);
  expect(h.app.status).toEqual({ kind: "error", message: OPENSHIFT_BANNER.tokenExpired });
  h.fail(null);
  const before = h.restarts.count;
  await h.service.refresh();
  expect(h.service.isFrozen()).toBe(false);
  expect(h.restarts.count).toBeGreaterThan(before);
  expect(h.service.getCommitData(SHA)?.namespaces[0]?.builds).toHaveLength(1);
});

const buildWarning = (overrides: Partial<OpenShiftWarning> = {}): OpenShiftWarning => ({
  id: "event-1",
  namespace: "ns",
  kind: "Build",
  name: "app-1",
  reason: "BuildFailed",
  message: "Build ns/app-1 failed",
  count: 1,
  firstSeen: "2026-03-02T09:16:00Z",
  lastSeen: "2026-03-02T09:16:00Z",
  ...overrides,
});

test("a warning about a commit's resource shows with the commit and is saved with its builds", async () => {
  const h = harness();
  h.cluster.warnings = { warnings: [buildWarning()], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.getCommitData(SHA)?.warnings?.map(w => w.id)).toEqual(["event-1"]);
  expect(h.saved.get(SHA)?.warnings?.map(w => w.id)).toEqual(["event-1"]);
  expect(h.saved.get(SHA)?.builds.map(b => b.name)).toEqual(["app-1"]);
});

test("a warning the cluster no longer lists stays with its commit; a newer read of it updates it", async () => {
  const h = harness();
  h.cluster.warnings = { warnings: [buildWarning(), buildWarning({ id: "event-2" })], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  h.cluster.warnings = {
    warnings: [buildWarning({ id: "event-2", count: 4, lastSeen: "2026-03-02T09:30:00Z" })],
    denied: [],
    failed: [],
  };
  await h.service.refresh();
  expect(h.service.getCommitData(SHA)?.warnings?.map(w => [w.id, w.count])).toEqual([
    ["event-2", 4],
    ["event-1", 1],
  ]);
  expect(h.saved.get(SHA)?.warnings?.map(w => [w.id, w.count])).toEqual([
    ["event-2", 4],
    ["event-1", 1],
  ]);
});

test("a namespace whose events the token may not list is named, until it may", async () => {
  const h = harness();
  h.cluster.warnings = { warnings: [], denied: ["ns"], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.warningsDenied()).toEqual(["ns"]);
  h.cluster.warnings = { warnings: [], denied: [], failed: [] };
  await h.service.refresh();
  expect(h.service.warningsDenied()).toEqual([]);
});

test("a namespace whose event list failed is named too, until it answers", async () => {
  const h = harness();
  h.cluster.warnings = { warnings: [], denied: [], failed: ["ns"] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.warningsFailed()).toEqual(["ns"]);
  h.cluster.warnings = { warnings: [], denied: [], failed: [] };
  await h.service.refresh();
  expect(h.service.warningsFailed()).toEqual([]);
});

test("a warning is cached when its namespace's last list lacks it; a failed list changes nothing", async () => {
  const h = harness();
  h.cluster.warnings = { warnings: [buildWarning(), buildWarning({ id: "event-2" })], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.warningIsCached(buildWarning())).toBe(false);
  // OpenShift deleted event-1.
  h.cluster.warnings = { warnings: [buildWarning({ id: "event-2" })], denied: [], failed: [] };
  await h.service.refresh();
  expect(h.service.warningIsCached(buildWarning())).toBe(true);
  expect(h.service.warningIsCached(buildWarning({ id: "event-2" }))).toBe(false);
  // The namespace's list failed: what it said last still holds.
  h.cluster.warnings = { warnings: [], denied: [], failed: ["ns"] };
  await h.service.refresh();
  expect(h.service.warningIsCached(buildWarning({ id: "event-2" }))).toBe(false);
  // Every saved warning about a resource, for the resource dialog.
  expect(h.service.warningsAboutResource(build).map(w => w.id)).toEqual(["event-1", "event-2"]);
});

test("warnings read from the cache are cached until their namespace is listed", async () => {
  const h = harness();
  h.saved.set(SHA, { sha: SHA, builds: [], warnings: [buildWarning()] });
  h.fail(OPENSHIFT_BANNER.tokenExpired);
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.getCommitData(SHA)?.warnings?.map(w => w.id)).toEqual(["event-1"]);
  expect(h.service.warningIsCached(buildWarning())).toBe(true);
});

test("a warning about a resource the live list no longer has is not present; the graph counts only present ones", async () => {
  const h = harness();
  const pod = (name: string, uid: string): OpenShiftResource => ({
    id: `Pod:ns:${name}`,
    kind: "Pod",
    namespace: "ns",
    name,
    uid,
    status: "pass",
    imageRefs: [],
    commitSha: SHA,
  });
  const liveList = (resources: OpenShiftResource[]) => ({
    resources,
    controllers: [],
    error: null,
    failures: [],
    successfulRequests: 1,
    resourceVersions: new Map(),
  });
  let listed = liveList([pod("app-1-abcde", "pod-1")]);
  Object.assign(h.api, {
    fetchOpenShiftResources: mock(async () => listed),
    watchOpenShiftStream: mock(async () => "end"),
  });
  const liveOnce = async () => {
    const stop = new AbortController();
    const session = h.service.runWatchSession(stop.signal, h.lifecycle.getEpoch());
    await Bun.sleep(5);
    stop.abort();
    await session;
  };
  const podWarning = buildWarning({ id: "event-pod", kind: "Pod", name: "app-1-abcde", uid: "pod-1" });
  h.cluster.warnings = { warnings: [buildWarning(), podWarning], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  // No live list yet: nothing is known gone.
  expect(h.service.warningIsPresent(SHA, podWarning)).toBe(true);
  await liveOnce();
  expect(
    h.service
      .getCommitData(SHA)
      ?.warnings?.map(w => w.id)
      .sort(),
  ).toEqual(["event-1", "event-pod"]);
  expect(h.service.warningIsPresent(SHA, podWarning)).toBe(true);
  expect(openShiftBadgeCounts(h.app.badges.get(SHA))).toMatchObject({ warnings: 2 });
  expect(openShiftBadgeCounts(h.app.badges.get(SHA)).cachedEvents).toBeUndefined();
  // The pod was replaced by another one with the same commit.
  listed = liveList([pod("app-1-fghij", "pod-2")]);
  await liveOnce();
  expect(h.service.warningIsPresent(SHA, podWarning)).toBe(false);
  expect(h.service.warningIsPresent(SHA, buildWarning())).toBe(true);
  expect(h.service.getCommitData(SHA)?.warnings).toHaveLength(2);
  expect(openShiftBadgeCounts(h.app.badges.get(SHA))).toMatchObject({ warnings: 1, cachedEvents: 1 });
});

test("a finished build the cluster prunes while the app runs is shown from the cache from the next list on", async () => {
  const h = harness();
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.getCommitData(SHA)?.namespaces[0]?.builds[0]?.cacheOnly).toBeUndefined();
  // A list that failed for the namespace changes nothing.
  const answer = (failed: boolean) => ({
    data: new Map(),
    error: failed ? OPENSHIFT_BANNER.inventoryPartial : null,
    failures: failed ? [{ namespace: "ns", kind: "Build", path: "/builds", error: "500" }] : [],
    successfulRequests: 1,
  });
  Object.assign(h.api, { fetchOpenShiftInventory: mock(async () => answer(true)) });
  await h.service.refresh();
  expect(h.service.getCommitData(SHA)?.namespaces[0]?.builds[0]?.cacheOnly).toBeUndefined();
  // OpenShift pruned it: the list answered without it.
  Object.assign(h.api, { fetchOpenShiftInventory: mock(async () => answer(false)) });
  await h.service.refresh();
  expect(h.service.getCommitData(SHA)?.namespaces[0]?.builds.map(b => [b.name, b.cacheOnly])).toEqual([
    ["app-1", true],
  ]);
  expect(openShiftBadgeCounts(h.app.badges.get(SHA)).cached).toBe(1);
});

test("a build only the cache has gives its saved log, or none: the cluster no longer has it to ask", async () => {
  const h = harness();
  const fetchLog = mock(async () => "from the cluster");
  Object.assign(h.api, { fetchOpenShiftBuildLog: fetchLog });
  const pruned: OpenShiftResource = { ...build, cacheOnly: true };
  expect(await h.service.loadBuildLog(pruned)).toBe("");
  // Refresh (force) doesn't ask either.
  expect(await h.service.loadBuildLog(pruned, true)).toBe("");
  expect(fetchLog).not.toHaveBeenCalled();
  // A listed build still asks.
  expect(await h.service.loadBuildLog(build, true)).toBe("from the cluster");
});

test("a warning about an older commit only shown from the cache is saved without marking it as used", async () => {
  const h = harness();
  const OLD = "d".repeat(40);
  const oldBuild = { ...build, id: "Build:ns:app-0", name: "app-0", commitSha: OLD };
  h.saved.set(OLD, { sha: OLD, builds: [oldBuild] as never });
  h.cluster.warnings = { warnings: [buildWarning({ id: "event-old", name: "app-0" })], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.getCommitData(OLD)?.warnings?.map(w => w.id)).toEqual(["event-old"]);
  expect(h.saved.get(OLD)?.warnings?.map(w => w.id)).toEqual(["event-old"]);
  expect(h.touched.get(OLD)).toBe(false);
  // The window's commit is used as before.
  expect(h.touched.get(SHA)).toBe(true);
});

test("a warning never writes back a commit the cache dropped: its builds and another commit's log stay", async () => {
  const h = harness();
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.saved.get(SHA)?.builds).toHaveLength(1);
  // The cache limit drops the commit (another commit's builds were saved) just before its new warning is.
  const mergeMany = h.cache.mergeMany;
  h.cache.mergeMany = (repo, items, merge, isCurrent, options) => {
    if (items.some(item => item.incoming.some(entry => "reason" in (entry as object)))) h.saved.delete(SHA);
    return mergeMany(repo, items, merge, isCurrent, options);
  };
  h.cluster.warnings = { warnings: [buildWarning()], denied: [], failed: [] };
  await h.service.refresh();
  expect(h.service.getCommitData(SHA)?.warnings?.map(w => w.id)).toEqual(["event-1"]);
  expect(h.saved.has(SHA)).toBe(false);
});

test("a warning whose first save failed is saved with the next change: only a save that landed counts", async () => {
  const h = harness();
  const running = { ...build, status: "running" as const };
  Object.assign(h.api, {
    fetchOpenShiftInventory: mock(async () => ({
      data: new Map([
        [
          SHA,
          {
            sha: SHA,
            liveFetched: true,
            namespaces: [
              {
                namespace: "ns",
                builds: [running],
                imageStreamTags: [],
                deployments: [],
                deploymentConfigs: [],
                pods: [],
              },
            ],
          },
        ],
      ]),
      error: null,
      failures: [],
      successfulRequests: 1,
    })),
  });
  // The cache is busy (another writer holds it): the first save writes nothing.
  const mergeMany = h.cache.mergeMany;
  let busy = true;
  h.cache.mergeMany = async (repo, items, merge, isCurrent, options) =>
    busy ? 0 : mergeMany(repo, items, merge, isCurrent, options);
  h.cluster.warnings = { warnings: [buildWarning()], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  await Bun.sleep(0);
  expect(h.saved.has(SHA)).toBe(false);
  busy = false;
  h.cluster.warnings = {
    warnings: [buildWarning({ count: 2, lastSeen: "2026-03-02T09:20:00Z" })],
    denied: [],
    failed: [],
  };
  await h.service.refresh();
  await Bun.sleep(0);
  expect(h.saved.get(SHA)?.warnings?.map(w => w.count)).toEqual([2]);
});

test("an answer to the warnings that lands after a reset changes nothing", async () => {
  const h = harness();
  let answer!: (list: OpenShiftWarningList) => void;
  Object.assign(h.api, {
    fetchOpenShiftWarnings: mock(() => new Promise<OpenShiftWarningList>(resolve => (answer = resolve))),
  });
  const run = h.lifecycle.fetchInitial(undefined, undefined, true);
  await Bun.sleep(5);
  h.lifecycle.resetCaches();
  answer({ warnings: [buildWarning()], denied: ["ns"], failed: [] });
  await run;
  expect(h.service.warningsDenied()).toEqual([]);
  // Nothing was listed after the reset: the warning is not known to the cluster.
  expect(h.service.warningIsCached(buildWarning())).toBe(true);
});

test("an expired token on the warnings freezes automatic requests and says so", async () => {
  const h = harness();
  h.cluster.warnings = { warnings: [], denied: [], failed: [], failure: "auth" };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.isFrozen()).toBe(true);
  expect(h.app.status).toEqual({ kind: "error", message: OPENSHIFT_BANNER.tokenExpired });
});

test("the warnings of a commit codepulse no longer holds are let go with it", async () => {
  const h = harness();
  h.cluster.warnings = { warnings: [buildWarning()], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.warningsAboutResource(build).map(w => w.id)).toEqual(["event-1"]);
  // Another history, and the cache no longer has the commit.
  h.app.rows = [{ commit: { hash: "e".repeat(40), refs: [] } }] as unknown as GraphRow[];
  h.saved.clear();
  h.cluster.warnings = { warnings: [], denied: [], failed: [] };
  Object.assign(h.api, {
    fetchOpenShiftInventory: mock(async () => ({ data: new Map(), error: null, failures: [], successfulRequests: 1 })),
  });
  await h.service.refresh();
  expect(h.service.getCommitData(SHA)).toBeNull();
  expect(h.service.warningsAboutResource(build)).toEqual([]);
});

test("Normal events show with the commit while the cluster lists them, and are never saved", async () => {
  const h = harness();
  const started = buildWarning({
    id: "event-normal",
    reason: "BuildStarted",
    message: "Build ns/app-1 is now running",
  });
  h.cluster.warnings = { warnings: [buildWarning()], normal: [started], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.getCommitData(SHA)?.normalEvents?.map(e => e.id)).toEqual(["event-normal"]);
  expect(h.service.getCommitData(SHA)?.warnings?.map(e => e.id)).toEqual(["event-1"]);
  expect(h.saved.get(SHA)?.warnings?.map(e => e.id)).toEqual(["event-1"]);
  // The graph's Events column counts it apart from the warnings: green while listed.
  expect(openShiftBadgeCounts(h.app.badges.get(SHA))).toMatchObject({ warnings: 1, normal: 1 });
  // The cluster no longer lists it: it is gone, no cache keeps it.
  h.cluster.warnings = { warnings: [buildWarning()], normal: [], denied: [], failed: [] };
  await h.service.refresh();
  expect(h.service.getCommitData(SHA)?.normalEvents ?? []).toEqual([]);
});

/** A live list the test sets, and one live session run to its first list. */
function liveCluster(h: ReturnType<typeof harness>) {
  const pod = (name: string, uid: string): OpenShiftResource => ({
    id: `Pod:ns:${name}`,
    kind: "Pod",
    namespace: "ns",
    name,
    uid,
    status: "pass",
    imageRefs: [],
    commitSha: SHA,
  });
  const state = { pods: [] as OpenShiftResource[] };
  Object.assign(h.api, {
    fetchOpenShiftResources: mock(async () => ({
      resources: state.pods,
      controllers: [],
      error: null,
      failures: [],
      successfulRequests: 1,
      resourceVersions: new Map(),
    })),
    watchOpenShiftStream: mock(async () => "end"),
  });
  const liveOnce = async () => {
    const stop = new AbortController();
    const session = h.service.runWatchSession(stop.signal, h.lifecycle.getEpoch());
    await Bun.sleep(5);
    stop.abort();
    await session;
  };
  return { pod, state, liveOnce };
}

test("a Normal event about a pod that is gone stays, cached, while the cluster still lists it", async () => {
  const h = harness();
  const live = liveCluster(h);
  const killing = buildWarning({ id: "killing", kind: "Pod", name: "app-1-abcde", uid: "pod-1", reason: "Killing" });
  h.cluster.warnings = { warnings: [], normal: [killing], denied: [], failed: [] };
  live.state.pods = [live.pod("app-1-abcde", "pod-1")];
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  await live.liveOnce();
  expect(h.service.getCommitData(SHA)?.normalEvents?.map(e => e.id)).toEqual(["killing"]);
  // The pod was replaced; the namespace still lists the event.
  live.state.pods = [live.pod("app-1-fghij", "pod-2")];
  await live.liveOnce();
  expect(h.service.getCommitData(SHA)?.normalEvents?.map(e => e.id)).toEqual(["killing"]);
  expect(openShiftBadgeCounts(h.app.badges.get(SHA))).toMatchObject({ cachedEvents: 1 });
  // OpenShift deleted the event: it is gone, nothing keeps a Normal event.
  h.cluster.warnings = { warnings: [], normal: [], denied: [], failed: [] };
  await h.service.refresh();
  expect(h.service.getCommitData(SHA)?.normalEvents ?? []).toEqual([]);
});

test("a namespace whose event list failed keeps the warnings it listed before, to link once their pod shows", async () => {
  const h = harness();
  const live = liveCluster(h);
  const backOff = buildWarning({ id: "backoff", kind: "Pod", name: "app-1-abcde", uid: "pod-1", reason: "BackOff" });
  h.cluster.warnings = { warnings: [backOff], denied: [], failed: [] };
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  // No live list yet: nothing holds the pod, so the warning is not linked.
  expect(h.service.getCommitData(SHA)?.warnings ?? []).toEqual([]);
  h.cluster.warnings = { warnings: [], denied: [], failed: ["ns"] };
  await h.service.refresh();
  live.state.pods = [live.pod("app-1-abcde", "pod-1")];
  await live.liveOnce();
  expect(h.service.getCommitData(SHA)?.warnings?.map(e => e.id)).toEqual(["backoff"]);
});

test("a failing pod's status shows as the commit's failures and counts red; a build pod's warning is the build's", async () => {
  const h = harness();
  const live = liveCluster(h);
  const crashing: OpenShiftResource = {
    ...live.pod("app-1-abcde", "pod-1"),
    status: "fail",
    statusRows: [{ status: "waiting", reason: "CrashLoopBackOff", message: "back-off 5m0s" }],
  };
  // The pod the build ran in: no commit holds it, its label names the build.
  const buildPod: OpenShiftResource = {
    id: "Pod:ns:app-1-build",
    kind: "Pod",
    namespace: "ns",
    name: "app-1-build",
    uid: "build-pod",
    status: "pass",
    imageRefs: [],
    labels: { "openshift.io/build.name": "app-1" },
  };
  const mount = buildWarning({
    id: "mount",
    kind: "Pod",
    name: "app-1-build",
    uid: "build-pod",
    reason: "FailedMount",
  });
  h.cluster.warnings = { warnings: [mount], denied: [], failed: [] };
  live.state.pods = [crashing, buildPod];
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  await live.liveOnce();
  expect(h.service.getCommitData(SHA)?.failures?.map(f => [f.name, f.reason])).toEqual([
    ["app-1-abcde", "CrashLoopBackOff"],
  ]);
  expect(h.service.getCommitData(SHA)?.warnings?.map(w => w.id)).toEqual(["mount"]);
  // The build pod is in the cluster: not cached.
  expect(h.service.warningIsPresent(SHA, mount)).toBe(true);
  expect(openShiftBadgeCounts(h.app.badges.get(SHA))).toMatchObject({ failures: 1, warnings: 1 });
  expect(openShiftBadgeCounts(h.app.badges.get(SHA)).cachedEvents).toBeUndefined();
  // Fine again: no failure is kept.
  live.state.pods = [{ ...crashing, status: "pass", statusRows: undefined }, buildPod];
  await live.liveOnce();
  expect(h.service.getCommitData(SHA)?.failures ?? []).toEqual([]);
});
