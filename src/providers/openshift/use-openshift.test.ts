import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { createAppState } from "../../context/state";
import { BANNER } from "../../debug/banner";
import { buildGraph } from "../../git/graph";
import * as api from "./api";
import { OpenShiftCache, type OpenShiftCacheEntry } from "./cache";
import type { OpenShiftCommitData, OpenShiftResource } from "./types";
import {
  commitDataFromCacheEntry,
  commitHasDigestSeed,
  mergeLiveIntoCommit,
  selectOpenShiftCandidateSHAs,
  useOpenShift,
} from "./use-openshift";

const SHA = "a".repeat(40);

const build: OpenShiftResource = {
  id: "Build:ns:app-1",
  kind: "Build",
  namespace: "ns",
  name: "app-1",
  status: "pass",
  imageRefs: ["sha256:abc"],
  commitSha: SHA,
};

const pod: OpenShiftResource = {
  id: "Pod:ns:app",
  kind: "Pod",
  namespace: "ns",
  name: "app",
  status: "running",
  imageRefs: ["sha256:abc"],
};

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const finish of cleanup.splice(0).reverse()) finish();
});

function mountOpenShift(
  suspendedInitially = false,
  withToken = true,
  options: {
    fetchDepth?: 10 | 20 | 50;
    older?: string[];
    cached?: OpenShiftCacheEntry[];
  } = {},
) {
  const tokenEnvVar = "CODEPULSE_TEST_OPENSHIFT_TOKEN";
  const original = process.env[tokenEnvVar];
  if (withToken) process.env[tokenEnvVar] = "test-token";
  else delete process.env[tokenEnvVar];
  cleanup.push(() => {
    if (original === undefined) delete process.env[tokenEnvVar];
    else process.env[tokenEnvVar] = original;
  });
  const entry = { sha: SHA, builds: [{ ...build, commitSha: SHA }] };
  const listed: api.OpenShiftListedInventory = {
    resources: [{ ...pod, commitSha: SHA }],
    controllers: [],
    failures: [],
    successfulRequests: 1,
    error: null,
    resourceVersions: new Map([["ns:Pod", "1"]]),
  };
  const cacheList = spyOn(OpenShiftCache.prototype, "list").mockResolvedValue([SHA]);
  const cacheRead = spyOn(OpenShiftCache.prototype, "read").mockResolvedValue(entry);
  const cachePeek = spyOn(OpenShiftCache.prototype, "peekAll").mockResolvedValue([entry, ...(options.cached ?? [])]);
  const cacheWrite = spyOn(OpenShiftCache.prototype, "write").mockResolvedValue(undefined);
  const logRead = spyOn(OpenShiftCache.prototype, "readLog").mockResolvedValue(null);
  const logWrite = spyOn(OpenShiftCache.prototype, "writeLog").mockResolvedValue(undefined);
  const inventory = spyOn(api, "fetchOpenShiftInventory").mockResolvedValue({
    data: new Map([[SHA, commitDataFromCacheEntry(entry)]]),
    error: null,
    failures: [],
    successfulRequests: 1,
  });
  const live = spyOn(api, "fetchOpenShiftResources").mockResolvedValue(listed);
  const watches: Array<{
    signal: AbortSignal;
    onEvent: Parameters<typeof api.watchOpenShiftStream>[5];
    resolve: (result: api.OpenShiftWatchResult) => void;
  }> = [];
  const watch = spyOn(api, "watchOpenShiftStream").mockImplementation(
    (...args) => new Promise(resolve => watches.push({ signal: args[4], onEvent: args[5], resolve })),
  );
  for (const mock of [cacheList, cacheRead, cachePeek, cacheWrite, logRead, logWrite, inventory, live, watch]) {
    cleanup.push(() => mock.mockRestore());
  }
  cleanup.push(() => {
    for (const watch of watches) watch.resolve("end");
  });
  let mounted!: {
    state: ReturnType<typeof createAppState>["state"];
    actions: ReturnType<typeof createAppState>["actions"];
    openShift: ReturnType<typeof useOpenShift>;
    setSuspended: (value: boolean) => void;
  };
  createRoot(dispose => {
    cleanup.push(dispose);
    const { state, actions } = createAppState();
    actions.setRepoPath("/repo");
    actions.setActiveProviderView("openshift");
    const hashes = [SHA, ...(options.older ?? [])];
    actions.setGraphRows(
      buildGraph(
        hashes.map((hash, index) => ({
          hash,
          shortHash: hash.slice(0, 7),
          parents: hashes[index + 1] ? [hashes[index + 1]] : [],
          subject: "build",
          body: "",
          author: "Author",
          authorEmail: "author@example.com",
          authorDate: "2026-01-01T00:00:00Z",
          committer: "Author",
          committerEmail: "author@example.com",
          commitDate: "2026-01-01T00:00:00Z",
          refs: [],
        })),
      ),
    );
    const [suspended, setSuspended] = createSignal(suspendedInitially);
    const openShift = useOpenShift({
      state,
      actions,
      suspended,
      config: {
        enabled: true,
        tokenEnvVar,
        serverUrl: "https://cluster.example",
        namespaces: ["ns"],
        autoRefreshSeconds: 0,
        ...(options.fetchDepth && { fetchDepth: options.fetchDepth }),
      },
    });
    mounted = { state, actions, openShift, setSuspended };
  });
  return { ...mounted, cacheList, cacheRead, cachePeek, cacheWrite, logRead, logWrite, inventory, live, watches };
}

