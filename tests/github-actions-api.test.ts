import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  aggregateRunsToGraphBadge,
  buildCommitDataMap,
  buildGraphBadges,
  fetchCIDataGraphQL,
  fetchRunJobs,
  fetchWorkflowRuns,
  getGitHubToken,
  mapRunToBadge,
  parseGitHubRemote,
} from "../src/providers/github-actions/api";
import type { GitHubApiJob, GitHubApiRun } from "../src/providers/github-actions/types";

// ── parseGitHubRemote ─────────────────────────────────────────────────────

describe("parseGitHubRemote", () => {
  describe("HTTPS URLs", () => {
    it("parses standard HTTPS URL with .git suffix", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo.git")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses HTTPS URL without .git suffix", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses HTTPS URL with trailing slash", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo/")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses HTTPS URL with .git and trailing slash", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo.git/")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("handles org names with hyphens", () => {
      expect(parseGitHubRemote("https://github.com/my-org/my-repo.git")).toEqual({
        owner: "my-org",
        repo: "my-repo",
      });
    });

    it("handles org names with underscores and dots", () => {
      expect(parseGitHubRemote("https://github.com/my_org/my.repo")).toEqual({
        owner: "my_org",
        repo: "my.repo",
      });
    });

    it("is case-insensitive for the domain", () => {
      expect(parseGitHubRemote("https://GitHub.COM/Owner/Repo.git")).toEqual({
        owner: "Owner",
        repo: "Repo",
      });
    });
  });

  describe("SSH scp-style URLs", () => {
    it("parses git@ SSH URL with .git suffix", () => {
      expect(parseGitHubRemote("git@github.com:owner/repo.git")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses git@ SSH URL without .git suffix", () => {
      expect(parseGitHubRemote("git@github.com:owner/repo")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("handles org/repo with hyphens in SSH format", () => {
      expect(parseGitHubRemote("git@github.com:my-org/my-repo.git")).toEqual({
        owner: "my-org",
        repo: "my-repo",
      });
    });
  });

  describe("SSH protocol URLs", () => {
    it("parses ssh:// URL with git@ prefix", () => {
      expect(parseGitHubRemote("ssh://git@github.com/owner/repo.git")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses ssh:// URL without git@ prefix", () => {
      expect(parseGitHubRemote("ssh://github.com/owner/repo.git")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses ssh:// URL without .git suffix", () => {
      expect(parseGitHubRemote("ssh://git@github.com/owner/repo")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("non-GitHub URLs — return null", () => {
    it("returns null for GitLab HTTPS URL", () => {
      expect(parseGitHubRemote("https://gitlab.com/owner/repo.git")).toBeNull();
    });

    it("returns null for GitLab SSH URL", () => {
      expect(parseGitHubRemote("git@gitlab.com:owner/repo.git")).toBeNull();
    });

    it("returns null for Bitbucket URL", () => {
      expect(parseGitHubRemote("https://bitbucket.org/owner/repo.git")).toBeNull();
    });

    it("returns null for self-hosted git URL", () => {
      expect(parseGitHubRemote("https://git.example.com/owner/repo.git")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseGitHubRemote("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(parseGitHubRemote("   ")).toBeNull();
    });

    it("returns null for malformed URL", () => {
      expect(parseGitHubRemote("not-a-url")).toBeNull();
    });

    it("returns null for URL missing repo part", () => {
      expect(parseGitHubRemote("https://github.com/owner")).toBeNull();
    });

    it("returns null for URL missing owner part", () => {
      expect(parseGitHubRemote("https://github.com/")).toBeNull();
    });
  });

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace", () => {
      expect(parseGitHubRemote("  https://github.com/owner/repo.git  ")).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });
  });
});

// ── getGitHubToken ────────────────────────────────────────────────────────

describe("getGitHubToken", () => {
  afterEach(() => {
    delete process.env.TEST_GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it("returns the token when env var is set", () => {
    process.env.TEST_GH_TOKEN = "ghp_abc123";
    expect(getGitHubToken("TEST_GH_TOKEN")).toBe("ghp_abc123");
  });

  it("trims whitespace from the token", () => {
    process.env.TEST_GH_TOKEN = "  ghp_abc123  ";
    expect(getGitHubToken("TEST_GH_TOKEN")).toBe("ghp_abc123");
  });

  it("returns null when env var is missing", () => {
    expect(getGitHubToken("TEST_GH_TOKEN")).toBeNull();
  });

  it("returns null when env var is empty string", () => {
    process.env.TEST_GH_TOKEN = "";
    expect(getGitHubToken("TEST_GH_TOKEN")).toBeNull();
  });

  it("returns null when env var is whitespace only", () => {
    process.env.TEST_GH_TOKEN = "   ";
    expect(getGitHubToken("TEST_GH_TOKEN")).toBeNull();
  });

  it("reads from GITHUB_TOKEN by default name", () => {
    process.env.GITHUB_TOKEN = "ghp_default";
    expect(getGitHubToken("GITHUB_TOKEN")).toBe("ghp_default");
  });

  it("reads from a custom env var name", () => {
    process.env.TEST_GH_TOKEN = "ghp_custom";
    expect(getGitHubToken("TEST_GH_TOKEN")).toBe("ghp_custom");
  });
});

// ── mapRunToBadge ─────────────────────────────────────────────────────────

describe("mapRunToBadge", () => {
  it('maps completed + success → "pass"', () => {
    expect(mapRunToBadge("completed", "success")).toBe("pass");
  });

  it('maps completed + failure → "fail"', () => {
    expect(mapRunToBadge("completed", "failure")).toBe("fail");
  });

  it('maps completed + cancelled → "fail"', () => {
    expect(mapRunToBadge("completed", "cancelled")).toBe("fail");
  });

  it('maps completed + timed_out → "fail"', () => {
    expect(mapRunToBadge("completed", "timed_out")).toBe("fail");
  });

  it('maps completed + startup_failure → "fail"', () => {
    expect(mapRunToBadge("completed", "startup_failure")).toBe("fail");
  });

  it('maps completed + skipped → "unknown"', () => {
    expect(mapRunToBadge("completed", "skipped")).toBe("unknown");
  });

  it('maps completed + neutral → "unknown"', () => {
    expect(mapRunToBadge("completed", "neutral")).toBe("unknown");
  });

  it('maps completed + action_required → "unknown"', () => {
    expect(mapRunToBadge("completed", "action_required")).toBe("unknown");
  });

  it('maps completed + null → "unknown"', () => {
    expect(mapRunToBadge("completed", null)).toBe("unknown");
  });

  it('maps in_progress → "running"', () => {
    expect(mapRunToBadge("in_progress", null)).toBe("running");
  });

  it('maps queued → "running"', () => {
    expect(mapRunToBadge("queued", null)).toBe("running");
  });

  it('maps waiting → "running"', () => {
    expect(mapRunToBadge("waiting", null)).toBe("running");
  });

  it('maps requested → "running"', () => {
    expect(mapRunToBadge("requested", null)).toBe("running");
  });

  it('maps pending → "running"', () => {
    expect(mapRunToBadge("pending", null)).toBe("running");
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
    headBranch: "main",
    event: "push",
    runNumber: 1,
    url: "https://github.com/owner/repo/actions/runs/1",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2024-01-01T01:00:00Z",
    runStartedAt: "2024-01-01T00:00:01Z",
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

// ── fetchWorkflowRuns (mocked fetch) ──────────────────────────────────────

function makeApiRun(overrides: Partial<GitHubApiRun> = {}): GitHubApiRun {
  return {
    id: 1,
    name: "CI",
    status: "completed",
    conclusion: "success",
    head_sha: "abc123",
    head_branch: "main",
    event: "push",
    run_number: 1,
    html_url: "https://github.com/owner/repo/actions/runs/1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T01:00:00Z",
    run_started_at: "2024-01-01T00:00:01Z",
    ...overrides,
  };
}

const TEST_REPO = { owner: "owner", repo: "repo" };
const TEST_TOKEN = "ghp_test";

/** Helper to assign a mock function as globalThis.fetch without TS complaining
 *  about the `preconnect` property that Bun adds to its native fetch. */
// biome-ignore lint/suspicious/noExplicitAny: intentional test helper cast
function mockFetch(fn: (...args: any[]) => Promise<Response>): void {
  // biome-ignore lint/suspicious/noExplicitAny: intentional test helper cast
  globalThis.fetch = fn as any;
}

describe("fetchWorkflowRuns", () => {
  afterEach(() => {
    // Reset global fetch mock
    globalThis.fetch = fetch;
  });

  it("returns mapped runs on successful response", async () => {
    mockFetch(
      mock(
        async () =>
          new Response(JSON.stringify({ workflow_runs: [makeApiRun()] }), {
            status: 200,
            headers: { etag: '"abc"' },
          }),
      ),
    );
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(result.changed).toBe(true);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].name).toBe("CI");
    expect(result.runs[0].headSha).toBe("abc123");
    expect(result.etag).toBe('"abc"');
  });

  it("sends If-None-Match header when etag is provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        capturedHeaders = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }),
    );
    await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN, { etag: '"cached-etag"' });
    expect(capturedHeaders["if-none-match"]).toBe('"cached-etag"');
  });

  it("returns changed=false with unchanged runs on 304", async () => {
    mockFetch(mock(async () => new Response(null, { status: 304 })));
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN, { etag: '"old-etag"' });
    expect(result.changed).toBe(false);
    expect(result.runs).toHaveLength(0);
    expect(result.etag).toBe('"old-etag"'); // preserves old etag
  });

  it("returns empty runs (no throw) on 401", async () => {
    mockFetch(mock(async () => new Response(null, { status: 401 })));
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(result.changed).toBe(true);
    expect(result.runs).toHaveLength(0);
  });

  it("returns empty runs (no throw) on 403", async () => {
    mockFetch(mock(async () => new Response(null, { status: 403 })));
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(result.runs).toHaveLength(0);
  });

  it("returns empty runs (no throw) on 404", async () => {
    mockFetch(mock(async () => new Response(null, { status: 404 })));
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(result.runs).toHaveLength(0);
  });

  it("returns empty runs (no throw) on network error", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("Network failure");
      }),
    );
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(result.changed).toBe(false);
    expect(result.runs).toHaveLength(0);
  });

  it("maps null run name to (unnamed)", async () => {
    mockFetch(
      mock(async () => new Response(JSON.stringify({ workflow_runs: [makeApiRun({ name: null })] }), { status: 200 })),
    );
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(result.runs[0].name).toBe("(unnamed)");
  });

  it("maps null head_branch to empty string", async () => {
    mockFetch(
      mock(
        async () =>
          new Response(JSON.stringify({ workflow_runs: [makeApiRun({ head_branch: null })] }), { status: 200 }),
      ),
    );
    const result = await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(result.runs[0].headBranch).toBe("");
  });

  it("sends correct Authorization header", async () => {
    let authHeader = "";
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        authHeader = new Headers(init.headers as HeadersInit).get("authorization") ?? "";
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }),
    );
    await fetchWorkflowRuns(TEST_REPO, TEST_TOKEN);
    expect(authHeader).toBe(`Bearer ${TEST_TOKEN}`);
  });
});

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
      { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
      { name: "Build", status: "completed", conclusion: "success", number: 2 },
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
    const jobs = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 123);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("build");
    expect(jobs[0].steps).toHaveLength(2);
    expect(jobs[0].steps[0].name).toBe("Checkout");
    expect(jobs[0].steps[1].number).toBe(2);
  });

  it("returns empty array (no throw) on 404", async () => {
    mockFetch(mock(async () => new Response(null, { status: 404 })));
    const jobs = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 999);
    expect(jobs).toHaveLength(0);
  });

  it("returns empty array (no throw) on network error", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("Network failure");
      }),
    );
    const jobs = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 123);
    expect(jobs).toHaveLength(0);
  });

  it("handles missing steps array gracefully", async () => {
    const jobWithoutSteps = { ...makeApiJob(), steps: undefined as unknown as [] };
    mockFetch(mock(async () => new Response(JSON.stringify({ jobs: [jobWithoutSteps] }), { status: 200 })));
    const jobs = await fetchRunJobs(TEST_REPO, TEST_TOKEN, 123);
    expect(jobs[0].steps).toEqual([]);
  });
});

