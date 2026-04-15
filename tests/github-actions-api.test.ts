import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  aggregateRunsToGraphBadge,
  buildCommitDataMap,
  buildGraphBadges,
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