describe("OpenShift suspension", () => {
  test("preserves memory and badges, stops watches/cache probes, and rejects old watch events after resume", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(0);
    const { openShift, state, setSuspended, watches } = mounted;
    expect(watches).toHaveLength(1);
    await openShift.fetchCommitDataForSHA(SHA);
    const memory = openShift.getCommitData(SHA);
    const badges = state.graphBadges();
    expect(memory?.namespaces[0].pods).toHaveLength(1);
    setSuspended(true);
    expect(watches[0].signal.aborted).toBe(true);
    expect(openShift.getCommitData(SHA)).toEqual(memory);
    expect(state.graphBadges()).toEqual(badges);
    expect(state.activeProviderView()).toBe("openshift");
    const probes = mounted.cacheRead.mock.calls.length;
    const requests = mounted.inventory.mock.calls.length;
    await openShift.refresh();
    await openShift.fetchCommitDataForSHA(SHA, true);
    expect(await openShift.loadBuildLog(build)).toBe("");
    expect(await openShift.loadPodLog(pod)).toBe("");
    expect(await openShift.loadResourceObject(build)).toBeNull();
    expect(mounted.cacheRead.mock.calls.length).toBe(probes);
    expect(mounted.logRead).not.toHaveBeenCalled();
    expect(mounted.inventory.mock.calls.length).toBe(requests);
    expect(mounted.live).toHaveBeenCalledTimes(1);

    setSuspended(false);
    await Bun.sleep(0);
    expect(watches).toHaveLength(2);
    watches[0].onEvent({ type: "DELETED", object: { kind: "Pod", metadata: { name: "app", namespace: "ns" } } });
    watches[0].resolve("end");
    await Bun.sleep(0);
    expect(openShift.getCommitData(SHA)?.namespaces[0].pods).toHaveLength(1);
    expect(openShift.liveAge()).toBe("live");
  });

  test("explicit invalidation while paused cannot hydrate or fetch until resume", async () => {
    const mounted = mountOpenShift(true);
    const { openShift, setSuspended } = mounted;
    openShift.invalidate();
    await openShift.refresh();
    await openShift.fetchCommitDataForSHA(SHA, true);
    await Bun.sleep(0);
    expect(mounted.cachePeek).not.toHaveBeenCalled();
    expect(mounted.cacheRead).not.toHaveBeenCalled();
    expect(mounted.cacheWrite).not.toHaveBeenCalled();
    expect(mounted.inventory).not.toHaveBeenCalled();
    expect(mounted.live).not.toHaveBeenCalled();
    setSuspended(false);
    await Bun.sleep(0);
    expect(mounted.cachePeek).toHaveBeenCalledTimes(1);
    expect(mounted.inventory).toHaveBeenCalledTimes(1);
    expect(openShift.getCommitData(SHA)).not.toBeNull();
  });

  test("a pre-suspension log completion cannot write cache after resume", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(0);
    let resolve!: (value: string) => void;
    let signal: AbortSignal | undefined;
    const log = spyOn(api, "fetchOpenShiftBuildLog").mockImplementation(
      (_server, _token, _ns, _name, requestSignal) => {
        signal = requestSignal;
        return new Promise(settle => {
          resolve = settle;
        });
      },
    );
    cleanup.push(() => log.mockRestore());
    const pending = mounted.openShift.loadBuildLog(build, true);
    mounted.setSuspended(true);
    expect(signal?.aborted).toBe(true);
    mounted.setSuspended(false);
    resolve("old log");
    expect(await pending).toBe("");
    expect(mounted.logWrite).not.toHaveBeenCalled();
  });

  test("a late inventory response cannot publish or persist after resume", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(0);
    let resolve!: (value: Awaited<ReturnType<typeof api.fetchOpenShiftInventory>>) => void;
    mounted.inventory.mockImplementationOnce(
      () =>
        new Promise(settle => {
          resolve = settle;
        }),
    );
    const pending = mounted.openShift.refresh();
    await Bun.sleep(0);
    mounted.setSuspended(true);
    mounted.setSuspended(false);
    await Bun.sleep(0);
    const writes = mounted.cacheWrite.mock.calls.length;
    const watches = mounted.live.mock.calls.length;
    resolve({
      data: new Map([
        [SHA, commitDataFromCacheEntry({ sha: SHA, builds: [{ ...build, commitSha: SHA, status: "fail" }] })],
      ]),
      error: null,
      failures: [],
      successfulRequests: 1,
    });
    await pending;
    expect(mounted.openShift.getCommitData(SHA)?.namespaces[0].builds[0].status).toBe("pass");
    expect(mounted.cacheWrite.mock.calls.length).toBe(writes);
    expect(mounted.live.mock.calls.length).toBe(watches);
  });
});