// ── fetchCIDataGraphQL ────────────────────────────────────────────────────

/** Build a minimal valid GraphQL CI response. */
function makeGqlResponse(
  commits: Array<{
    sha: string;
    suites: Array<{
      status?: string;
      conclusion?: string | null;
      wfRunId?: number;
      wfRunNumber?: number;
      wfName?: string;
      event?: string;
      url?: string;
      checkRuns?: Array<{ id?: number; name?: string; status?: string; conclusion?: string | null }>;
    }>;
  }>,
) {
  return {
    data: {
      repository: {
        ref: {
          target: {
            history: {
              nodes: commits.map(c => ({
                oid: c.sha,
                checkSuites: {
                  nodes: c.suites.map(s => ({
                    status: s.status ?? "COMPLETED",
                    conclusion: s.conclusion !== undefined ? s.conclusion : "SUCCESS",
                    updatedAt: "2024-01-02T00:00:00Z",
                    createdAt: "2024-01-01T00:00:00Z",
                    workflowRun:
                      s.wfRunId !== undefined
                        ? {
                            databaseId: s.wfRunId,
                            runNumber: s.wfRunNumber ?? 1,
                            event: s.event ?? "push",
                            url: s.url ?? "https://github.com/owner/repo/actions/runs/1",
                            createdAt: "2024-01-01T00:00:00Z",
                            updatedAt: "2024-01-02T00:00:00Z",
                            workflow: { name: s.wfName ?? "CI" },
                          }
                        : null,
                    checkRuns: {
                      nodes: (s.checkRuns ?? []).map(cr => ({
                        databaseId: cr.id ?? 10,
                        name: cr.name ?? "build",
                        status: cr.status ?? "COMPLETED",
                        conclusion: cr.conclusion ?? "SUCCESS",
                        startedAt: "2024-01-01T00:00:00Z",
                        completedAt: "2024-01-01T00:01:00Z",
                        steps: { nodes: [] },
                      })),
                    },
                  })),
                },
              })),
            },
          },
        },
      },
    },
  };
}

