import { afterEach, describe, expect, it, mock } from "bun:test";
import { BANNER } from "../src/debug/banner";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";
import {
  aggregateRunsToGraphBadge,
  buildCommitDataMap,
  buildGraphBadges,
  fetchCIDataForSHAs,
  fetchRunJobs,
  GQL_BATCH_SIZE,
  getGitHubToken,
  getTokenSource,
  isGitHubJobsFieldSchemaError,
  isTrustedGitHubHost,
  mapRunToBadge,
  nextGithubLink,
  normalizeGitHubHost,
  parseGitHubRemote,
} from "../src/providers/github-actions/api";
import type { GitHubApiJob } from "../src/providers/github-actions/types";

// ── parseGitHubRemote ─────────────────────────────────────────────────────

describe("parseGitHubRemote", () => {
  describe("HTTPS URLs", () => {
    it.each([
      [
        "parses standard HTTPS URL with .git suffix",
        "https://github.com/owner/repo.git",
        "github.com",
        "owner",
        "repo",
      ],
      ["parses HTTPS URL without .git suffix", "https://github.com/owner/repo", "github.com", "owner", "repo"],
      ["parses HTTPS URL with trailing slash", "https://github.com/owner/repo/", "github.com", "owner", "repo"],
      [
        "parses HTTPS URL with .git and trailing slash",
        "https://github.com/owner/repo.git/",
        "github.com",
        "owner",
        "repo",
      ],
      ["handles org names with hyphens", "https://github.com/my-org/my-repo.git", "github.com", "my-org", "my-repo"],
      [
        "handles org names with underscores and dots",
        "https://github.com/my_org/my.repo",
        "github.com",
        "my_org",
        "my.repo",
      ],
      ["is case-insensitive for the domain", "https://GitHub.COM/Owner/Repo.git", "GitHub.COM", "Owner", "Repo"],
      [
        "parses GitHub Enterprise HTTPS URL",
        "https://github.example.com/owner/repo.git",
        "github.example.com",
        "owner",
        "repo",
      ],
    ])("%s", (_label, url, hostname, owner, repo) => {
      expect(parseGitHubRemote(url)).toEqual({ hostname, owner, repo });
    });
  });

  describe("SSH scp-style URLs", () => {
    it.each([
      ["parses git@ SSH URL with .git suffix", "git@github.com:owner/repo.git", "github.com", "owner", "repo"],
      ["parses git@ SSH URL without .git suffix", "git@github.com:owner/repo", "github.com", "owner", "repo"],
      [
        "handles org/repo with hyphens in SSH format",
        "git@github.com:my-org/my-repo.git",
        "github.com",
        "my-org",
        "my-repo",
      ],
      [
        "parses GitHub Enterprise SSH URL",
        "git@github.example.com:owner/repo.git",
        "github.example.com",
        "owner",
        "repo",
      ],
    ])("%s", (_label, url, hostname, owner, repo) => {
      expect(parseGitHubRemote(url)).toEqual({ hostname, owner, repo });
    });
  });

  describe("SSH protocol URLs", () => {
    it.each([
      ["parses ssh:// URL with git@ prefix", "ssh://git@github.com/owner/repo.git"],
      ["parses ssh:// URL without git@ prefix", "ssh://github.com/owner/repo.git"],
      ["parses ssh:// URL without .git suffix", "ssh://git@github.com/owner/repo"],
    ])("%s", (_label, url) => {
      expect(parseGitHubRemote(url)).toEqual({ hostname: "github.com", owner: "owner", repo: "repo" });
    });
  });

  describe("non-GitHub hosted services — parsed with their hostname", () => {
    it.each([
      ["parses GitLab HTTPS URL (hostname=gitlab.com)", "https://gitlab.com/owner/repo.git", "gitlab.com"],
      ["parses GitLab SSH URL (hostname=gitlab.com)", "git@gitlab.com:owner/repo.git", "gitlab.com"],
      ["parses Bitbucket URL (hostname=bitbucket.org)", "https://bitbucket.org/owner/repo.git", "bitbucket.org"],
      ["parses self-hosted git URL", "https://git.example.com/owner/repo.git", "git.example.com"],
    ])("%s", (_label, url, hostname) => {
      expect(parseGitHubRemote(url)).toEqual({ hostname, owner: "owner", repo: "repo" });
    });
  });

  describe("malformed URLs — return null", () => {
    it.each([
      ["empty string", ""],
      ["whitespace-only string", "   "],
      ["malformed URL", "not-a-url"],
      ["URL missing repo part", "https://github.com/owner"],
      ["URL missing owner part", "https://github.com/"],
    ])("returns null for %s", (_label, url) => {
      expect(parseGitHubRemote(url)).toBeNull();
    });
  });

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace", () => {
      expect(parseGitHubRemote("  https://github.com/owner/repo.git  ")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });
  });
});

