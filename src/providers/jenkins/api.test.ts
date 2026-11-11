import { describe, expect, test } from "bun:test";
import { BANNER } from "../../debug/banner";
import { clearDebugEvents, getDebugEvents } from "../../debug/events";
import {
  buildJenkinsCommitDataMap,
  buildJenkinsGraphBadges,
  deriveJenkinsJobLabel,
  extractCandidateShas,
  extractHeadShas,
  extractSha,
  fetchJenkinsConsoleLog,
  fetchJenkinsDataForSHAs,
  fetchJenkinsGraphDataForSHAs,
  fetchJenkinsRunJobs,
  fetchJenkinsRunsForBuilds,
  jenkinsApiUrl,
  mapStatus,
  normalizeJenkinsJobUrl,
  resolveJenkinsJobs,
} from "./api";
import type { JenkinsRun } from "./types";
import { isSafeJenkinsRequestUrl, isValidJenkinsJobUrl } from "./validation";

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

describe("normalizeJenkinsJobUrl", () => {
  test("strips trailing slashes", () => {
    expect(normalizeJenkinsJobUrl("https://jenkins.example.com/job/foo///")).toBe(
      "https://jenkins.example.com/job/foo",
    );
  });
  test("no-op on clean URL", () => {
    expect(normalizeJenkinsJobUrl("https://jenkins.example.com/job/foo")).toBe("https://jenkins.example.com/job/foo");
  });
  test("trims whitespace", () => {
    expect(normalizeJenkinsJobUrl("  https://jenkins.example.com/job/foo  ")).toBe(
      "https://jenkins.example.com/job/foo",
    );
  });
});

describe("isValidJenkinsJobUrl", () => {
  test("accepts HTTPS job URLs", () => {
    expect(isValidJenkinsJobUrl("https://jenkins.example.com/job/foo")).toBe(true);
  });
  test("rejects HTTP, credentials, query, and hash", () => {
    expect(isValidJenkinsJobUrl("http://jenkins.example.com/job/foo")).toBe(false);
    expect(isValidJenkinsJobUrl("https://user:token@jenkins.example.com/job/foo")).toBe(false);
    expect(isValidJenkinsJobUrl("https://jenkins.example.com/job/foo?tree=builds")).toBe(false);
    expect(isValidJenkinsJobUrl("https://jenkins.example.com/job/foo#console")).toBe(false);
  });
});

describe("isSafeJenkinsRequestUrl", () => {
  test("allows HTTPS tree query without credentials", () => {
    expect(isSafeJenkinsRequestUrl("https://jenkins.example.com/job/foo/api/json?tree=builds")).toBe(true);
    expect(isSafeJenkinsRequestUrl("http://jenkins.example.com/job/foo/api/json")).toBe(false);
    expect(isSafeJenkinsRequestUrl("https://user:token@jenkins.example.com/job/foo/api/json")).toBe(false);
  });
});

describe("jenkinsApiUrl", () => {
  test("appends suffix with separator", () => {
    expect(jenkinsApiUrl("https://jenkins.example.com/job/foo", "api/json")).toBe(
      "https://jenkins.example.com/job/foo/api/json",
    );
  });
  test("leading slash in suffix is stripped", () => {
    expect(jenkinsApiUrl("https://jenkins.example.com/job/foo", "/api/json")).toBe(
      "https://jenkins.example.com/job/foo/api/json",
    );
  });
  test("trailing slash in job URL is stripped before appending", () => {
    expect(jenkinsApiUrl("https://jenkins.example.com/job/foo/", "wfapi/describe")).toBe(
      "https://jenkins.example.com/job/foo/wfapi/describe",
    );
  });
});

// ---------------------------------------------------------------------------
// deriveJenkinsJobLabel
// ---------------------------------------------------------------------------

describe("deriveJenkinsJobLabel", () => {
  test("uses explicit label when provided", () => {
    expect(deriveJenkinsJobLabel({ label: "My Pipeline", url: "https://x/job/foo" })).toBe("My Pipeline");
  });
  test("derives from last URL segment", () => {
    expect(deriveJenkinsJobLabel({ url: "https://jenkins.example.com/job/develop/" })).toBe("develop");
  });
  test("URL-decodes segment", () => {
    expect(deriveJenkinsJobLabel({ url: "https://jenkins.example.com/job/my%20job" })).toBe("my job");
  });
});

