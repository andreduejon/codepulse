/** The OpenShift service with its lifecycle, without Solid: the app is a plain object, the cluster and cache are fakes. */
import { expect, mock, test } from "bun:test";
import { FetchLifecycle } from "../fetch-lifecycle";
import type { GraphRow } from "../git/types";
import type { GraphBadge } from "../provider-model";
import type { ProviderStatus } from "../provider-status";
import { OPENSHIFT_BANNER } from "./banner";
import { commitDataFromCacheEntry } from "./commit-data";
import type { OpenShiftCacheEntry } from "./merge";
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
  const cache: OpenShiftCachePort = {
    read: async (_repo, sha) => saved.get(sha) ?? null,
    peekAll: async () => [...saved.values()],
    readLog: async () => null,
    writeLog: async () => {},
    mergeMany: async (_repo, items, merge) => {
      for (const item of items) saved.set(item.sha, merge(item.sha, saved.get(item.sha) ?? null, [...item.incoming]));
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
    saved,
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
  expect(h.app.badges.get(SHA)?.warningCount).toBe(2);
  // The pod was replaced by another one with the same commit.
  listed = liveList([pod("app-1-fghij", "pod-2")]);
  await liveOnce();
  expect(h.service.warningIsPresent(SHA, podWarning)).toBe(false);
  expect(h.service.warningIsPresent(SHA, buildWarning())).toBe(true);
  expect(h.service.getCommitData(SHA)?.warnings).toHaveLength(2);
  expect(h.app.badges.get(SHA)?.warningCount).toBe(1);
});