describe("normalizeGitHubHost", () => {
  it.each([
    ["accepts hostname only", "ghe.example.com", "ghe.example.com"],
    ["accepts hostname with port", "ghe.example.com:8443", "ghe.example.com:8443"],
    ["rejects protocol", "https://ghe.example.com", null],
    ["rejects path", "ghe.example.com/foo", null],
  ])("%s", (_label, host, expected) => {
    expect(normalizeGitHubHost(host)).toBe(expected);
  });
});

describe("isTrustedGitHubHost", () => {
  it.each([
    ["always trusts github.com", "github.com", null, true],
    ["trusts configured enterprise host", "ghe.example.com", "ghe.example.com", true],
    ["rejects unconfigured hosts", "gitlab.com", "ghe.example.com", false],
  ])("%s", (_label, host, trustedHost, expected) => {
    expect(isTrustedGitHubHost(host, trustedHost)).toBe(expected);
  });
});

// ── getGitHubToken ────────────────────────────────────────────────────────

describe("getGitHubToken", () => {
  afterEach(() => {
    delete process.env.TEST_GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it.each([
    ["returns the token when env var is set", "TEST_GH_TOKEN", "ghp_abc123", "ghp_abc123"],
    ["trims whitespace from the token", "TEST_GH_TOKEN", "  ghp_abc123  ", "ghp_abc123"],
    ["returns null when env var is empty string", "TEST_GH_TOKEN", "", null],
    ["returns null when env var is whitespace only", "TEST_GH_TOKEN", "   ", null],
    ["reads from GITHUB_TOKEN by default name", "GITHUB_TOKEN", "ghp_default", "ghp_default"],
  ])("%s", (_label, envVarName, value, expected) => {
    process.env[envVarName] = value;
    expect(getGitHubToken(envVarName)).toBe(expected);
  });

  it("returns null when env var is missing", () => {
    expect(getGitHubToken("TEST_GH_TOKEN")).toBeNull();
  });
});

// ── getTokenSource ────────────────────────────────────────────────────────

describe("getTokenSource", () => {
  afterEach(() => {
    delete process.env.TEST_TOKEN_SRC;
  });

  it('returns "env" when env var is set', () => {
    process.env.TEST_TOKEN_SRC = "ghp_env";
    expect(getTokenSource("TEST_TOKEN_SRC")).toBe("env");
  });

  it("returns null when env var is unset", () => {
    delete process.env.TEST_TOKEN_SRC;
    expect(getTokenSource("TEST_TOKEN_SRC")).toBeNull();
  });

  it("returns null when env var is whitespace only", () => {
    process.env.TEST_TOKEN_SRC = "   ";
    expect(getTokenSource("TEST_TOKEN_SRC")).toBeNull();
  });
});

// ── mapRunToBadge ─────────────────────────────────────────────────────────

describe("mapRunToBadge", () => {
  it.each([
    ["completed", "success", "pass"],
    ["completed", "failure", "fail"],
    ["completed", "cancelled", "unknown"], // not a build failure
    ["completed", "timed_out", "fail"],
    ["completed", "startup_failure", "fail"],
    ["completed", "skipped", "unknown"],
    ["completed", "neutral", "unknown"],
    ["completed", "action_required", "unknown"],
    ["completed", null, "unknown"],
    ["in_progress", null, "running"],
    ["queued", null, "running"],
    ["waiting", null, "running"],
    ["requested", null, "running"],
    ["pending", null, "running"],
  ] as const)("maps %s + %p → %p", (status, conclusion, expected) => {
    expect(mapRunToBadge(status, conclusion)).toBe(expected);
  });
});

// ── aggregateRunsToGraphBadge ─────────────────────────────────────────────

function makeRun(
  overrides: Partial<{
    id: number;
    status: string;
    conclusion: string | null;
    updatedAt: string;
    headSha: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    name: "CI",
    status: overrides.status ?? "completed",
    conclusion: overrides.conclusion ?? "success",
    headSha: overrides.headSha ?? "abc123",
    event: "push",
    runNumber: 1,
    updatedAt: overrides.updatedAt ?? "2024-01-01T01:00:00Z",
  };
}

describe("aggregateRunsToGraphBadge", () => {
  it("all passing → badge=pass, correct counts", () => {
    const runs = [makeRun({ id: 1 }), makeRun({ id: 2 }), makeRun({ id: 3 })];
    const badge = aggregateRunsToGraphBadge("abc123", runs);
    expect(badge.badge).toBe("pass");
    expect(badge.passCount).toBe(3);
    expect(badge.failCount).toBe(0);
    expect(badge.runningCount).toBe(0);
  });

  it("any failing → badge=fail regardless of others", () => {
    const runs = [
      makeRun({ id: 1 }),
      makeRun({ id: 2, status: "completed", conclusion: "failure" }),
      makeRun({ id: 3 }),
    ];
    const badge = aggregateRunsToGraphBadge("abc123", runs);
    expect(badge.badge).toBe("fail");
    expect(badge.failCount).toBe(1);
    expect(badge.passCount).toBe(2);
  });

  it("any running with no failures → badge=running", () => {
    const runs = [makeRun({ id: 1 }), makeRun({ id: 2, status: "in_progress", conclusion: null })];
    const badge = aggregateRunsToGraphBadge("abc123", runs);
    expect(badge.badge).toBe("running");
    expect(badge.runningCount).toBe(1);
    expect(badge.passCount).toBe(1);
  });

  it("fail beats running in badge", () => {
    const runs = [
      makeRun({ id: 1, status: "in_progress", conclusion: null }),
      makeRun({ id: 2, status: "completed", conclusion: "failure" }),
    ];
    const badge = aggregateRunsToGraphBadge("abc123", runs);
    expect(badge.badge).toBe("fail");
  });

  it("latest run is identified correctly", () => {
    const older = makeRun({ id: 1, updatedAt: "2024-01-01T00:00:00Z" });
    const newer = makeRun({ id: 2, updatedAt: "2024-01-02T00:00:00Z", conclusion: "failure" });
    const badge = aggregateRunsToGraphBadge("abc123", [older, newer]);
    expect(badge.latestRunAt).toBe("2024-01-02T00:00:00Z");
    expect(badge.latestStatus).toBe("fail");
  });

  it("empty runs → badge=unknown", () => {
    const badge = aggregateRunsToGraphBadge("abc123", []);
    expect(badge.badge).toBe("unknown");
    expect(badge.passCount).toBe(0);
    expect(badge.latestRunAt).toBe("");
  });
});

// ── buildGraphBadges ──────────────────────────────────────────────────────

describe("buildGraphBadges", () => {
  it("groups runs by SHA and builds badges", () => {
    const runs = [
      makeRun({ id: 1, headSha: "sha1" }),
      makeRun({ id: 2, headSha: "sha1", conclusion: "failure" }),
      makeRun({ id: 3, headSha: "sha2" }),
    ];
    const badges = buildGraphBadges(runs);
    expect(badges.size).toBe(2);
    expect(badges.get("sha1")?.badge).toBe("fail");
    expect(badges.get("sha2")?.badge).toBe("pass");
  });

  it("returns empty map for empty input", () => {
    expect(buildGraphBadges([])).toEqual(new Map());
  });
});

// ── buildCommitDataMap ────────────────────────────────────────────────────

describe("buildCommitDataMap", () => {
  it("groups runs by SHA sorted newest-first", () => {
    const older = makeRun({ id: 1, headSha: "sha1", updatedAt: "2024-01-01T00:00:00Z" });
    const newer = makeRun({ id: 2, headSha: "sha1", updatedAt: "2024-01-02T00:00:00Z" });
    const map = buildCommitDataMap([older, newer]);
    expect(map.size).toBe(1);
    const data = map.get("sha1");
    expect(data?.runs[0].id).toBe(2); // newest first
    expect(data?.runs[1].id).toBe(1);
  });

  it("returns empty map for empty input", () => {
    expect(buildCommitDataMap([])).toEqual(new Map());
  });
});

// ── Shared test helpers ───────────────────────────────────────────────────

const TEST_REPO = { hostname: "github.com", owner: "owner", repo: "repo" };
const TEST_TOKEN = "ghp_test";

/** Helper to assign a mock function as globalThis.fetch without TS complaining
 *  about the `preconnect` property that Bun adds to its native fetch. */
// biome-ignore lint/suspicious/noExplicitAny: intentional test helper cast
function mockFetch(fn: (...args: any[]) => Promise<Response>): void {
  // biome-ignore lint/suspicious/noExplicitAny: intentional test helper cast
  globalThis.fetch = fn as any;
}

afterEach(() => clearDebugEvents());

// ── fetchRunJobs (mocked fetch) ───────────────────────────────────────────

function makeApiJob(overrides: Partial<GitHubApiJob> = {}): GitHubApiJob {
  return {
    id: 1,
    name: "build",
    status: "completed",
    conclusion: "success",
    started_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:01:00Z",
    steps: [
      {
        name: "Checkout",
        status: "completed",
        conclusion: "success",
        number: 1,
        started_at: "2024-01-01T00:00:00Z",
        completed_at: "2024-01-01T00:00:10Z",
      },
      {
        name: "Build",
        status: "completed",
        conclusion: "success",
        number: 2,
        started_at: "2024-01-01T00:00:10Z",
        completed_at: "2024-01-01T00:01:00Z",
      },
    ],
    ...overrides,
  };
}

describe("fetchRunJobs", () => {
  afterEach(() => {
    globalThis.fetch = fetch;
  });

  it("returns mapped jobs with steps", async () => {
    mockFetch(mock(async () => new Response(JSON.stringify({ jobs: [makeApiJob()] }), { status: 200 })));
    const { jobs, error } = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 123);
    expect(error).toBeNull();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("build");
    expect(jobs[0].steps).toHaveLength(2);
    expect(jobs[0].steps[0].name).toBe("Checkout");
    expect(jobs[0].steps[1].number).toBe(2);
  });

  it("returns explicit error (no throw) on 404", async () => {
    mockFetch(mock(async () => new Response(null, { status: 404 })));
    const { jobs, error } = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 999);
    expect(error).toBe(BANNER.github.jobsFailed);
    expect(jobs).toHaveLength(0);
    expect(getDebugEvents().some(event => event.source === "GitHub" && event.message.includes("404"))).toBe(true);
  });

  it("returns explicit error (no throw) on network error", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("Network failure");
      }),
    );
    const { jobs, error } = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 123);
    expect(error).toBe(BANNER.github.jobsFailed);
    expect(jobs).toHaveLength(0);
    expect(getDebugEvents().some(event => event.message.includes("Network failure"))).toBe(true);
  });

  it("handles missing steps array gracefully", async () => {
    const jobWithoutSteps = { ...makeApiJob(), steps: undefined as unknown as [] };
    mockFetch(mock(async () => new Response(JSON.stringify({ jobs: [jobWithoutSteps] }), { status: 200 })));
    const { jobs } = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 123);
    expect(jobs[0].steps).toEqual([]);
  });

  it("follows Link rel=next and concatenates job pages", async () => {
    const page1 = new Response(JSON.stringify({ jobs: [makeApiJob({ id: 1, name: "a" })] }), {
      status: 200,
      headers: { Link: '<https://api.github.com/repos/o/r/actions/runs/123/jobs?page=2>; rel="next"' },
    });
    const page2 = new Response(JSON.stringify({ jobs: [makeApiJob({ id: 2, name: "b" })] }), { status: 200 });
    let n = 0;
    mockFetch(
      mock(async () => {
        n++;
        return n === 1 ? page1 : page2;
      }),
    );
    const { jobs, error } = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 123);
    expect(error).toBeNull();
    expect(jobs.map(j => j.name)).toEqual(["a", "b"]);
    expect(n).toBe(2);
  });
});

