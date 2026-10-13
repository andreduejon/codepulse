import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { createAppState } from "../../context/state";
import { buildGraph } from "../../git/graph";
import * as api from "./api";
import { OpenShiftCache } from "./cache";
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

function mountOpenShift(suspendedInitially = false) {
  const tokenEnvVar = "CODEPULSE_TEST_OPENSHIFT_TOKEN";
  const original = process.env[tokenEnvVar];
  process.env[tokenEnvVar] = "test-token";
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
  for (const mock of [cacheList, cacheRead, cacheWrite, logRead, logWrite, inventory, live, watch]) {
    cleanup.push(() => mock.mockRestore());
  }
  cleanup.push(() => {
    for (const watch of watches) watch.resolve("end");
  });
  let mounted!: {
    state: ReturnType<typeof createAppState>["state"];
    openShift: ReturnType<typeof useOpenShift>;
    setSuspended: (value: boolean) => void;
  };
  createRoot(dispose => {
    cleanup.push(dispose);
    const { state, actions } = createAppState();
    actions.setRepoPath("/repo");
    actions.setActiveProviderView("openshift");
    actions.setGraphRows(
      buildGraph([
        {
          hash: SHA,
          shortHash: SHA.slice(0, 7),
          parents: [],
          subject: "build",
          body: "",
          author: "Author",
          authorEmail: "author@example.com",
          authorDate: "2026-01-01T00:00:00Z",
          committer: "Author",
          committerEmail: "author@example.com",
          commitDate: "2026-01-01T00:00:00Z",
          refs: [],
        },
      ]),
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
      },
    });
    mounted = { state, openShift, setSuspended };
  });
  return { ...mounted, cacheList, cacheRead, cacheWrite, logRead, logWrite, inventory, live, watches };
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
    expect(mounted.cacheList).not.toHaveBeenCalled();
    expect(mounted.cacheRead).not.toHaveBeenCalled();
    expect(mounted.cacheWrite).not.toHaveBeenCalled();
    expect(mounted.inventory).not.toHaveBeenCalled();
    expect(mounted.live).not.toHaveBeenCalled();
    setSuspended(false);
    await Bun.sleep(0);
    expect(mounted.cacheList).toHaveBeenCalledTimes(1);
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