describe("OpenShift cache below the fetch depth", () => {
  test("cached builds of older commits show in the graph and stay through a refresh", async () => {
    // Ten newer commits fill the fetch depth of 10; the cached one sits below it.
    const newer = Array.from({ length: 9 }, (_, i) => String(i + 1).repeat(40));
    const older = "b".repeat(40);
    const olderBuild = { ...build, id: "Build:ns:app-0", name: "app-0", commitSha: older };
    const mounted = mountOpenShift(false, true, {
      fetchDepth: 10,
      older: [...newer, older],
      cached: [{ sha: older, builds: [olderBuild] }],
    });
    const settle = async () => {
      for (let i = 0; i < 100 && !mounted.state.graphBadges().has(older); i++) await Bun.sleep(5);
    };
    await settle();
    expect(mounted.state.graphBadges().has(older)).toBe(true);
    expect(mounted.openShift.getCommitData(older)?.namespaces[0].builds.map(b => b.name)).toEqual(["app-0"]);
    // Shown, not read: showing an older commit does not count as a use for eviction.
    expect(mounted.cacheRead.mock.calls.some(call => call[1] === older)).toBe(false);
    // The build inventory covers only the window; a refresh keeps the older commit.
    await mounted.openShift.refresh();
    await Bun.sleep(5);
    expect(mounted.state.graphBadges().has(older)).toBe(true);
    expect(mounted.openShift.getCommitData(older)?.namespaces[0].builds.map(b => b.name)).toEqual(["app-0"]);
  });
});

describe("OpenShift cache below the fetch depth, saving", () => {
  test("a refresh does not save cached older commits again; one the user opened is saved like before", async () => {
    const newer = Array.from({ length: 9 }, (_, i) => String(i + 1).repeat(40));
    const older = "b".repeat(40);
    const olderBuild = { ...build, id: "Build:ns:app-0", name: "app-0", commitSha: older };
    const mounted = mountOpenShift(false, true, {
      fetchDepth: 10,
      older: [...newer, older],
      cached: [{ sha: older, builds: [olderBuild] }],
    });
    // The cluster still lists the older commit's Build: the inventory returns it beside the window's.
    mounted.inventory.mockResolvedValue({
      data: new Map([
        [SHA, commitDataFromCacheEntry({ sha: SHA, builds: [{ ...build, commitSha: SHA }] })],
        [older, commitDataFromCacheEntry({ sha: older, builds: [olderBuild] })],
      ]),
      error: null,
      failures: [],
      successfulRequests: 1,
    });
    for (let i = 0; i < 100 && !mounted.state.graphBadges().has(older); i++) await Bun.sleep(5);
    const savedOlder = () => mounted.cacheWrite.mock.calls.some(call => call[1].sha === older);
    await mounted.openShift.refresh();
    await Bun.sleep(5);
    // Only shown: saving it again on every refresh would mark it as used.
    expect(savedOlder()).toBe(false);
    await mounted.openShift.fetchCommitDataForSHA(older);
    await mounted.openShift.refresh();
    await Bun.sleep(5);
    expect(savedOlder()).toBe(true);
  });
});