describe("isGitHubJobsFieldSchemaError", () => {
  it("matches GHE WorkflowRun.jobs schema errors", () => {
    expect(isGitHubJobsFieldSchemaError("Field 'jobs' doesn't exist on type 'WorkflowRun'")).toBe(true);
    expect(isGitHubJobsFieldSchemaError('Field "jobs" does not exist on type WorkflowRun')).toBe(true);
    expect(isGitHubJobsFieldSchemaError("Field jobs does not exist on type WorkFloRun")).toBe(true);
    expect(isGitHubJobsFieldSchemaError('Cannot query field "jobs" on type "WorkflowRun".')).toBe(true);
    expect(isGitHubJobsFieldSchemaError("Not Found")).toBe(false);
    expect(isGitHubJobsFieldSchemaError("Field 'steps' doesn't exist on type 'WorkflowRun'")).toBe(false);
  });
});

describe("nextGithubLink", () => {
  it("returns next URL when origin matches", () => {
    expect(nextGithubLink('<https://api.github.com/repos/o/r/jobs?page=2>; rel="next"', "https://api.github.com")).toBe(
      "https://api.github.com/repos/o/r/jobs?page=2",
    );
  });

  it("rejects next URL on a different origin", () => {
    expect(nextGithubLink('<https://evil.example/jobs>; rel="next"', "https://api.github.com")).toBeNull();
  });
});

