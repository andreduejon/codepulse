import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  aggregateRunsToGraphBadge,
  buildCommitDataMap,
  buildGraphBadges,
  fetchCIDataForSHAs,
  fetchRunJobs,
  GQL_BATCH_SIZE,
  getCachedGhAuthToken,
  getGitHubToken,
  getTokenSource,
  mapRunToBadge,
  parseGitHubRemote,
  resolveGhAuthToken,
} from "../src/providers/github-actions/api";
import type { GitHubApiJob } from "../src/providers/github-actions/types";

// ── parseGitHubRemote ─────────────────────────────────────────────────────

describe("parseGitHubRemote", () => {
  describe("HTTPS URLs", () => {
    it("parses standard HTTPS URL with .git suffix", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo.git")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses HTTPS URL without .git suffix", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses HTTPS URL with trailing slash", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo/")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses HTTPS URL with .git and trailing slash", () => {
      expect(parseGitHubRemote("https://github.com/owner/repo.git/")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("handles org names with hyphens", () => {
      expect(parseGitHubRemote("https://github.com/my-org/my-repo.git")).toEqual({
        hostname: "github.com",
        owner: "my-org",
        repo: "my-repo",
      });
    });

    it("handles org names with underscores and dots", () => {
      expect(parseGitHubRemote("https://github.com/my_org/my.repo")).toEqual({
        hostname: "github.com",
        owner: "my_org",
        repo: "my.repo",
      });
    });

    it("is case-insensitive for the domain", () => {
      expect(parseGitHubRemote("https://GitHub.COM/Owner/Repo.git")).toEqual({
        hostname: "GitHub.COM",
        owner: "Owner",
        repo: "Repo",
      });
    });

    it("parses GitHub Enterprise HTTPS URL", () => {
      expect(parseGitHubRemote("https://github.example.com/owner/repo.git")).toEqual({
        hostname: "github.example.com",
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("SSH scp-style URLs", () => {
    it("parses git@ SSH URL with .git suffix", () => {
      expect(parseGitHubRemote("git@github.com:owner/repo.git")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses git@ SSH URL without .git suffix", () => {
      expect(parseGitHubRemote("git@github.com:owner/repo")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("handles org/repo with hyphens in SSH format", () => {
      expect(parseGitHubRemote("git@github.com:my-org/my-repo.git")).toEqual({
        hostname: "github.com",
        owner: "my-org",
        repo: "my-repo",
      });
    });

    it("parses GitHub Enterprise SSH URL", () => {
      expect(parseGitHubRemote("git@github.example.com:owner/repo.git")).toEqual({
        hostname: "github.example.com",
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("SSH protocol URLs", () => {
    it("parses ssh:// URL with git@ prefix", () => {
      expect(parseGitHubRemote("ssh://git@github.com/owner/repo.git")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses ssh:// URL without git@ prefix", () => {
      expect(parseGitHubRemote("ssh://github.com/owner/repo.git")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses ssh:// URL without .git suffix", () => {
      expect(parseGitHubRemote("ssh://git@github.com/owner/repo")).toEqual({
        hostname: "github.com",
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("non-GitHub hosted services — parsed with their hostname", () => {
    it("parses GitLab HTTPS URL (hostname=gitlab.com)", () => {
      expect(parseGitHubRemote("https://gitlab.com/owner/repo.git")).toEqual({
        hostname: "gitlab.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses GitLab SSH URL (hostname=gitlab.com)", () => {
      expect(parseGitHubRemote("git@gitlab.com:owner/repo.git")).toEqual({
        hostname: "gitlab.com",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses Bitbucket URL (hostname=bitbucket.org)", () => {
      expect(parseGitHubRemote("https://bitbucket.org/owner/repo.git")).toEqual({
        hostname: "bitbucket.org",
        owner: "owner",
        repo: "repo",
      });
    });

    it("parses self-hosted git URL", () => {
      expect(parseGitHubRemote("https://git.example.com/owner/repo.git")).toEqual({
        hostname: "git.example.com",
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("malformed URLs — return null", () => {
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
        hostname: "github.com",
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

  it("returns gh auth cache token when env var is missing and hostname is provided", async () => {
    // Pre-warm the cache for this hostname using resolveGhAuthToken
    const origSpawn = Bun.spawn;
    const fakeToken = "ghs_fromghauth";
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => ({
      exited: Promise.resolve(0),
      stdout: new Blob([fakeToken]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    try {
      await resolveGhAuthToken("test-ghauth-fallback.example.com");
      delete process.env.TEST_GH_TOKEN;
      expect(getGitHubToken("TEST_GH_TOKEN", "test-ghauth-fallback.example.com")).toBe(fakeToken);
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
  });

  it("prefers env var over gh auth cache token", async () => {
    process.env.TEST_GH_TOKEN = "ghp_envtoken";
    // Even if gh auth cache has a token, env var wins
    expect(getGitHubToken("TEST_GH_TOKEN", "github.com")).toBe("ghp_envtoken");
  });

  it("returns null when env var is missing and no hostname is provided", () => {
    delete process.env.TEST_GH_TOKEN;
    expect(getGitHubToken("TEST_GH_TOKEN")).toBeNull();
  });
});

// ── resolveGhAuthToken ────────────────────────────────────────────────────

describe("resolveGhAuthToken", () => {
  it("returns token from gh auth when process exits 0", async () => {
    const origSpawn = Bun.spawn;
    const fakeToken = "ghs_abc123resolved";
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => ({
      exited: Promise.resolve(0),
      stdout: new Blob([`${fakeToken}\n`]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    try {
      const result = await resolveGhAuthToken("resolve-test-success.example.com");
      expect(result).toBe(fakeToken);
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
  });

  it("returns null when gh exits with non-zero code", async () => {
    const origSpawn = Bun.spawn;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => ({
      exited: Promise.resolve(1),
      stdout: new Blob([""]).stream(),
      stderr: new Blob(["not logged in"]).stream(),
    }));
    try {
      const result = await resolveGhAuthToken("resolve-test-fail.example.com");
      expect(result).toBeNull();
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
  });

  it("returns null and does not throw when gh spawn throws", async () => {
    const origSpawn = Bun.spawn;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock(() => {
      throw new Error("gh not found");
    });
    try {
      const result = await resolveGhAuthToken("resolve-test-throw.example.com");
      expect(result).toBeNull();
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
  });

  it("caches result — second call does not invoke Bun.spawn again", async () => {
    const origSpawn = Bun.spawn;
    let callCount = 0;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => {
      callCount++;
      return {
        exited: Promise.resolve(0),
        stdout: new Blob(["ghs_cached"]).stream(),
        stderr: new Blob([""]).stream(),
      };
    });
    try {
      const hostname = "resolve-test-cache.example.com";
      await resolveGhAuthToken(hostname);
      await resolveGhAuthToken(hostname);
      expect(callCount).toBe(1);
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
  });

  it("returns null for empty stdout (whitespace only)", async () => {
    const origSpawn = Bun.spawn;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => ({
      exited: Promise.resolve(0),
      stdout: new Blob(["   \n"]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    try {
      const result = await resolveGhAuthToken("resolve-test-empty.example.com");
      expect(result).toBeNull();
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
  });
});

// ── getCachedGhAuthToken ──────────────────────────────────────────────────

describe("getCachedGhAuthToken", () => {
  it("returns null for a hostname that has never been resolved", () => {
    expect(getCachedGhAuthToken("never-seen-hostname.example.com")).toBeNull();
  });

  it("returns the cached token after resolveGhAuthToken succeeds", async () => {
    const origSpawn = Bun.spawn;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => ({
      exited: Promise.resolve(0),
      stdout: new Blob(["ghs_cached_check"]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    try {
      await resolveGhAuthToken("cached-check.example.com");
      expect(getCachedGhAuthToken("cached-check.example.com")).toBe("ghs_cached_check");
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
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

  it('returns "env" even when gh auth cache also has a token', async () => {
    // Pre-warm a cache entry
    const origSpawn = Bun.spawn;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => ({
      exited: Promise.resolve(0),
      stdout: new Blob(["ghs_tok"]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    try {
      await resolveGhAuthToken("tokensrc-both.example.com");
      process.env.TEST_TOKEN_SRC = "ghp_envpriority";
      expect(getTokenSource("TEST_TOKEN_SRC", "tokensrc-both.example.com")).toBe("env");
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
      delete process.env.TEST_TOKEN_SRC;
    }
  });

  it('returns "gh auth" when env var is unset but gh auth cache has a token', async () => {
    const origSpawn = Bun.spawn;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    (Bun as any).spawn = mock((_args: string[]) => ({
      exited: Promise.resolve(0),
      stdout: new Blob(["ghs_ghauth"]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    try {
      delete process.env.TEST_TOKEN_SRC;
      await resolveGhAuthToken("tokensrc-ghauth.example.com");
      expect(getTokenSource("TEST_TOKEN_SRC", "tokensrc-ghauth.example.com")).toBe("gh auth");
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (Bun as any).spawn = origSpawn;
    }
  });

  it("returns null when neither env var nor gh auth cache has a token", () => {
    delete process.env.TEST_TOKEN_SRC;
    expect(getTokenSource("TEST_TOKEN_SRC", "no-token-anywhere.example.com")).toBeNull();
  });

  it("returns null when env var is whitespace only and no hostname given", () => {
    process.env.TEST_TOKEN_SRC = "   ";
    expect(getTokenSource("TEST_TOKEN_SRC")).toBeNull();
  });

  it("returns null when no hostname is provided and env var is unset", () => {
    delete process.env.TEST_TOKEN_SRC;
    expect(getTokenSource("TEST_TOKEN_SRC")).toBeNull();
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
    }>;
  }>,
) {
  const repository: Record<string, unknown> = {};
  commits.forEach((c, i) => {
    repository[`c${i}`] = {
      oid: c.sha,
      checkSuites: {
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

    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].headSha).toBe("aaa");
    expect(result.runs[0].name).toBe("CI");
    expect(result.runs[0].status).toBe("completed");
    expect(result.runs[0].conclusion).toBe("success");
    expect(result.runs[1].headSha).toBe("bbb");
    expect(result.runs[1].status).toBe("in_progress");
    expect(result.runs[1].conclusion).toBeNull();
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
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].id).toBe(5);
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
    expect(result.runs[0].status).toBe("completed");
    expect(result.runs[0].conclusion).toBe("failure");
  });

  it("returns empty result on HTTP error (graceful degradation)", async () => {
    mockFetch(mock(async () => new Response(null, { status: 403 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.runs).toHaveLength(0);
    expect(result.error).toBeTruthy();
  });

  it("returns empty result on GraphQL errors field", async () => {
    const response = { errors: [{ message: "Not Found" }] };
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.runs).toHaveLength(0);
  });

  it("returns empty result on network error", async () => {
    mockFetch(
      mock(async () => {
        throw new Error("Network failure");
      }),
    );
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["abc"]);
    expect(result.runs).toHaveLength(0);
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
    expect(result.runs).toHaveLength(0);
    expect(fetchCalled).toBe(false);
  });

  it("handles commits with no check suites gracefully", async () => {
    const response = makeBatchResponse([{ sha: "eee", suites: [] }]);
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["eee"]);
    expect(result.runs).toHaveLength(0);
  });

  it("handles a SHA not found in repository (null alias) gracefully", async () => {
    // GitHub returns null for an unknown object oid
    const response = { data: { repository: { c0: null } } };
    mockFetch(mock(async () => new Response(JSON.stringify(response), { status: 200 })));
    const result = await fetchCIDataForSHAs(TEST_REPO, TEST_TOKEN, ["unknown-sha"]);
    expect(result.runs).toHaveLength(0);
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
    expect(result.runs).toHaveLength(3);
    expect(result.runs.every(r => r.headSha === "ggg")).toBe(true);
    const names = result.runs.map(r => r.name);
    expect(names).toContain("CI");
    expect(names).toContain("Deploy");
    expect(names).toContain("Lint");
  });

  it("exports GQL_BATCH_SIZE as a positive integer", () => {
    expect(typeof GQL_BATCH_SIZE).toBe("number");
    expect(GQL_BATCH_SIZE).toBeGreaterThan(0);
  });
});