describe("OpenShift live list failures", () => {
  const failedList = (successfulRequests: number, error: string): api.OpenShiftListedInventory => ({
    resources: [],
    controllers: [],
    failures: [{ namespace: "ns", kind: "Pod", path: "/api/v1/namespaces/ns/pods", error: "boom" }],
    successfulRequests,
    error,
    resourceVersions: new Map(),
  });
  const pods = (mounted: ReturnType<typeof mountOpenShift>) =>
    mounted.openShift.getCommitData(SHA)?.namespaces[0]?.pods ?? [];

  test("a live list where every request failed keeps the visible workloads and reports the error", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(0);
    await mounted.openShift.fetchCommitDataForSHA(SHA);
    expect(pods(mounted)).toHaveLength(1);
    mounted.live.mockResolvedValueOnce(failedList(0, BANNER.openshift.inventoryFailed));
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    for (let i = 0; i < 20 && mounted.state.providerStatusFor("openshift").kind !== "error"; i++) await Bun.sleep(5);
    expect(mounted.state.providerStatusFor("openshift")).toEqual({
      kind: "error",
      message: BANNER.openshift.inventoryFailed,
    });
    expect(pods(mounted)).toHaveLength(1);
  });

  test("a partially failed live list keeps the failed kind's workloads and shows a warning", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(0);
    await mounted.openShift.fetchCommitDataForSHA(SHA);
    expect(pods(mounted)).toHaveLength(1);
    mounted.live.mockResolvedValueOnce(failedList(2, BANNER.openshift.inventoryPartial));
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    for (let i = 0; i < 20 && mounted.state.providerStatusFor("openshift").kind !== "warning"; i++) await Bun.sleep(5);
    expect(mounted.state.providerStatusFor("openshift")).toEqual({
      kind: "warning",
      message: BANNER.openshift.inventoryPartial,
    });
    expect(pods(mounted)).toHaveLength(1);
  });
});

describe("OpenShift live list recovery", () => {
  test("a later successful live list clears the warning its own partial failure set", async () => {
    const mounted = mountOpenShift();
    // Let the mount's build inventory settle first, so only live lists change the status below.
    await Bun.sleep(30);
    await mounted.openShift.fetchCommitDataForSHA(SHA);
    mounted.live.mockResolvedValueOnce({
      resources: [],
      controllers: [],
      failures: [{ namespace: "ns", kind: "Pod", path: "/api/v1/namespaces/ns/pods", error: "boom" }],
      successfulRequests: 2,
      error: BANNER.openshift.inventoryPartial,
      resourceVersions: new Map(),
    });
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    for (let i = 0; i < 20 && mounted.state.providerStatusFor("openshift").kind !== "warning"; i++) await Bun.sleep(5);
    expect(mounted.state.providerStatusFor("openshift").kind).toBe("warning");
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    await Bun.sleep(30);
    expect(mounted.state.providerStatusFor("openshift").kind).toBe("idle");
  });

  test("a successful live list does not clear an error from the build inventory", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(30);
    // Reload: the inventory fails, then the live list (restarted by the same reload) succeeds.
    mounted.inventory.mockResolvedValueOnce({
      data: new Map(),
      error: BANNER.openshift.inventoryFailed,
      failures: [],
      successfulRequests: 0,
    });
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    await Bun.sleep(40);
    expect(mounted.live.mock.calls.length).toBeGreaterThan(1);
    expect(mounted.state.providerStatusFor("openshift")).toEqual({
      kind: "error",
      message: BANNER.openshift.inventoryFailed,
    });
  });
});

describe("OpenShift expired token", () => {
  test("a 401 stops automatic live requests until Reload commit retries", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(0);
    const expired: api.OpenShiftListedInventory = {
      resources: [],
      controllers: [],
      failures: [],
      successfulRequests: 0,
      error: BANNER.openshift.tokenExpired,
      resourceVersions: new Map(),
    };
    mounted.live.mockResolvedValueOnce(expired);
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    for (let i = 0; i < 20 && mounted.state.providerStatusFor("openshift").kind !== "error"; i++) await Bun.sleep(5);
    expect(mounted.state.providerStatusFor("openshift").kind).toBe("error");
    const calls = mounted.live.mock.calls.length;
    // Leaving and re-entering the view is automatic: no new live list while frozen.
    mounted.actions.setActiveProviderView("git");
    mounted.actions.setActiveProviderView("openshift");
    await Bun.sleep(10);
    expect(mounted.live.mock.calls.length).toBe(calls);
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    for (let i = 0; i < 20 && mounted.live.mock.calls.length === calls; i++) await Bun.sleep(5);
    expect(mounted.live.mock.calls.length).toBe(calls + 1);
  });
});