// ── fetchCIDataForSHAs ────────────────────────────────────────────────────

/**
 * Build a minimal valid GraphQL batch-object response for fetchCIDataForSHAs.
 *
 * The response shape is:
 *   { data: { repository: { c0: { oid, checkSuites: { nodes: [...] } }, c1: ..., ... } } }
 *
 * Each entry in `commits` corresponds to one alias key (c0, c1, …) in the
 * same order as the shas array passed to fetchCIDataForSHAs.
 */
function makeBatchResponse(
  commits: Array<{
    sha: string;
    suites: Array<{
      status?: string;
      conclusion?: string | null;
      wfRunId?: number;
      wfRunNumber?: number;
      wfName?: string;
      event?: string;
      jobs?: Array<{
        databaseId: number;
        name: string;
        status?: string;
        conclusion?: string | null;
        steps?: Array<{ name: string; number: number; status?: string; conclusion?: string | null }>;
      }>;
    }>;
  }>,
) {
  const repository: Record<string, unknown> = {};
  commits.forEach((c, i) => {
    repository[`c${i}`] = {
      oid: c.sha,
      checkSuites: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: c.suites.map(s => ({
          status: s.status ?? "COMPLETED",
          conclusion: s.conclusion !== undefined ? s.conclusion : "SUCCESS",
          workflowRun:
            s.wfRunId !== undefined
              ? {
                  databaseId: s.wfRunId,
                  runNumber: s.wfRunNumber ?? 1,
                  event: s.event ?? "push",
                  updatedAt: "2024-01-02T00:00:00Z",
                  workflow: { name: s.wfName ?? "CI" },
                  jobs: s.jobs ? { nodes: s.jobs } : undefined,
                }
              : null,
        })),
      },
    };
  });
  return { data: { repository } };
}