describe("fetchCIDataGraphQL", () => {
  afterEach(() => {
    globalThis.fetch = fetch;
  });

  it("returns runs and pre-populated jobs for two commits", async () => {
    const response = makeGqlResponse([
      {
        sha: "aaa",
        suites: [{ wfRunId: 1, wfName: "CI", checkRuns: [{ id: 10, name: "build" }] }],
      },
      {
        sha: "bbb",
        suites: [
          {
            wfRunId: 2,
            wfName: "Deploy",
            status: "IN_PROGRESS",
            conclusion: null,
            checkRuns: [{ id: 20, name: "deploy" }],
          },
        ],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");

    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].headSha).toBe("aaa");
    expect(result.runs[0].name).toBe("CI");
    expect(result.runs[0].status).toBe("completed");
    expect(result.runs[0].conclusion).toBe("success");
    expect(result.runs[1].headSha).toBe("bbb");
    expect(result.runs[1].status).toBe("in_progress");
    expect(result.runs[1].conclusion).toBeNull();

    // Jobs should be pre-populated
    expect(result.jobsByRunId.get(1)).toHaveLength(1);
    expect(result.jobsByRunId.get(1)?.[0].name).toBe("build");
    expect(result.jobsByRunId.get(2)).toHaveLength(1);
    expect(result.jobsByRunId.get(2)?.[0].name).toBe("deploy");
  });

  it("skips check suites with no workflowRun (non-Actions checks)", async () => {
    const response = makeGqlResponse([
      {
        sha: "ccc",
        suites: [
          { wfRunId: undefined as unknown as number }, // no workflowRun
          { wfRunId: 5, wfName: "CI" },
        ],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].id).toBe(5);
  });

  it("normalises UPPER_SNAKE_CASE status/conclusion to lower_snake_case", async () => {
    const response = makeGqlResponse([
      {
        sha: "ddd",
        suites: [{ wfRunId: 7, status: "COMPLETED", conclusion: "FAILURE" }],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(result.runs[0].status).toBe("completed");
    expect(result.runs[0].conclusion).toBe("failure");
  });

  it("returns empty result on HTTP error (graceful degradation)", async () => {
    mockFetch(mock(async () => new Response(null, { status: 403 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(result.runs).toHaveLength(0);
    expect(result.jobsByRunId.size).toBe(0);
  });

  it("returns empty result on GraphQL errors field", async () => {
    const response = { errors: [{ message: "Not Found" }] };
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(result.runs).toHaveLength(0);
  });

  it("returns empty result on network error", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("Network failure");
      }),
    );
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(result.runs).toHaveLength(0);
  });

  it("handles empty commit history gracefully", async () => {
    const response = makeGqlResponse([]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(result.runs).toHaveLength(0);
    expect(result.jobsByRunId.size).toBe(0);
  });

  it("handles missing ref (branch not found) gracefully", async () => {
    const response = { data: { repository: { ref: null } } };
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "nonexistent-branch");
    expect(result.runs).toHaveLength(0);
  });

  it("sends POST to GraphQL endpoint with correct body", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    mockFetch(
      mock(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify(makeGqlResponse([])), { status: 200 });
      }),
    );
    await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main", { count: 30 });
    expect(capturedUrl).toBe("https://api.github.com/graphql");
    expect((capturedBody.variables as Record<string, unknown>)?.owner).toBe("owner");
    expect((capturedBody.variables as Record<string, unknown>)?.repo).toBe("repo");
    expect((capturedBody.variables as Record<string, unknown>)?.branch).toBe("main");
    expect((capturedBody.variables as Record<string, unknown>)?.count).toBe(30);
  });

  it("sends Authorization Bearer header", async () => {
    let authHeader = "";
    mockFetch(
      mock(async (_url: string, init: RequestInit) => {
        authHeader = new Headers(init.headers as HeadersInit).get("authorization") ?? "";
        return new Response(JSON.stringify(makeGqlResponse([])), { status: 200 });
      }),
    );
    await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(authHeader).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it("maps check run steps correctly", async () => {
    const response = makeGqlResponse([
      {
        sha: "eee",
        suites: [
          {
            wfRunId: 9,
            checkRuns: [
              {
                id: 30,
                name: "test",
              },
            ],
          },
        ],
      },
    ]);
    // Add steps to the check run node
    const suite = response.data.repository.ref.target.history.nodes[0].checkSuites.nodes[0];
    (suite.checkRuns.nodes[0] as Record<string, unknown>).steps = {
      nodes: [
        { name: "Checkout", status: "COMPLETED", conclusion: "SUCCESS", number: 1 },
        { name: "Run tests", status: "COMPLETED", conclusion: "FAILURE", number: 2 },
      ],
    };
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    const jobs = result.jobsByRunId.get(9);
    expect(jobs?.[0].steps).toHaveLength(2);
    expect(jobs?.[0].steps[0].name).toBe("Checkout");
    expect(jobs?.[0].steps[1].conclusion).toBe("failure");
    expect(jobs?.[0].steps[1].number).toBe(2);
  });

  it("maps multiple runs per commit to separate entries in runs array", async () => {
    const response = makeGqlResponse([
      {
        sha: "fff",
        suites: [
          { wfRunId: 100, wfName: "CI" },
          { wfRunId: 101, wfName: "Deploy" },
          { wfRunId: 102, wfName: "Lint" },
        ],
      },
    ]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataGraphQL(TEST_REPO, TEST_TOKEN, "main");
    expect(result.runs).toHaveLength(3);
    const shas = result.runs.map(r => r.headSha);
    expect(shas).toEqual(["fff", "fff", "fff"]);
    const names = result.runs.map(r => r.name);
    expect(names).toContain("CI");
    expect(names).toContain("Deploy");
    expect(names).toContain("Lint");
  });
});