describe("OpenShift without setup", () => {
  test("a forced Reload without a token does not look busy forever", async () => {
    const mounted = mountOpenShift(false, false);
    await Bun.sleep(0);
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    await Bun.sleep(10);
    expect(mounted.openShift.isLoading(SHA)).toBe(false);
    expect(mounted.state.providers.get("openshift")?.activity?.() ?? null).toBeNull();
  });
});

describe("OpenShift auth recovery", () => {
  const expiredList: api.OpenShiftListedInventory = {
    resources: [],
    controllers: [],
    failures: [],
    successfulRequests: 0,
    error: BANNER.openshift.tokenExpired,
    resourceVersions: new Map(),
  };

  test("Reload commit after a live 401 also reloads the build inventory and clears the expired banner", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(30);
    mounted.live.mockResolvedValueOnce(expiredList);
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    for (let i = 0; i < 20 && mounted.state.providerStatusFor("openshift").kind !== "error"; i++) await Bun.sleep(5);
    expect(mounted.state.providerStatusFor("openshift").kind).toBe("error");
    const inventoryCalls = mounted.inventory.mock.calls.length;
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    await Bun.sleep(40);
    expect(mounted.inventory.mock.calls.length).toBeGreaterThan(inventoryCalls);
    expect(mounted.state.providerStatusFor("openshift").kind).toBe("idle");
  });

  test("a 401 from the first build inventory also stops the live watches that started beside it", async () => {
    const mounted = mountOpenShift();
    // The view-entry inventory reaches the API after reading the disk cache, so this answer is the first one.
    mounted.inventory.mockResolvedValueOnce({
      data: new Map(),
      error: BANNER.openshift.tokenExpired,
      failures: [],
      successfulRequests: 0,
    });
    await Bun.sleep(40);
    expect(mounted.state.providerStatusFor("openshift")).toEqual({
      kind: "error",
      message: BANNER.openshift.tokenExpired,
    });
    expect(mounted.watches.length).toBeGreaterThan(0);
    expect(mounted.watches.every(watch => watch.signal.aborted)).toBe(true);
  });

  test("a recovered live list does not clear an inventory error that happens to use the same words", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(30);
    // 1. The live list fails with inventoryFailed: that status is the live list's own.
    mounted.live.mockResolvedValueOnce({ ...expiredList, error: BANNER.openshift.inventoryFailed });
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    await Bun.sleep(40);
    // 2. Reload: the inventory fails with the same words, then the live list recovers.
    mounted.inventory.mockResolvedValueOnce({
      data: new Map(),
      error: BANNER.openshift.inventoryFailed,
      failures: [],
      successfulRequests: 0,
    });
    await mounted.openShift.fetchCommitDataForSHA(SHA, true);
    await Bun.sleep(40);
    expect(mounted.state.providerStatusFor("openshift")).toEqual({
      kind: "error",
      message: BANNER.openshift.inventoryFailed,
    });
  });
});

