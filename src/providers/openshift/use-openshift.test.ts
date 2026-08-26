import { describe, expect, test } from "bun:test";
import {
  commitDataFromCacheEntry,
  commitHasDigestSeed,
  mergeLiveIntoCommit,
  selectOpenShiftCandidateSHAs,
} from "./use-openshift";
import type { OpenShiftCommitData, OpenShiftResource } from "./types";

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
            imageStreamTags: [{ ...build, kind: "ImageStreamTag", id: "ImageStreamTag:ns:app:latest", name: "app:latest" }],
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
  test("hydrates cached builds without raw payloads", () => {
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
        },
      ],
    });
    expect(data.namespaces[0].builds[0].kind).toBe("Build");
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

  test("keeps seed ImageStreamTags when live overlay has none", () => {
    const ist: OpenShiftResource = { ...build, kind: "ImageStreamTag", id: "ImageStreamTag:ns:app:latest", name: "app:latest" };
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
    expect(mergeLiveIntoCommit(cached, live, SHA, true).namespaces[0].imageStreamTags).toEqual([ist]);
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
