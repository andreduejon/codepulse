import { describe, expect, test } from "bun:test";
import {
  buildJenkinsCommitDataMap,
  buildJenkinsGraphBadges,
  deriveJenkinsJobLabel,
  extractCandidateShas,
  extractHeadShas,
  extractSha,
  fetchJenkinsGraphDataForSHAs,
  jenkinsApiUrl,
  normalizeJenkinsJobUrl,
} from "./api";
import type { JenkinsRun } from "./types";

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
});

// ---------------------------------------------------------------------------
// Jenkins fetch behavior
// ---------------------------------------------------------------------------

describe("fetchJenkinsGraphDataForSHAs", () => {
  test("sends Basic auth header and maps matching build", async () => {
    const originalFetch = globalThis.fetch;
    const calls: (RequestInfo | URL)[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push(input);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Basic dXNlcjp0b2tlbg==");
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
      expect(result.error).toBe(
        "Jenkins authentication failed. Verify username, token, and complete browser login if required.",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