describe("OpenShift auth recovery across inventory and live list", () => {
  const expiredList: api.OpenShiftListedInventory = {
    resources: [],
    controllers: [],
    failures: [],
    successfulRequests: 0,
    error: BANNER.openshift.tokenExpired,
    resourceVersions: new Map(),
  };
  const fine = { data: new Map(), error: null, failures: [], successfulRequests: 1 };

  test("a build inventory that succeeds after a live 401 keeps the expired-token banner", async () => {
    const mounted = mountOpenShift();
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    mounted.inventory.mockImplementationOnce(async () => {
      await gate;
      return fine;
    });
    await Bun.sleep(30);
    expect(mounted.watches.length).toBeGreaterThan(0);
    // The live watches hit a 401 while the first inventory is still out.
    for (const watch of mounted.watches) watch.resolve("auth");
    await Bun.sleep(10);
    expect(mounted.state.providerStatusFor("openshift")).toEqual({
      kind: "error",
      message: BANNER.openshift.tokenExpired,
    });
    release();
    await Bun.sleep(30);
    // Live requests stay frozen, so the banner must stay until a retry.
    expect(mounted.state.providerStatusFor("openshift")).toEqual({
      kind: "error",
      message: BANNER.openshift.tokenExpired,
    });
  });

  test("a Reload that the queue merges into a waiting first fetch still restarts the stopped live list", async () => {
    const mounted = mountOpenShift();
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    mounted.inventory.mockImplementationOnce(async () => {
      await gate;
      return fine;
    });
    await Bun.sleep(30);
    // Leave and come back while the first inventory is out: the view entry queues another first fetch, and the
    // live list it restarts answers 401.
    mounted.live.mockResolvedValueOnce(expiredList);
    mounted.actions.setActiveProviderView("git");
    mounted.actions.setActiveProviderView("openshift");
    await Bun.sleep(20);
    expect(mounted.state.providerStatusFor("openshift").kind).toBe("error");
    const liveCalls = mounted.live.mock.calls.length;
    const reload = mounted.openShift.fetchCommitDataForSHA(SHA, true);
    release();
    await reload;
    await Bun.sleep(40);
    expect(mounted.live.mock.calls.length).toBeGreaterThan(liveCalls);
    expect(mounted.openShift.liveAge()).toBe("live");
  });
});

describe("OpenShift object refresh", () => {
  test("a forced object load asks the API instead of returning the embedded snapshot", async () => {
    const mounted = mountOpenShift();
    await Bun.sleep(30);
    const fetchObject = spyOn(api, "fetchOpenShiftObject").mockResolvedValue({ fresh: true });
    cleanup.push(() => fetchObject.mockRestore());
    const resource = { ...pod, object: { old: true } };
    expect(await mounted.openShift.loadResourceObject(resource)).toEqual({ old: true });
    expect(fetchObject).not.toHaveBeenCalled();
    expect(await mounted.openShift.loadResourceObject(resource, true)).toEqual({ fresh: true });
    expect(fetchObject).toHaveBeenCalledTimes(1);
  });
});

describe("selectOpenShiftCandidateSHAs", () => {
  test("keeps only annotated SHAs that sit in the graph window", () => {
    const graph = ["aa".repeat(20), "bb".repeat(20), "cc".repeat(20)];
    const annotated = ["BB".repeat(20), "dd".repeat(20)];
    expect([...selectOpenShiftCandidateSHAs(graph, annotated)]).toEqual(["bb".repeat(20)]);
  });

  test("includes a selected annotated SHA outside the window", () => {
    const selected = "dd".repeat(20);
    const out = selectOpenShiftCandidateSHAs(["aa".repeat(20)], ["dd".repeat(20)], selected);
    expect(out.has(selected)).toBe(true);
  });

  test("ignores a selected SHA with no OpenShift build", () => {
    expect(selectOpenShiftCandidateSHAs(["aa".repeat(20)], [], "dd".repeat(20)).size).toBe(0);
  });
});

