/**
 * The GitHub service with its lifecycle, without Solid: the app is a plain object, GitHub and the cache are fakes.
 */
import { expect, mock, test } from "bun:test";
import type { ProviderStatus } from "../../context/app-state-types";
import { BANNER } from "../../debug/banner";
import type { GraphRow } from "../../git/types";
import type { GitHubCacheEntry } from "../../providers/github-actions/merge";
import type { GitHubJob, GitHubRepo, GitHubWorkflowRun } from "../../providers/github-actions/types";
import { DEFAULT_GITHUB_CONFIG } from "../../providers/github-actions/types";
import type { GraphBadge } from "../../providers/provider";
import { FetchLifecycle } from "../fetch-lifecycle";
import { createGitHubService, type GitHubApiPort, type GitHubCachePort } from "./service";

const SHA = "a".repeat(40);
const REPO: GitHubRepo = { owner: "o", repo: "r", hostname: "github.com" } as GitHubRepo;

const run = (overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun =>
  ({
    id: 7,
    name: "CI",
    status: "completed",
    conclusion: "success",
    headSha: SHA,
    event: "push",
    runNumber: 12,
    startedAt: "2026-03-02T09:00:00Z",
    updatedAt: "2026-03-02T09:05:00Z",
    url: "https://github.com/o/r/actions/runs/7",
    ...overrides,
  }) as GitHubWorkflowRun;

const job: GitHubJob = {
  id: 70,
  name: "build",
  status: "completed",
  conclusion: "success",
  startedAt: "2026-03-02T09:00:00Z",
  completedAt: "2026-03-02T09:04:00Z",
  steps: [],
  runAttempt: 1,
} as GitHubJob;

function harness() {
  const app = {
    repoPath: "/repo",
    rows: [{ commit: { hash: SHA, refs: [] } }] as unknown as GraphRow[],
    status: { kind: "idle" } as ProviderStatus,
    badges: new Map<string, GraphBadge>(),
  };
  const saved = new Map<string, GitHubCacheEntry>();
  const cache: GitHubCachePort = {
    read: async (_repo, sha) => saved.get(sha) ?? null,
    peekAll: async () => [...saved.values()],
    readLog: async () => null,
    writeLog: async () => {},
    mergeMany: async (_repo, items, merge) => {
      for (const item of items) saved.set(item.sha, merge(item.sha, saved.get(item.sha) ?? null, [...item.incoming]));
      return items.length;
    },
  };
  let answer: { data: GitHubWorkflowRun[]; error: string | null } = { data: [run()], error: null };
  const api = {
    fetchCIDataForSHAs: mock(async () => ({ ...answer, jobs: new Map() })),
    fetchRunJobs: mock(async () => ({ jobs: [job], error: null })),
    fetchJobAnnotations: mock(async () => []),
    fetchJobLog: mock(async () => "log"),
  };
  let lifecycle!: FetchLifecycle;
  const service = createGitHubService({
    app: {
      repoPath: () => app.repoPath,
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
      view: () => "github-actions",
    },
    api: api as unknown as GitHubApiPort,
    cache: () => cache,
    config: () => ({ ...DEFAULT_GITHUB_CONFIG, enabled: true }),
    repo: () => REPO,
    parsedRepo: () => REPO,
    token: () => "token",
    lifecycle: () => lifecycle,
    onDataChange: () => {},
  });
  lifecycle = new FetchLifecycle(
    {
      view: () => "github-actions",
      repoPath: () => app.repoPath,
      graphRows: () => app.rows,
      autoRefreshInterval: () => 0,
      suspended: () => false,
      untracked: fn => fn(),
      onReset: () => {},
      onActiveFetches: () => {},
    },
    { providerId: "github-actions", isBackgroundReady: () => true, skipShaBackground: true, ...service },
  );
  return {
    app,
    saved,
    api,
    service,
    lifecycle,
    answer: (next: typeof answer) => {
      answer = next;
    },
  };
}

test("a first fetch asks GitHub about the graph's commits, shows their runs and badges, and saves the finished ones", async () => {
  const h = harness();
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.api.fetchCIDataForSHAs).toHaveBeenCalledTimes(1);
  expect(h.service.getCommitData(SHA)?.runs.map(r => r.id)).toEqual([7]);
  expect(h.app.badges.get(SHA)?.badge).toBe("pass");
  expect(h.app.status.kind).toBe("idle");
  expect(h.saved.get(SHA)?.runs.map(r => r.id)).toEqual([7]);
});

test("an expired token stops automatic requests until a Reload", async () => {
  const h = harness();
  h.answer({ data: [], error: BANNER.github.tokenExpired });
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.app.status).toEqual({ kind: "error", message: BANNER.github.tokenExpired });
  h.answer({ data: [run()], error: null });
  // Automatic: frozen, GitHub is not asked.
  await h.lifecycle.fetchRefresh(undefined, true, false);
  expect(h.api.fetchCIDataForSHAs).toHaveBeenCalledTimes(1);
  // Reload: asked again, and the runs show.
  await h.lifecycle.fetchRefresh(undefined, true, true);
  expect(h.api.fetchCIDataForSHAs).toHaveBeenCalledTimes(2);
  expect(h.service.getCommitData(SHA)?.runs).toHaveLength(1);
  expect(h.app.status.kind).toBe("idle");
});

test("a finished run's jobs are read from GitHub once, then kept", async () => {
  const h = harness();
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  const first = await h.service.fetchJobsForRun(run());
  const second = await h.service.fetchJobsForRun(run());
  expect(first.jobs.map(j => j.id)).toEqual([70]);
  expect(second.jobs.map(j => j.id)).toEqual([70]);
  expect(h.api.fetchRunJobs).toHaveBeenCalledTimes(1);
  expect(h.saved.get(SHA)?.jobs?.["7"]?.map(j => j.id)).toEqual([70]);
});