describe("fetchCIDataForSHAs", () => {
  afterEach(() => {
    globalThis.fetch = fetch;
  });

  it("returns runs for two commits on different branches", async () => {
    const response = makeBatchResponse([
      {
        sha: "aaa",
        suites: [{ wfRunId: 1, wfName: "CI" }],
      },
      {
        sha: "bbb",
        suites: [
          {
            wfRunId: 2,
            wfName: "Deploy",
            status: "IN_PROGRESS",
            conclusion: null,
          },
        ],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["aaa", "bbb"]);

    expect(result.data).toHaveLength(2);
    expect(result.data[0].headSha).toBe("aaa");
    expect(result.data[0].name).toBe("CI");
    expect(result.data[0].status).toBe("completed");
    expect(result.data[0].conclusion).toBe("success");
    expect(result.data[1].headSha).toBe("bbb");
    expect(result.data[1].status).toBe("in_progress");
    expect(result.data[1].conclusion).toBeNull();
  });

  it("maps workflow jobs and steps from the GraphQL batch", async () => {
    const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const response = makeBatchResponse([
      {
        sha,
        suites: [
          {
            wfRunId: 9,
            jobs: [
              {
                databaseId: 91,
                name: "test",
                status: "COMPLETED",
                conclusion: "SUCCESS",
                steps: [{ name: "Checkout", number: 1, status: "COMPLETED", conclusion: "SUCCESS" }],
              },
            ],
          },
        ],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, [sha]);
    expect(result.jobs.get(9)).toEqual([
      {
        id: 91,
        name: "test",
        status: "completed",
        conclusion: "success",
        startedAt: null,
        completedAt: null,
        steps: [
          {
            name: "Checkout",
            status: "completed",
            conclusion: "success",
            number: 1,
            startedAt: null,
            completedAt: null,
          },
        ],
      },
    ]);
  });

  it("skips check suites with no workflowRun (non-Actions checks)", async () => {
    const response = makeBatchResponse([
      {
        sha: "ccc",
        suites: [
          { wfRunId: undefined as unknown as number }, // no workflowRun
          { wfRunId: 5, wfName: "CI" },
        ],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["ccc"]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(5);
  });

  it("normalises UPPER_SNAKE_CASE status/conclusion to lower_snake_case", async () => {
    const response = makeBatchResponse([
      {
        sha: "ddd",
        suites: [{ wfRunId: 7, status: "COMPLETED", conclusion: "FAILURE" }],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["ddd"]);
    expect(result.data[0].status).toBe("completed");
    expect(result.data[0].conclusion).toBe("failure");
  });

  it("maps HTTP 401 to a token-expired banner", async () => {
    mockFetch(mock(async () => new Response(null, { status: 401 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.data).toHaveLength(0);
    expect(result.error).toBe(BANNER.github.tokenExpired);
  });

  it("returns empty result on HTTP error (graceful degradation)", async () => {
    mockFetch(mock(async () => new Response(null, { status: 403 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.data).toHaveLength(0);
    expect(result.error).toBe(BANNER.github.fetchFailed);
    expect(getDebugEvents().some(event => event.source === "GitHub" && event.message.includes("403"))).toBe(true);
  });

  it("returns empty result on GraphQL errors field", async () => {
    const response = { errors: [{ message: "Not Found" }] };
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.data).toHaveLength(0);
    expect(result.error).toBe(BANNER.github.fetchFailed);
    expect(getDebugEvents().some(event => event.message.includes("Not Found"))).toBe(true);
  });

  it("retries without jobs when WorkflowRun.jobs is missing from the schema", async () => {
    const queries: string[] = [];
    const retryResponse = makeBatchResponse([{ sha: "abc", suites: [{ wfRunId: 1, wfName: "CI" }] }]);
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        queries.push(JSON.parse(init.body as string).query as string);
        if (queries.length === 1) {
          return new Response(
            JSON.stringify({
              errors: [
                { message: "Field 'jobs' doesn't exist on type 'WorkflowRun'" },
                { message: "Field 'jobs' doesn't exist on type 'WorkflowRun'" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(retryResponse), { status: 200 });
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.error).toBeNull();
    expect(result.jobsUnsupported).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("CI");
    expect(result.jobs.size).toBe(0);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("jobs(first: 30)");
    expect(queries[1]).not.toContain("jobs(");
  });

  it("omits WorkflowRun.jobs when includeJobs is false", async () => {
    let query = "";
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        query = JSON.parse(init.body as string).query as string;
        return new Response(
          JSON.stringify(makeBatchResponse([{ sha: "abc", suites: [{ wfRunId: 1, wfName: "CI" }] }])),
          { status: 200 },
        );
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"], { includeJobs: false });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(query).not.toContain("jobs(");
  });

  it("handles ten repeated unquoted jobs schema errors without reporting a failure", async () => {
    const queries: string[] = [];
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        queries.push(JSON.parse(init.body as string).query as string);
        return new Response(
          JSON.stringify(
            queries.length === 1
              ? {
                  errors: Array.from({ length: 10 }, () => ({
                    message: "Field jobs does not exist on type WorkFloRun",
                  })),
                }
              : makeBatchResponse([{ sha: "abc", suites: [{ wfRunId: 1 }] }]),
          ),
          { status: 200 },
        );
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.error).toBeNull();
    expect(result.jobsUnsupported).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(queries).toHaveLength(2);
    expect(queries[1]).not.toContain("jobs(");
    expect(getDebugEvents().filter(event => event.status === "error")).toEqual([]);
  });

  it("keeps runs when jobs schema errors arrive with data", async () => {
    const response = {
      ...makeBatchResponse([{ sha: "abc", suites: [{ wfRunId: 3, wfName: "CI" }] }]),
      errors: [{ message: "Field 'jobs' doesn't exist on type 'WorkflowRun'" }],
    };
    let calls = 0;
    mockFetch(
      mock(async () => {
        calls++;
        return new Response(JSON.stringify(response), { status: 200 });
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(calls).toBe(1);
    expect(result.error).toBeNull();
    expect(result.jobsUnsupported).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(3);
  });

  it.each([1, 2])("stops querying jobs after partial schema errors on page %i", async rejectedPage => {
    const queries: string[] = [];
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        queries.push(JSON.parse(init.body as string).query as string);
        const page = queries.length;
        const response = makeBatchResponse([{ sha: "abc", suites: [{ wfRunId: page }] }]);
        const commit = response.data.repository.c0 as {
          checkSuites: { pageInfo: { hasNextPage: boolean; endCursor: string | null } };
        };
        commit.checkSuites.pageInfo = { hasNextPage: page < 3, endCursor: page < 3 ? `PAGE${page}` : null };
        return new Response(
          JSON.stringify({
            ...response,
            ...(page === rejectedPage
              ? { errors: [{ message: "Field jobs does not exist on type WorkflowRun" }] }
              : {}),
          }),
          { status: 200 },
        );
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.error).toBeNull();
    expect(result.jobsUnsupported).toBe(true);
    expect(result.data.map(run => run.id)).toEqual([1, 2, 3]);
    expect(queries).toHaveLength(3);
    queries.forEach((query, index) => {
      expect(query.includes("jobs(")).toBe(index < rejectedPage);
    });
    expect(getDebugEvents().filter(event => event.status === "error")).toEqual([]);
  });

  it("keeps unrelated GraphQL failures visible and deduplicates their messages", async () => {
    let calls = 0;
    mockFetch(
      mock(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            errors: [
              { message: "Field jobs does not exist on type WorkflowRun" },
              { message: "Not Found" },
              { message: "Not Found" },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.error).toBe(BANNER.github.fetchFailed);
    expect(result.jobsUnsupported).not.toBe(true);
    expect(calls).toBe(1);
    const errors = getDebugEvents().filter(event => event.status === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message.match(/Not Found/g)).toHaveLength(1);
    expect(errors[0].message).toContain("Field jobs does not exist");
  });

  it("returns empty result on network error", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("Network failure");
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.data).toHaveLength(0);
    expect(result.error).toBe(BANNER.github.fetchFailed);
    expect(getDebugEvents().some(event => event.message.includes("Network failure"))).toBe(true);
  });

  it("returns empty result immediately for empty shas array", async () => {
    // fetch should not be called at all
    let fetchCalled = false;
    mockFetch(
      mock(async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, []);
    expect(result.data).toHaveLength(0);
    expect(fetchCalled).toBe(false);
  });

  it("handles commits with no check suites gracefully", async () => {
    const response = makeBatchResponse([{ sha: "eee", suites: [] }]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["eee"]);
    expect(result.data).toHaveLength(0);
  });

  it("handles a SHA not found in repository (null alias) gracefully", async () => {
    // GitHub returns null for an unknown object oid
    const response = { data: { repository: { c0: null } } };
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["unknown-sha"]);
    expect(result.data).toHaveLength(0);
  });

  it("sends POST to GraphQL endpoint with correct body shape", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    mockFetch(
      mock(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify(makeBatchResponse([])), { status: 200 });
      }),
    );
    await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["sha1", "sha2"]);
    expect(capturedUrl).toBe("https://api.github.com/graphql");
    // Variables contain owner and repo but NOT branch (branch-agnostic)
    const vars = capturedBody.variables as Record<string, unknown>;
    expect(vars?.owner).toBe("owner");
    expect(vars?.repo).toBe("repo");
    expect(vars?.branch).toBeUndefined();
    // Query should contain aliased object(oid:) calls for each SHA
    const query = capturedBody.query as string;
    expect(query).toContain('object(oid: "sha1")');
    expect(query).toContain('object(oid: "sha2")');
    expect(query).toContain("c0:");
    expect(query).toContain("c1:");
  });

  it("sends Authorization Bearer header", async () => {
    let authHeader = "";
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        authHeader = new Headers(init.headers as HeadersInit).get("authorization") ?? "";
        return new Response(JSON.stringify(makeBatchResponse([])), { status: 200 });
      }),
    );
    await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(authHeader).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it("maps multiple runs per commit to separate entries in runs array", async () => {
    const response = makeBatchResponse([
      {
        sha: "ggg",
        suites: [
          { wfRunId: 100, wfName: "CI" },
          { wfRunId: 101, wfName: "Deploy" },
          { wfRunId: 102, wfName: "Lint" },
        ],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["ggg"]);
    expect(result.data).toHaveLength(3);
    expect(result.data.every(r => r.headSha === "ggg")).toBe(true);
    const names = result.data.map(r => r.name);
    expect(names).toContain("CI");
    expect(names).toContain("Deploy");
    expect(names).toContain("Lint");
  });

  it("paginates check suites when hasNextPage is true", async () => {
    const page1 = {
      data: {
        repository: {
          c0: {
            oid: "sha",
            checkSuites: {
              pageInfo: { hasNextPage: true, endCursor: "CURSOR" },
              nodes: [
                {
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                  workflowRun: {
                    databaseId: 1,
                    runNumber: 1,
                    event: "push",
                    updatedAt: "2024-01-02T00:00:00Z",
                    workflow: { name: "CI" },
                  },
                },
              ],
            },
          },
        },
      },
    };
    const page2 = {
      data: {
        repository: {
          c0: {
            oid: "sha",
            checkSuites: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  status: "COMPLETED",
                  conclusion: "FAILURE",
                  workflowRun: {
                    databaseId: 2,
                    runNumber: 2,
                    event: "push",
                    updatedAt: "2024-01-02T00:00:00Z",
                    workflow: { name: "Deploy" },
                  },
                },
              ],
            },
          },
        },
      },
    };
    let n = 0;
    mockFetch(
      mock(async () => {
        n++;
        return new Response(JSON.stringify(n === 1 ? page1 : page2), { status: 200 });
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["sha"]);
    expect(n).toBe(2);
    expect(result.data.map(r => r.name)).toEqual(["CI", "Deploy"]);
    expect(result.error).toBeNull();
  });

  it("exports GQL_BATCH_SIZE as a positive integer", () => {
    expect(typeof GQL_BATCH_SIZE).toBe("number");
    expect(GQL_BATCH_SIZE).toBeGreaterThan(0);
  });
});
