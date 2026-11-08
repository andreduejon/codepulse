import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { createAppState } from "../../context/state";
import { BANNER } from "../../debug/banner";
import { buildGraph } from "../../git/graph";
import { closeProviderCaches } from "../shared/sha-sqlite-cache";
import * as api from "./api";
import type { GitHubWorkflowRun } from "./types";
import { useGitHubCI } from "./use-github-ci";

const SHA = "e".repeat(40);
const TOKEN_ENV = "CODEPULSE_TEST_GITHUB_TOKEN";

const run = (overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun =>
  ({
    id: 11,
    name: "CI",
    status: "in_progress",
    conclusion: null,
    headSha: SHA,
    runNumber: 3,
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:01:00Z",
    url: "https://github.com/o/r/actions/runs/11",
    ...overrides,
  }) as GitHubWorkflowRun;

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

const settle = async (until: () => boolean = () => true) => {
  for (let i = 0; i < 100 && !until(); i++) await Bun.sleep(5);
  await Bun.sleep(5);
};

async function mountGitHub() {
  const original = process.env[TOKEN_ENV];
  process.env[TOKEN_ENV] = "test-token";
  cleanup.push(() => {
    if (original === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = original;
  });
  const root = await mkdtemp(join(tmpdir(), "codepulse-github-hook-"));
  cleanup.push(async () => {
    closeProviderCaches();
    await rm(root, { recursive: true, force: true });
  });
  const ci = spyOn(api, "fetchCIDataForSHAs").mockResolvedValue({ data: [run()], jobs: new Map(), error: null });
  cleanup.push(() => ci.mockRestore());
  let mounted!: {
    state: ReturnType<typeof createAppState>["state"];
    actions: ReturnType<typeof createAppState>["actions"];
    github: ReturnType<typeof useGitHubCI>;
  };
  createRoot(dispose => {
    cleanup.push(dispose);
    const { state, actions } = createAppState();
    actions.setRepoPath("/repo/github-hook");
    actions.setRemoteUrl("https://github.com/o/r.git");
    actions.setActiveProviderView("github-actions");
    actions.setGraphRows(
      buildGraph([
        {
          hash: SHA,
          shortHash: SHA.slice(0, 7),
          parents: [],
          subject: "ci",
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
    const github = useGitHubCI({
      state,
      actions,
      cacheRoot: root,
      config: { enabled: true, tokenEnvVar: TOKEN_ENV, autoRefreshSeconds: 0 },
    });
    mounted = { state, actions, github };
  });
  return { ...mounted, ci };
}

test("a failed refresh of running runs shows its error, like Jenkins, instead of only reaching Debug", async () => {
  const { github, state, actions, ci } = await mountGitHub();
  await github.refresh();
  await settle(() => state.graphBadges().size > 0);
  expect(state.providerStatusFor("github-actions").kind).toBe("idle");
  ci.mockResolvedValue({ data: [], jobs: new Map(), error: BANNER.github.fetchFailed });
  // Re-enter the view after the stale threshold: the running SHA is refreshed automatically.
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  try {
    const calls = ci.mock.calls.length;
    actions.setActiveProviderView("git");
    actions.setActiveProviderView("github-actions");
    await settle(() => ci.mock.calls.length > calls);
    await settle(() => state.providerStatusFor("github-actions").kind === "error");
    expect(state.providerStatusFor("github-actions")).toEqual({ kind: "error", message: BANNER.github.fetchFailed });
  } finally {
    clock.mockRestore();
  }
});

test("entering the GitHub view before the remote is known fetches once the remote arrives, without a stale banner", async () => {
  const { state, actions, ci } = await mountGitHub();
  await settle(() => ci.mock.calls.length > 0);
  const calls = ci.mock.calls.length;
  // Like a repository switch while in the GitHub view: no remote yet, then the loader sets it.
  actions.setRemoteUrl("");
  actions.setRepoPath("/repo/github-hook-2");
  await settle();
  actions.setRemoteUrl("https://github.com/o/r2.git");
  await settle(() => ci.mock.calls.length > calls);
  expect(ci.mock.calls.length).toBeGreaterThan(calls);
  await settle(() => state.providerStatusFor("github-actions").kind !== "unavailable");
  expect(state.providerStatusFor("github-actions").kind).not.toBe("unavailable");
});

test("leaving the view while its first fetch runs does not leave GitHub loading forever", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const { state, actions, ci } = await mountGitHub();
  // The view-entry fetch reaches the API only after reading the disk cache, so this replaces it in time.
  ci.mockImplementation(async () => {
    await gate;
    return { data: [run({ status: "completed", conclusion: "success" })], jobs: new Map(), error: null };
  });
  await settle(() => state.providerStatusFor("github-actions").kind === "loading");
  expect(state.providerStatusFor("github-actions").kind).toBe("loading");
  actions.setActiveProviderView("git");
  release();
  await settle();
  actions.setActiveProviderView("github-actions");
  await settle(() => state.providerStatusFor("github-actions").kind !== "loading");
  expect(state.providerStatusFor("github-actions").kind).not.toBe("loading");
});

test("a Reload queued behind a running fetch still reloads its commit, even outside the graph window", async () => {
  const { github, state, ci } = await mountGitHub();
  await settle(() => ci.mock.calls.length > 0 && state.providerStatusFor("github-actions").kind !== "loading");
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  ci.mockImplementationOnce(async () => {
    await gate;
    return { data: [run({ status: "completed", conclusion: "success" })], jobs: new Map(), error: null };
  });
  const outside = "d".repeat(40);
  const running = github.refresh();
  await settle(() => ci.mock.calls.length > 1);
  const queued = github.fetchCommitDataForSHA(outside, true);
  release();
  await running;
  await queued;
  await settle(() => ci.mock.calls.some(call => call[2].includes(outside)));
  expect(ci.mock.calls.some(call => call[2].includes(outside))).toBe(true);
});

test("jobs of a finished run are cached only once every job and step has finished", async () => {
  const { github } = await mountGitHub();
  const step = (status: string) => ({
    name: "build",
    number: 1,
    status,
    conclusion: status === "completed" ? "success" : null,
    startedAt: null,
    completedAt: null,
  });
  const job = (stepStatus: string) => ({
    id: 5,
    name: "build",
    status: "completed",
    conclusion: "success",
    startedAt: null,
    completedAt: null,
    steps: [step(stepStatus)],
  });
  const jobs = spyOn(api, "fetchRunJobs")
    .mockResolvedValueOnce({ jobs: [job("in_progress")], error: null })
    .mockResolvedValue({ jobs: [job("completed")], error: null });
  cleanup.push(() => jobs.mockRestore());
  const finished = run({ status: "completed", conclusion: "success" });
  await github.fetchJobsForRun(finished);
  await github.fetchJobsForRun(finished);
  expect(jobs).toHaveBeenCalledTimes(2);
  await github.fetchJobsForRun(finished);
  expect(jobs).toHaveBeenCalledTimes(2);
});

test("a fetch cancelled by a repository switch leaves the new repository's loading status alone", async () => {
  let releaseOld!: () => void;
  const oldGate = new Promise<void>(resolve => (releaseOld = resolve));
  let releaseNew!: () => void;
  const newGate = new Promise<void>(resolve => (releaseNew = resolve));
  const { state, actions, ci } = await mountGitHub();
  ci.mockImplementationOnce(async () => {
    await oldGate;
    return { data: [run()], jobs: new Map(), error: null };
  }).mockImplementationOnce(async () => {
    await newGate;
    return { data: [run()], jobs: new Map(), error: null };
  });
  await settle(() => ci.mock.calls.length === 1);
  // A repository switch resets the provider and starts the new repository's view-entry fetch.
  actions.setRepoPath("/repo/github-hook-2");
  await settle(() => ci.mock.calls.length === 2);
  expect(state.providerStatusFor("github-actions").kind).toBe("loading");
  // The old repository's request answers late; its cancelled fetch must not settle the new one's status.
  releaseOld();
  await settle();
  expect(state.providerStatusFor("github-actions").kind).toBe("loading");
  releaseNew();
  await settle(() => state.providerStatusFor("github-actions").kind !== "loading");
});

test("a Reload queued behind a fetch of the same commit still asks GitHub again", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const { github, ci } = await mountGitHub();
  ci.mockImplementationOnce(async () => {
    await gate;
    return { data: [run()], jobs: new Map(), error: null };
  });
  await settle(() => ci.mock.calls.length === 1);
  // The view-entry fetch covers SHA; Reload of SHA waits behind it.
  const reload = github.fetchCommitDataForSHA(SHA, true);
  // Let the Reload read its disk cache and queue behind the running fetch before that fetch answers.
  await settle();
  release();
  await reload;
  await settle(() => ci.mock.calls.length > 1);
  expect(ci.mock.calls.length).toBe(2);
  expect(ci.mock.calls[1]?.[2]).toContain(SHA);
});

test("awaiting a Reload queued behind a fetch waits until the Reload itself has run", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const { github, ci } = await mountGitHub();
  ci.mockImplementationOnce(async () => {
    await gate;
    return { data: [run()], jobs: new Map(), error: null };
  });
  await settle(() => ci.mock.calls.length === 1);
  let done = false;
  const reload = github.fetchCommitDataForSHA(SHA, true).then(() => (done = true));
  await settle();
  // Still waiting behind the running fetch: the Reload has not asked GitHub yet.
  expect(done).toBe(false);
  release();
  await reload;
  expect(ci.mock.calls.length).toBe(2);
});

test("a window refresh queued after a Reload keeps the Reload's commit outside the window", async () => {
  const { github, state, actions, ci } = await mountGitHub();
  await settle(() => ci.mock.calls.length > 0 && state.providerStatusFor("github-actions").kind !== "loading");
  // A background catch-up fetch for a new commit is running (leaving the view does not cancel it).
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  ci.mockImplementationOnce(async () => {
    await gate;
    return { data: [], jobs: new Map(), error: null };
  });
  const NEW = "a".repeat(40);
  const commit = (hash: string, parents: string[]) => ({
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    subject: hash.slice(0, 1),
    body: "",
    author: "Author",
    authorEmail: "author@example.com",
    authorDate: "2026-01-01T00:00:00Z",
    committer: "Author",
    committerEmail: "author@example.com",
    commitDate: "2026-01-01T00:00:00Z",
    refs: [],
  });
  actions.setGraphRows(buildGraph([commit(NEW, [SHA]), commit(SHA, [])]));
  await settle(() => ci.mock.calls.some(call => call[2].includes(NEW)));
  const calls = ci.mock.calls.length;
  const outside = "d".repeat(40);
  const reload = github.fetchCommitDataForSHA(outside, true);
  await settle();
  // Coming back to the view after a while queues a refresh of the whole window behind it.
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000);
  try {
    actions.setActiveProviderView("git");
    actions.setActiveProviderView("github-actions");
    release();
    await reload;
    await settle(() => ci.mock.calls.length > calls);
  } finally {
    clock.mockRestore();
  }
  expect(ci.mock.calls.slice(calls).some(call => call[2].includes(outside))).toBe(true);
});
