/** The Jenkins service with its lifecycle, without Solid: the app is a plain object, Jenkins and the cache are fakes. */
import { expect, mock, test } from "bun:test";
import { BANNER } from "../banner";
import { FetchLifecycle } from "../fetch-lifecycle";
import type { GraphRow } from "../git/types";
import type { GraphBadge } from "../provider-model";
import type { ProviderStatus } from "../provider-status";
import type { JenkinsCacheEntry } from "./merge";
import { createJenkinsService, type JenkinsApiPort, type JenkinsCachePort } from "./service";
import type { JenkinsRun } from "./types";
import { DEFAULT_JENKINS_CONFIG } from "./types";

const SHA = "b".repeat(40);
const JOB = "https://jenkins.example.com/job/app/";
const build: JenkinsRun = {
  id: `${JOB}#3`,
  name: "app",
  status: "completed",
  conclusion: "success",
  headSha: SHA,
  runNumber: 3,
  startedAt: "2026-03-02T09:00:00Z",
  updatedAt: "2026-03-02T09:05:00Z",
  url: `${JOB}3/`,
  jobLabel: "app",
  jobUrl: JOB,
};

function harness() {
  const app = {
    status: { kind: "idle" } as ProviderStatus,
    badges: new Map<string, GraphBadge>(),
    rows: [{ commit: { hash: SHA, refs: [] } }] as unknown as GraphRow[],
  };
  const saved = new Map<string, JenkinsCacheEntry>();
  const logs = new Map<string, string>();
  const cache: JenkinsCachePort = {
    read: async (_repo, sha) => saved.get(sha) ?? null,
    peekAll: async () => [...saved.values()],
    readLog: async (_repo, sha, key) => logs.get(`${sha}:${key}`) ?? null,
    writeLog: async (_repo, sha, key, log) => {
      logs.set(`${sha}:${key}`, log);
    },
    mergeMany: async (_repo, items, merge) => {
      for (const item of items) saved.set(item.sha, merge(item.sha, saved.get(item.sha) ?? null, [...item.incoming]));
      return items.length;
    },
  };
  let error: string | null = null;
  const listed = () => ({
    data: error ? [] : [build],
    error,
    failure: error ? ("auth" as const) : undefined,
    jobUrls: [JOB],
    discoveryComplete: true,
    discoveryTruncated: false,
    branchJobs: { shown: 1, total: 1 },
    lastBuilds: new Map([[JOB, 3]]),
  });
  const api = {
    fetchJenkinsGraphDataForSHAs: mock(async () => listed()),
    fetchJenkinsDataForSHAs: mock(async () => listed()),
    fetchJenkinsRunsForBuilds: mock(async () => ({ data: [], error: null })),
    fetchJenkinsRunJobs: mock(async () => ({ jobs: [], error: null })),
    fetchJenkinsConsoleLog: mock(async () => "log"),
  };
  let lifecycle!: FetchLifecycle;
  const service = createJenkinsService({
    app: {
      repoPath: () => "/repo",
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
      view: () => "jenkins",
    },
    api: api as unknown as JenkinsApiPort,
    cache: () => cache,
    config: () => ({ ...DEFAULT_JENKINS_CONFIG, enabled: true, username: "user", jobs: [{ url: JOB }] }),
    token: () => "token",
    lifecycle: () => lifecycle,
    onDataChange: () => {},
  });
  lifecycle = new FetchLifecycle(
    {
      view: () => "jenkins",
      repoPath: () => "/repo",
      graphRows: () => app.rows,
      autoRefreshInterval: () => 0,
      suspended: () => false,
      untracked: fn => fn(),
      onReset: () => {},
      onActiveFetches: () => {},
    },
    { providerId: "jenkins", isBackgroundReady: () => true, skipShaBackground: true, ...service },
  );
  return {
    app,
    saved,
    logs,
    api,
    service,
    lifecycle,
    fail: (next: string | null) => {
      error = next;
    },
  };
}

test("a first fetch shows the commit's builds and badge, and saves the finished ones", async () => {
  const h = harness();
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.service.getCommitData(SHA)?.runs.map(run => run.runNumber)).toEqual([3]);
  expect(h.app.badges.get(SHA)?.badge).toBe("pass");
  expect(h.saved.get(SHA)?.runs).toHaveLength(1);
  expect(h.app.status.kind).toBe("idle");
});

test("an authentication failure stops automatic requests until a Reload", async () => {
  const h = harness();
  h.fail(BANNER.jenkins.authFailed);
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(h.app.status).toEqual({ kind: "error", message: BANNER.jenkins.authFailed });
  h.fail(null);
  await h.lifecycle.fetchRefresh(undefined, true, false);
  expect(h.api.fetchJenkinsGraphDataForSHAs).toHaveBeenCalledTimes(1);
  await h.service.refreshWindow();
  expect(h.api.fetchJenkinsGraphDataForSHAs).toHaveBeenCalledTimes(2);
  expect(h.service.getCommitData(SHA)?.runs).toHaveLength(1);
});

test("a finished build's log is kept in the cache, not in memory: once the cache lost it, Jenkins is asked again", async () => {
  const h = harness();
  await h.lifecycle.fetchInitial(undefined, undefined, true);
  expect(await h.service.fetchRunLog(build)).toBe("log");
  expect(await h.service.fetchRunLog(build)).toBe("log");
  // The second open read the cache.
  expect(h.api.fetchJenkinsConsoleLog).toHaveBeenCalledTimes(1);
  expect(h.logs.get(`${SHA}:${build.id}`)).toBe("log");
  // Evicted (the cache screen, or its limit): asked again.
  h.logs.clear();
  expect(await h.service.fetchRunLog(build)).toBe("log");
  expect(h.api.fetchJenkinsConsoleLog).toHaveBeenCalledTimes(2);
});