// ---------------------------------------------------------------------------
// extractSha
// ---------------------------------------------------------------------------

describe("extractSha", () => {
  test("finds commitId in changeSets.items", () => {
    const raw = {
      changeSets: [{ items: [{ commitId: "abc1234567890123456789012345678901234567" }] }],
    };
    expect(extractSha(raw)).toBe("abc1234567890123456789012345678901234567");
  });

  test("finds fallback id in changeSets.items when commitId absent", () => {
    const raw = { changeSets: [{ items: [{ id: "def1234567890123456789012345678901234567" }] }] };
    expect(extractSha(raw)).toBe("def1234567890123456789012345678901234567");
  });

  test("finds SHA1 in nested actions", () => {
    const raw = {
      actions: [{ lastBuiltRevision: { SHA1: "aabbccdd11223344556677889900aabbccdd1122" } }],
    };
    expect(extractSha(raw)).toBe("aabbccdd11223344556677889900aabbccdd1122");
  });

  test("returns null for empty object", () => {
    expect(extractSha({})).toBeNull();
  });

  test("returns null for non-object", () => {
    expect(extractSha(null)).toBeNull();
    expect(extractSha(42)).toBeNull();
  });

  test("rejects short strings (< 7 hex chars)", () => {
    expect(extractSha({ commitId: "abc12" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractCandidateShas
// ---------------------------------------------------------------------------

describe("extractCandidateShas", () => {
  test("collects multiple SHAs from nested structure", () => {
    const raw = {
      actions: [
        { lastBuiltRevision: { SHA1: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111" } },
        { scmRevisionAction: { revision: [{ hash: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222" }] } },
      ],
    };
    const shas = extractCandidateShas(raw);
    expect(shas).toContain("aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111");
    expect(shas).toContain("bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222");
  });
});

describe("extractHeadShas", () => {
  test("collects head SHAs but ignores change sets", () => {
    const raw = {
      actions: [{ lastBuiltRevision: { SHA1: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111" } }],
      changeSets: [{ items: [{ commitId: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222" }] }],
    };
    expect(extractHeadShas(raw)).toEqual(["aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111"]);
  });
});

// ---------------------------------------------------------------------------
// buildJenkinsCommitDataMap
// ---------------------------------------------------------------------------

function makeRun(sha: string, id: string, updatedAt = "2026-01-01T00:00:00Z"): JenkinsRun {
  return {
    id,
    name: "build",
    status: "completed",
    conclusion: "success",
    headSha: sha,
    runNumber: 1,
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt,
    url: `https://jenkins.example.com/job/foo/${id}`,
    jobLabel: "foo",
    jobUrl: "https://jenkins.example.com/job/foo",
  };
}

describe("buildJenkinsCommitDataMap", () => {
  test("groups runs by sha", () => {
    const runs = [makeRun("sha1", "1"), makeRun("sha1", "2"), makeRun("sha2", "3")];
    const map = buildJenkinsCommitDataMap(runs, true);
    expect(map.size).toBe(2);
    expect(map.get("sha1")?.runs.length).toBe(2);
    expect(map.get("sha2")?.runs.length).toBe(1);
  });
  test("sets resolved flag", () => {
    const map = buildJenkinsCommitDataMap([makeRun("sha1", "1")], false);
    expect(map.get("sha1")?.resolved).toBe(false);
  });
  test("sorts runs by updatedAt descending", () => {
    const runs = [makeRun("sha1", "1", "2026-01-01T00:00:00Z"), makeRun("sha1", "2", "2026-01-02T00:00:00Z")];
    const map = buildJenkinsCommitDataMap(runs, true);
    const sorted = map.get("sha1")?.runs ?? [];
    expect(sorted[0].id).toBe("2");
    expect(sorted[1].id).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// buildJenkinsGraphBadges
// ---------------------------------------------------------------------------

describe("buildJenkinsGraphBadges", () => {
  test("pass badge when all success", () => {
    const runs = [makeRun("sha1", "1"), makeRun("sha1", "2")];
    const map = buildJenkinsGraphBadges(runs);
    expect(map.get("sha1")?.badge).toBe("pass");
  });
  test("fail badge when any failure", () => {
    const runs = [makeRun("sha1", "1"), { ...makeRun("sha1", "2"), conclusion: "failure" }];
    const map = buildJenkinsGraphBadges(runs);
    expect(map.get("sha1")?.badge).toBe("fail");
  });
  test("running badge when in progress, no failures", () => {
    const run = { ...makeRun("sha1", "1"), status: "running", conclusion: null };
    const map = buildJenkinsGraphBadges([run]);
    expect(map.get("sha1")?.badge).toBe("running");
  });
  test("pass and fail counts are correct", () => {
    const runs = [makeRun("sha1", "1"), { ...makeRun("sha1", "2"), conclusion: "failure" }, makeRun("sha1", "3")];
    const map = buildJenkinsGraphBadges(runs);
    const badge = map.get("sha1") ?? { passCount: -1, failCount: -1 };
    expect(badge.passCount).toBe(2);
    expect(badge.failCount).toBe(1);
  });
  test("cancelled and skipped builds count as neutral, so a cancelled-only commit still shows a chip", () => {
    const runs = [
      { ...makeRun("sha1", "1"), conclusion: "cancelled" },
      { ...makeRun("sha1", "2"), conclusion: "skipped" },
    ];
    const badge = buildJenkinsGraphBadges(runs).get("sha1");
    expect(badge?.unknownCount).toBe(2);
    expect(badge?.badge).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Jenkins fetch behavior
// ---------------------------------------------------------------------------

describe("Jenkins request cancellation", () => {
  test.each(["discovery", "full build fetch", "branch build list", "graph probe", "running build refresh"])(
    "rejects mid-request abort during %s without debug errors",
    async path => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();
      const reason = new Error("request cancelled");
      const job = { url: "https://jenkins.example.com/job/foo" };
      const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const abortRequest = path === "discovery" || path === "running build refresh" ? 1 : 2;
      let calls = 0;
      clearDebugEvents();
      globalThis.fetch = (async (_input, init) => {
        if (++calls < abortRequest) {
          return Response.json(
            path === "branch build list"
              ? {
                  _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
                  jobs: [
                    {
                      _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
                      url: `${job.url}/job/main/`,
                      buildable: true,
                    },
                  ],
                }
              : { lastBuild: { number: 2 }, builds: [{ number: 2 }] },
          );
        }
        const signal = init?.signal;
        expect(signal).toBeDefined();
        expect(signal?.aborted).toBe(false);
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          queueMicrotask(() => controller.abort(reason));
        });
      }) as typeof fetch;

      try {
        const signal = controller.signal;
        const request =
          path === "discovery"
            ? resolveJenkinsJobs([job], "user", "token", signal)
            : path === "running build refresh"
              ? fetchJenkinsRunsForBuilds(
                  [{ ...makeRun(sha, "2"), status: "running", conclusion: null }],
                  "user",
                  "token",
                  signal,
                )
              : path === "graph probe"
                ? fetchJenkinsGraphDataForSHAs([job], "user", "token", [sha], {
                    signal,
                    knownLastBuilds: new Map([[job.url, 1]]),
                  })
                : fetchJenkinsDataForSHAs([job], "user", "token", [sha], { signal });
        await expect(request).rejects.toBe(reason);
        expect(calls).toBe(abortRequest);
        expect(getDebugEvents().filter(event => event.source === "error" || event.status === "error")).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
        clearDebugEvents();
      }
    },
  );
});

describe("fetchJenkinsGraphDataForSHAs", () => {
  test("sends Basic auth header and maps matching build", async () => {
    const originalFetch = globalThis.fetch;
    const calls: (RequestInfo | URL)[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push(input);
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe("Basic dXNlcjp0b2tlbg==");
      return new Response(
        JSON.stringify({
          builds: [
            {
              number: 12,
              url: "https://jenkins.example.com/job/foo/12/",
              result: "SUCCESS",
              building: false,
              timestamp: 1_700_000_000_000,
              duration: 12_000,
              actions: [{ lastBuiltRevision: { SHA1: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await fetchJenkinsGraphDataForSHAs(
        [{ url: "https://jenkins.example.com/job/foo/" }],
        "user",
        "token",
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      );
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].runNumber).toBe(12);
      expect(calls[0].toString()).toContain("api/json?tree=");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("skips jobs whose lastBuild number is unchanged", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ lastBuild: { number: 12 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await fetchJenkinsGraphDataForSHAs(
        [{ url: "https://jenkins.example.com/job/foo/" }],
        "user",
        "token",
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        { knownLastBuilds: new Map([["https://jenkins.example.com/job/foo", 12]]) },
      );
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
      expect(result.lastBuilds.get("https://jenkins.example.com/job/foo")).toBe(12);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("lastBuild");
      expect(calls[0]).not.toContain("builds[");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps one build to head commit only", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          builds: [
            {
              number: 12,
              url: "https://jenkins.example.com/job/foo/12/",
              result: "SUCCESS",
              building: false,
              timestamp: 1_700_000_000_000,
              duration: 12_000,
              actions: [{ lastBuiltRevision: { SHA1: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }],
              changeSets: [
                {
                  items: [{ commitId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      const result = await fetchJenkinsGraphDataForSHAs(
        [{ url: "https://jenkins.example.com/job/foo/" }],
        "user",
        "token",
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      );
      expect(result.error).toBeNull();
      expect(result.data.map(run => run.headSha)).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps shallow scmRevisionAction hash", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          builds: [
            {
              number: 12,
              url: "https://jenkins.example.com/job/foo/12/",
              result: "SUCCESS",
              building: false,
              timestamp: 1_700_000_000_000,
              duration: 12_000,
              actions: [{ scmRevisionAction: { revision: { hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      const result = await fetchJenkinsGraphDataForSHAs(
        [{ url: "https://jenkins.example.com/job/foo/" }],
        "user",
        "token",
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      );
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].headSha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reports Jenkins SSO redirect as auth failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://jenkins.example.com/securityRealm/commenceLogin" },
      })) as unknown as typeof fetch;

    try {
      const result = await fetchJenkinsGraphDataForSHAs(
        [{ url: "https://jenkins.example.com/job/foo/" }],
        "user",
        "token",
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      );
      expect(result.data).toHaveLength(0);
      expect(result.error).toBe(BANNER.jenkins.authFailed);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchJenkinsDataForSHAs", () => {
  test("preserves successful builds when one build detail request fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async input => {
      const url = decodeURIComponent(input.toString());
      if (url.includes("builds[number,url]")) {
        return Response.json({
          _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
          builds: [
            { number: 2, url: "https://jenkins.example.com/job/foo/2/" },
            { number: 1, url: "https://jenkins.example.com/job/foo/1/" },
          ],
        });
      }
      if (url.includes("/2/api/json")) return new Response("failed", { status: 500, statusText: "Failed" });
      return Response.json({
        number: 1,
        url: "https://jenkins.example.com/job/foo/1/",
        result: "SUCCESS",
        timestamp: 1_700_000_000_000,
        duration: 1_000,
        actions: [{ lastBuiltRevision: { SHA1: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }],
      });
    }) as typeof fetch;

    try {
      const result = await fetchJenkinsDataForSHAs([{ url: "https://jenkins.example.com/job/foo" }], "user", "token", [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ]);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].runNumber).toBe(1);
      expect(result.error).toBe(BANNER.jenkins.fetchFailed);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps credentialed requests on the configured origin when Jenkins reports another host", async () => {
    const originalFetch = globalThis.fetch;
    const sha = "a".repeat(40);
    const calls: string[] = [];
    globalThis.fetch = (async input => {
      const url = input.toString();
      calls.push(url);
      if (decodeURIComponent(url).includes("builds[number,url]")) {
        return Response.json({ builds: [{ number: 1, url: "https://evil.example.net/job/foo/1/" }] });
      }
      return Response.json({
        number: 1,
        url: "https://evil.example.net/job/foo/1/",
        result: "SUCCESS",
        timestamp: 1_700_000_000_000,
        actions: [{ lastBuiltRevision: { SHA1: sha } }],
      });
    }) as typeof fetch;

    try {
      const result = await fetchJenkinsDataForSHAs([{ url: "https://jenkins.example.com/job/foo" }], "user", "token", [
        sha,
      ]);
      expect(calls).toHaveLength(2);
      expect(calls.every(url => url.startsWith("https://jenkins.example.com/"))).toBe(true);
      expect(result.data[0].url).toBe("https://jenkins.example.com/job/foo/1/");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("resolveJenkinsJobs", () => {
  test("discovers enabled pipeline branches from a multibranch parent", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = (async input => {
      requestedUrl = input.toString();
      return new Response(
        JSON.stringify({
          _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
          jobs: [
            {
              _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
              name: "main",
              displayName: "main",
              url: "https://jenkins.example.com/job/service/job/main/",
              buildable: true,
              disabled: false,
            },
            {
              _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
              name: "disabled",
              url: "https://jenkins.example.com/job/service/job/disabled/",
              buildable: false,
              disabled: true,
            },
            {
              _class: "com.cloudbees.hudson.plugins.folder.Folder",
              name: "folder",
              url: "https://jenkins.example.com/job/service/job/folder/",
              buildable: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await resolveJenkinsJobs(
        [{ url: "https://jenkins.example.com/job/service", label: "Service" }],
        "user",
        "token",
      );
      expect(result.error).toBeNull();
      expect(result.jobs).toEqual([
        {
          url: "https://jenkins.example.com/job/service/job/main",
          label: "main",
        },
      ]);
      expect(decodeURIComponent(requestedUrl)).toContain(
        "jobs[_class,name,displayName,url,buildable,disabled,lastBuild[timestamp]]",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("over the limit, branches in the graph come first, then the most recently built", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
        jobs: Array.from({ length: 30 }, (_, idx) => ({
          _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
          // Jenkins encodes the slash of a branch name in the job name.
          name: idx === 29 ? "feature%2Frefunds" : `branch-${idx}`,
          url: `https://jenkins.example.com/job/service/job/b${idx}/`,
          buildable: true,
          disabled: false,
          // branch-0 was built longest ago, branch-28 most recently; branch-1 never.
          lastBuild: idx === 1 ? null : { timestamp: 1_000 + idx },
        })),
      })) as unknown as typeof fetch;
    try {
      const result = await resolveJenkinsJobs(
        [{ url: "https://jenkins.example.com/job/service" }],
        "user",
        "token",
        undefined,
        undefined,
        new Set(["feature/refunds"]),
      );
      expect(result.truncated).toBe(true);
      expect(result.branchJobs).toEqual({ shown: 25, total: 30 });
      const labels = result.jobs.map(job => job.label);
      expect(labels[0]).toBe("feature%2Frefunds");
      expect(labels.slice(1, 4)).toEqual(["branch-28", "branch-27", "branch-26"]);
      expect(labels).not.toContain("branch-1");
      expect(labels).not.toContain("branch-0");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("caps discovered enabled branches at 25 after filtering", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
          jobs: [
            ...Array.from({ length: 30 }, (_, idx) => ({
              _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
              name: `disabled-${idx}`,
              url: `https://jenkins.example.com/job/service/job/disabled-${idx}/`,
              buildable: false,
              disabled: true,
            })),
            ...Array.from({ length: 30 }, (_, idx) => ({
              _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
              name: `branch-${idx}`,
              url: `https://jenkins.example.com/job/service/job/branch-${idx}/`,
              buildable: true,
              disabled: false,
            })),
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      const result = await resolveJenkinsJobs([{ url: "https://jenkins.example.com/job/service" }], "user", "token");
      expect(result.jobs).toHaveLength(25);
      expect(result.jobs[0].url).toContain("branch-0");
      expect(result.jobs[24].url).toContain("branch-24");
      expect(result.complete).toBe(false);
      expect(result.truncated).toBe(true);
      expect(getDebugEvents()).toContainEqual(
        expect.objectContaining({
          source: "Jenkins",
          message: expect.stringContaining("Multibranch discovery limited to 25 jobs"),
        }),
      );
    } finally {
      clearDebugEvents();
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps discovery complete when enabled branches fit the limit", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
        jobs: Array.from({ length: 25 }, (_, idx) => ({
          _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
          name: `branch-${idx}`,
          url: `https://jenkins.example.com/job/service/job/branch-${idx}/`,
          buildable: true,
          disabled: false,
        })),
      })) as unknown as typeof fetch;

    try {
      const result = await resolveJenkinsJobs([{ url: "https://jenkins.example.com/job/service" }], "user", "token");
      expect(result.jobs).toHaveLength(25);
      expect(result.complete).toBe(true);
      expect(result.truncated).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps successful direct jobs when another configured URL fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async input => {
      if (input.toString().includes("/job/direct/")) {
        return new Response(JSON.stringify({ _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("failed", { status: 404, statusText: "Not Found" });
    }) as typeof fetch;

    try {
      const direct = { url: "https://jenkins.example.com/job/direct" };
      const result = await resolveJenkinsJobs(
        [direct, { url: "https://jenkins.example.com/job/service" }],
        "user",
        "token",
      );
      expect(result.jobs).toEqual([direct]);
      expect(result.error).toBe(BANNER.jenkins.fetchFailed);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rewrites discovered child URLs to the configured parent origin", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
          jobs: [
            {
              _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
              name: "main",
              url: "http://jenkins-internal:8080/jenkins/job/service/job/main/",
              buildable: true,
              disabled: false,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      const result = await resolveJenkinsJobs(
        [{ url: "https://jenkins.example.com/jenkins/job/service" }],
        "user",
        "token",
      );
      expect(result.jobs[0].url).toBe("https://jenkins.example.com/jenkins/job/service/job/main");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("over the limit, the graph's branches come first across all multibranch projects, not per project", async () => {
    const originalFetch = globalThis.fetch;
    const branch = (project: string, name: string, timestamp: number) => ({
      _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
      name,
      url: `https://jenkins.example.com/job/${project}/job/${name}/`,
      buildable: true,
      disabled: false,
      lastBuild: { timestamp },
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const project = String(input).includes("/job/tools/") ? "tools" : "service";
      return Response.json({
        _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
        jobs:
          project === "tools"
            ? Array.from({ length: 30 }, (_, index) => branch("tools", `chore-${index}`, 2000 + index))
            : [branch("service", "experiment", 1000), branch("service", "main", 10)],
      });
    }) as typeof fetch;

    try {
      const result = await resolveJenkinsJobs(
        [{ url: "https://jenkins.example.com/job/tools" }, { url: "https://jenkins.example.com/job/service" }],
        "user",
        "token",
        undefined,
        undefined,
        new Set(["main"]),
      );
      expect(result.jobs).toHaveLength(25);
      expect(result.jobs[0]?.url).toBe("https://jenkins.example.com/job/service/job/main");
      // Then the most recently built, whichever project they are in.
      expect(result.jobs[1]?.url).toBe("https://jenkins.example.com/job/tools/job/chore-29");
      expect(result.jobs.some(job => job.url.endsWith("/experiment"))).toBe(false);
      expect(result.branchJobs).toEqual({ shown: 25, total: 32 });
      expect(result.truncated).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the limit notice counts distinct branch jobs: a project listed twice or a branch also configured directly counts once", async () => {
    const originalFetch = globalThis.fetch;
    const branch = (name: string) => ({
      _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
      name,
      url: `https://jenkins.example.com/job/service/job/${name}/`,
      buildable: true,
      disabled: false,
    });
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).includes("/job/service/job/")
        ? Response.json({ _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob" })
        : Response.json({
            _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
            jobs: Array.from({ length: 30 }, (_, index) => branch(`b-${index}`)),
          })) as typeof fetch;
    try {
      const project = { url: "https://jenkins.example.com/job/service" };
      const direct = { url: "https://jenkins.example.com/job/service/job/b-0", label: "b-0 (configured)" };
      const result = await resolveJenkinsJobs([project, project, direct], "user", "token");
      expect(new Set(result.jobs.map(job => job.url)).size).toBe(result.jobs.length);
      expect(result.jobs).toHaveLength(26);
      // 29 branch jobs not configured directly; 25 of them are read.
      expect(result.branchJobs).toEqual({ shown: 25, total: 29 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("treats a missing root class as a direct job", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ builds: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      const direct = { url: "https://jenkins.example.com/job/direct" };
      const result = await resolveJenkinsJobs([direct], "user", "token");
      expect(result.jobs).toEqual([direct]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchJenkinsGraphDataForSHAs auth", () => {
  test("maps HTTP 401 to token expired", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    try {
      const result = await fetchJenkinsGraphDataForSHAs(
        [{ url: "https://jenkins.example.com/job/foo/" }],
        "user",
        "token",
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      );
      expect(result.error).toBe(BANNER.jenkins.tokenExpired);
      expect(result.data).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchJenkinsRunsForBuilds", () => {
  test("refreshes a known running build without job discovery", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          number: 12,
          url: "https://jenkins.example.com/job/foo/12/",
          result: "SUCCESS",
          building: false,
          timestamp: 1_700_000_000_000,
          duration: 12_000,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await fetchJenkinsRunsForBuilds(
        [
          {
            id: "https://jenkins.example.com/job/foo#12",
            name: "foo",
            status: "running",
            conclusion: null,
            headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            runNumber: 12,
            startedAt: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
            url: "https://jenkins.example.com/job/foo/12/",
            jobLabel: "foo",
            jobUrl: "https://jenkins.example.com/job/foo",
          },
        ],
        "user",
        "token",
      );
      expect(result.error).toBeNull();
      expect(result.data[0]?.status).toBe("completed");
      expect(result.data[0]?.conclusion).toBe("success");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("/job/foo/12/");
      expect(calls[0]).not.toContain("/job/foo/api/json");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("cached run requests stay on the job origin even when the stored run URL names another host", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json({});
  }) as typeof fetch;
  const run: JenkinsRun = {
    id: "https://jenkins.example.com/job/foo#12",
    name: "foo",
    status: "completed",
    conclusion: "success",
    headSha: "a".repeat(40),
    runNumber: 12,
    startedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: "https://evil.example.net/job/foo/12/",
    jobLabel: "foo",
    jobUrl: "https://jenkins.example.com/job/foo",
  };

  try {
    await fetchJenkinsRunsForBuilds([run], "user", "token");
    await fetchJenkinsRunJobs(run, "user", "token");
    await fetchJenkinsConsoleLog(run, "user", "token");
    // Builds, stages, the test report of the finished build, and the console log.
    expect(calls).toHaveLength(4);
    expect(calls.every(url => url.startsWith("https://jenkins.example.com/job/foo/12/"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

describe("mapStatus", () => {
  test("aborted builds are cancelled and not-built builds skipped, matching their stages", () => {
    expect(mapStatus({ building: false, result: "ABORTED" })).toEqual({ status: "completed", conclusion: "cancelled" });
    expect(mapStatus({ building: false, result: "NOT_BUILT" })).toEqual({ status: "completed", conclusion: "skipped" });
    expect(mapStatus({ building: false, result: "UNSTABLE" })).toEqual({ status: "completed", conclusion: "unstable" });
    expect(mapStatus({ building: true, result: null })).toEqual({ status: "running", conclusion: null });
  });
});

describe("fetchJenkinsConsoleLog failures", () => {
  const run = {
    id: "1",
    name: "app",
    status: "completed",
    conclusion: "success",
    headSha: "a".repeat(40),
    runNumber: 1,
    startedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: "https://jenkins.example.com/job/app/1/",
    jobLabel: "app",
    jobUrl: "https://jenkins.example.com/job/app",
  };
  test("a failed request throws its reason instead of looking like an empty log", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
      await expect(fetchJenkinsConsoleLog(run, "user", "token")).rejects.toThrow(BANNER.jenkins.tokenExpired);
      globalThis.fetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
      await expect(fetchJenkinsConsoleLog(run, "user", "token")).rejects.toThrow(BANNER.jenkins.logFailed);
      globalThis.fetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
      expect(await fetchJenkinsConsoleLog(run, "user", "token")).toBe("");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchJenkinsRunJobs failures", () => {
  test("a failed stage request says stages failed, not a generic fetch failure", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new Error("socket hang up");
      }) as unknown as typeof fetch;
      const run = {
        id: "1",
        name: "app",
        status: "completed",
        conclusion: "success",
        headSha: "a".repeat(40),
        runNumber: 1,
        startedAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        url: "https://jenkins.example.com/job/app/1/",
        jobLabel: "app",
        jobUrl: "https://jenkins.example.com/job/app",
      };
      expect((await fetchJenkinsRunJobs(run, "user", "token")).error).toBe(BANNER.jenkins.stagesFailed);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Jenkins test reports", () => {
  const run: JenkinsRun = {
    id: "1",
    name: "app",
    status: "completed",
    conclusion: "unstable",
    headSha: "a".repeat(40),
    runNumber: 412,
    startedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: "https://jenkins.example.com/job/app/412/",
    jobLabel: "app",
    jobUrl: "https://jenkins.example.com/job/app",
  };
  const withFetch = async (report: Response, check: (calls: string[]) => Promise<void>) => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/wfapi/describe"))
        return Response.json({ stages: [{ id: "6", name: "Test", status: "UNSTABLE" }] });
      if (url.includes("/testReport/")) return report;
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;
    try {
      await check(calls);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  test("a finished build's test report gives its counts and its failed tests", async () => {
    const report = Response.json({
      failCount: 2,
      passCount: 1204,
      skipCount: 12,
      suites: [
        {
          cases: [
            {
              className: "com.example.PaymentServiceTest",
              name: "refundsTwice",
              status: "FAILED",
              errorDetails: "expected: <1> but was: <2>",
              errorStackTrace:
                "org.opentest4j.AssertionFailedError: expected: <1> but was: <2>\n\tat PaymentServiceTest.refundsTwice(PaymentServiceTest.java:88)",
            },
            {
              className: "com.example.PaymentServiceTest",
              name: "pays",
              status: "PASSED",
              errorDetails: null,
              errorStackTrace: null,
            },
          ],
        },
        {
          cases: [
            {
              className: "OrderMapperTest",
              name: "mapsCurrency",
              status: "REGRESSION",
              errorDetails: null,
              errorStackTrace: "boom",
            },
          ],
        },
      ],
    });
    await withFetch(report, async calls => {
      const { jobs, error } = await fetchJenkinsRunJobs(run, "user", "token");
      expect(error).toBeNull();
      expect(
        calls.some(url => url.startsWith("https://jenkins.example.com/job/app/412/testReport/api/json?tree=")),
      ).toBe(true);
      expect(jobs[0].tests).toEqual({
        passCount: 1204,
        failCount: 2,
        skipCount: 12,
        failed: [
          {
            className: "com.example.PaymentServiceTest",
            name: "refundsTwice",
            details: "expected: <1> but was: <2>",
            stackTrace:
              "org.opentest4j.AssertionFailedError: expected: <1> but was: <2>\n\tat PaymentServiceTest.refundsTwice(PaymentServiceTest.java:88)",
          },
          { className: "OrderMapperTest", name: "mapsCurrency", details: null, stackTrace: "boom" },
        ],
      });
    });
  });

  test("a build without a test report has no tests, and still has its stages", async () => {
    await withFetch(new Response("not found", { status: 404 }), async () => {
      clearDebugEvents();
      const { jobs, error } = await fetchJenkinsRunJobs(run, "user", "token");
      expect(error).toBeNull();
      // A missing report is no error: Debug only lists the request, it reports no failure.
      expect(getDebugEvents().some(event => event.message.startsWith("404"))).toBe(false);
      expect(jobs[0].steps.map(stage => stage.name)).toEqual(["Test"]);
      expect(jobs[0].tests).toBeNull();
    });
  });

  test("a test report that could not be read is unknown, not missing, so it is asked for again", async () => {
    await withFetch(new Response("busy", { status: 503 }), async () => {
      const { jobs, error } = await fetchJenkinsRunJobs(run, "user", "token");
      expect(error).toBeNull();
      expect(jobs[0].steps.map(stage => stage.name)).toEqual(["Test"]);
      expect(jobs[0]).not.toHaveProperty("tests");
    });
  });

  test("a running build does not ask for a test report", async () => {
    await withFetch(Response.json({}), async calls => {
      await fetchJenkinsRunJobs({ ...run, status: "running", conclusion: null }, "user", "token");
      expect(calls.some(url => url.includes("/testReport/"))).toBe(false);
    });
  });
});