describe("commitHasDigestSeed", () => {
  test("is false when only a tag ref exists", () => {
    expect(
      commitHasDigestSeed({
        sha: SHA,
        liveFetched: false,
        namespaces: [
          {
            namespace: "ns",
            builds: [{ ...build, imageRefs: ["image-registry/ns/app:latest"] }],
            imageStreamTags: [],
            deployments: [],
            deploymentConfigs: [],
            pods: [],
          },
        ],
      }),
    ).toBe(false);
  });

  test("is true when an IST carries a digest", () => {
    expect(
      commitHasDigestSeed({
        sha: SHA,
        liveFetched: false,
        namespaces: [
          {
            namespace: "ns",
            builds: [build],
            imageStreamTags: [
              { ...build, kind: "ImageStreamTag", id: "ImageStreamTag:ns:app:latest", name: "app:latest" },
            ],
            deployments: [],
            deploymentConfigs: [],
            pods: [],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("OpenShift commit merge", () => {
  test("hydrates cached builds and keeps the API object", () => {
    const object = { kind: "Build", metadata: { name: build.name } };
    const data = commitDataFromCacheEntry({
      sha: SHA,
      builds: [
        {
          id: build.id,
          name: build.name,
          namespace: build.namespace,
          status: "pass",
          imageRefs: build.imageRefs,
          commitSha: SHA,
          object,
        },
      ],
    });
    expect(data.namespaces[0].builds[0].kind).toBe("Build");
    expect(data.namespaces[0].builds[0].object).toEqual(object);
    expect(data.namespaces[0].pods).toEqual([]);
  });

  test("keeps cached builds and overlays live pods", () => {
    const cached: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: true,
      namespaces: [
        {
          namespace: "ns",
          builds: [build],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [],
        },
      ],
    };
    const live: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: true,
      namespaces: [
        {
          namespace: "ns",
          builds: [],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [pod],
        },
      ],
    };
    const merged = mergeLiveIntoCommit(cached, live, SHA);
    expect(merged.namespaces[0].builds).toEqual([build]);
    expect(merged.namespaces[0].pods).toEqual([pod]);
  });

  test("unions cache-only builds with live builds", () => {
    const older: OpenShiftResource = { ...build, id: "Build:ns:app-0", name: "app-0" };
    const cached: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: false,
      namespaces: [
        {
          namespace: "ns",
          builds: [older],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [],
        },
      ],
    };
    const live: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: false,
      namespaces: [
        {
          namespace: "ns",
          builds: [build],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [],
        },
      ],
    };
    const merged = mergeLiveIntoCommit(live, cached, SHA);
    expect(merged.namespaces[0].builds.map(item => item.id).sort()).toEqual([older.id, build.id].sort());
  });

  test("drops ImageStreamTags when a live overlay has none", () => {
    const ist: OpenShiftResource = {
      ...build,
      kind: "ImageStreamTag",
      id: "ImageStreamTag:ns:app:latest",
      name: "app:latest",
    };
    const cached: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: false,
      namespaces: [
        {
          namespace: "ns",
          builds: [build],
          imageStreamTags: [ist],
          deployments: [],
          deploymentConfigs: [],
          pods: [],
        },
      ],
    };
    const live: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: true,
      namespaces: [
        {
          namespace: "ns",
          builds: [],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [pod],
        },
      ],
    };
    const merged = mergeLiveIntoCommit(cached, live, SHA, true);
    expect(merged.namespaces[0].imageStreamTags).toEqual([]);
    expect(merged.namespaces[0].builds).toEqual([build]);
    expect(merged.namespaces[0].pods).toEqual([pod]);
  });

  test("keeps seed ImageStreamTags when overlay is not a live fetch", () => {
    const ist: OpenShiftResource = {
      ...build,
      kind: "ImageStreamTag",
      id: "ImageStreamTag:ns:app:latest",
      name: "app:latest",
    };
    const seeds: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: false,
      namespaces: [
        {
          namespace: "ns",
          builds: [build],
          imageStreamTags: [ist],
          deployments: [],
          deploymentConfigs: [],
          pods: [],
        },
      ],
    };
    const previous: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: true,
      namespaces: [
        {
          namespace: "ns",
          builds: [build],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [pod],
        },
      ],
    };
    expect(mergeLiveIntoCommit(seeds, previous, SHA).namespaces[0].imageStreamTags).toEqual([ist]);
  });

  test("clears live pods and deploys when a later live overlay omits that SHA", () => {
    const cached: OpenShiftCommitData = {
      sha: SHA,
      liveFetched: true,
      namespaces: [
        {
          namespace: "ns",
          builds: [build],
          imageStreamTags: [],
          deployments: [],
          deploymentConfigs: [],
          pods: [pod],
        },
      ],
    };
    const merged = mergeLiveIntoCommit(cached, undefined, SHA, true);
    expect(merged.namespaces[0].builds).toEqual([build]);
    expect(merged.namespaces[0].pods).toEqual([]);
    expect(merged.namespaces[0].deployments).toEqual([]);
  });

  test("build snapshot stays not liveFetched until live merge", () => {
    const cached = commitDataFromCacheEntry({
      sha: SHA,
      builds: [
        {
          id: build.id,
          name: build.name,
          namespace: build.namespace,
          status: "pass",
          imageRefs: build.imageRefs,
          commitSha: SHA,
        },
      ],
    });
    expect(cached.liveFetched).toBe(false);
    expect(mergeLiveIntoCommit(cached, undefined, SHA).liveFetched).toBe(false);
    expect(mergeLiveIntoCommit(cached, undefined, SHA, true).liveFetched).toBe(true);
  });
});
