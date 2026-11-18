/** The OpenShift service with its lifecycle, without Solid: the app is a plain object, the cluster and cache are fakes. */
import { expect, mock, test } from "bun:test";
import { BANNER } from "../banner";
import { FetchLifecycle } from "../fetch-lifecycle";
import type { GraphRow } from "../git/types";
import type { GraphBadge } from "../provider-model";
import type { ProviderStatus } from "../provider-status";
import { commitDataFromCacheEntry } from "./commit-data";
import type { OpenShiftCacheEntry } from "./merge";
import { createOpenShiftService, type OpenShiftApiPort, type OpenShiftCachePort } from "./service";
import type { OpenShiftResource } from "./types";
import { DEFAULT_OPENSHIFT_CONFIG } from "./types";

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
  const listed = commitDataFromCacheEntry({ sha: SHA, builds: [{ ...build, commitSha: SHA }] as never });
  const api = {
    fetchOpenShiftInventory: mock(async () => ({
      data: error ? new Map() : new Map([[SHA, listed]]),
      error,
      failure: error ? ("auth" as const) : undefined,
      failures: [],
      successfulRequests: error ? 0 : 1,
    })),
  };
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
  h.fail(BANNER.openshift.tokenExpired);
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.isFrozen()).toBe(true);
  expect(h.app.status).toEqual({ kind: "error", message: BANNER.openshift.tokenExpired });
  h.fail(null);
  const before = h.restarts.count;
  await h.service.refresh();
  expect(h.service.isFrozen()).toBe(false);
  expect(h.restarts.count).toBeGreaterThan(before);
  expect(h.service.getCommitData(SHA)?.namespaces[0]?.builds).toHaveLength(1);
});
