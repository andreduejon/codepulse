import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { createAppState } from "../../context/state";
import { BANNER } from "../../debug/banner";
import { buildGraph } from "../../git/graph";
import type { Commit } from "../../git/types";
import { closeProviderCaches } from "../shared/sha-sqlite-cache";
import * as api from "./api";
import { JenkinsCache } from "./cache";
import type { JenkinsRun } from "./types";
import { useJenkinsCI } from "./use-jenkins-ci";

const SHA = "c".repeat(40);
const TOKEN_ENV = "CODEPULSE_TEST_JENKINS_TOKEN";
const JOB_URL = "https://jenkins.example.com/job/app/";

const run = (overrides: Partial<JenkinsRun> = {}): JenkinsRun => ({
  id: `${JOB_URL}#1`,
  name: "app",
  status: "completed",
  conclusion: "success",
  headSha: SHA,
  runNumber: 1,
  startedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:01:00Z",
  url: `${JOB_URL}1/`,
  jobLabel: "app",
  jobUrl: JOB_URL,
  ...overrides,
});

const result = (data: JenkinsRun[], error: string | null = null) => ({
  data,
  error,
  jobUrls: [JOB_URL],
  discoveryComplete: true,
  discoveryTruncated: false,
  branchJobs: { shown: 1, total: 1 },
  lastBuilds: new Map([[JOB_URL, data.length]]),
});

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

const commit = (hash: string, parent?: string) => ({
  hash,
  shortHash: hash.slice(0, 7),
  parents: parent ? [parent] : [],
  subject: "build",
  body: "",
  author: "Author",
  authorEmail: "author@example.com",
  authorDate: "2026-01-01T00:00:00Z",
  committer: "Author",
  committerEmail: "author@example.com",
  commitDate: "2026-01-01T00:00:00Z",
  refs: [],
});

async function mountJenkins(
  options: {
    fetchDepth?: 10 | 20 | 50;
    older?: string[];
    seed?: (root: string) => Promise<void>;
    refs?: Commit["refs"];
    truncated?: boolean;
  } = {},
) {
  const original = process.env[TOKEN_ENV];
  process.env[TOKEN_ENV] = "test-token";
  cleanup.push(() => {
    if (original === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = original;
  });
  const root = await mkdtemp(join(tmpdir(), "codepulse-jenkins-hook-"));
  cleanup.push(async () => {
    closeProviderCaches();
    await rm(root, { recursive: true, force: true });
  });
  await options.seed?.(root);
  const answer = options.truncated
    ? { ...result([run()]), discoveryComplete: false, discoveryTruncated: true, branchJobs: { shown: 25, total: 61 } }
    : result([run()]);
  const graph = spyOn(api, "fetchJenkinsGraphDataForSHAs").mockResolvedValue(answer);
  const full = spyOn(api, "fetchJenkinsDataForSHAs").mockResolvedValue(answer);
  cleanup.push(() => graph.mockRestore());
  cleanup.push(() => full.mockRestore());
  let mounted!: {
    state: ReturnType<typeof createAppState>["state"];
    actions: ReturnType<typeof createAppState>["actions"];
    jenkins: ReturnType<typeof useJenkinsCI>;
  };
  createRoot(dispose => {
    cleanup.push(dispose);
    const { state, actions } = createAppState();
    actions.setRepoPath("/repo/jenkins-hook");
    actions.setActiveProviderView("jenkins");
    const hashes = [SHA, ...(options.older ?? [])];
    actions.setGraphRows(
      buildGraph(
        hashes.map((hash, index) => ({
          ...commit(hash, hashes[index + 1]),
          refs: index === 0 ? (options.refs ?? []) : [],
        })),
      ),
    );
    const jenkins = useJenkinsCI({
      state,
      actions,
      cacheRoot: root,
      config: {
        enabled: true,
        username: "user",
        tokenEnvVar: TOKEN_ENV,
        autoRefreshSeconds: 0,
        ...(options.fetchDepth && { fetchDepth: options.fetchDepth }),
        jobs: [{ url: JOB_URL }],
      },
    });
    mounted = { state, actions, jenkins };
  });
  return { ...mounted, graph, full };
}

/** Wait until the lifecycle has no fetch in flight (disk cache work is asynchronous). */
const settle = async (until: () => boolean = () => true) => {
  for (let i = 0; i < 100 && !until(); i++) await Bun.sleep(5);
  await Bun.sleep(5);
};

test("over the branch-job limit, the graph's branches are asked for first and the notice gives the counts", async () => {
  const { state, graph, full } = await mountJenkins({
    truncated: true,
    refs: [
      { name: "feature/refunds", type: "branch", isCurrent: true },
      { name: "origin/release/2.4", type: "remote", isCurrent: false },
    ],
  });
  await settle(() => graph.mock.calls.length + full.mock.calls.length > 0);
  await settle(() => state.providerStatusFor("jenkins").kind === "warning");
  const call = [...graph.mock.calls, ...full.mock.calls][0];
  expect([...(call?.[4]?.preferredBranches ?? [])].sort()).toEqual(["feature/refunds", "release/2.4"]);
  expect(state.providerStatusFor("jenkins")).toEqual({
    kind: "warning",
    message: "Jenkins reads 25 of 61 branch jobs: branches in the graph first.",
  });
});

test("manual refresh re-queries the whole graph window even when no build is running", async () => {
  const { jenkins, graph } = await mountJenkins();
  await jenkins.refresh();
  await settle();
  const calls = graph.mock.calls.length;
  expect(calls).toBeGreaterThan(0);
  await jenkins.refresh();
  await settle(() => graph.mock.calls.length > calls);
  expect(graph.mock.calls.length).toBe(calls + 1);
  expect(graph.mock.calls.at(-1)?.[3]).toContain(SHA);
});

test("a per-commit reload reports its error instead of finishing silently", async () => {
  const { jenkins, state, full } = await mountJenkins();
  await jenkins.refresh();
  await settle();
  full.mockResolvedValueOnce(result([], BANNER.jenkins.fetchFailed));
  await jenkins.fetchCommitDataForSHA(SHA, true);
  expect(state.providerStatusFor("jenkins")).toEqual({ kind: "error", message: BANNER.jenkins.fetchFailed });
  await jenkins.fetchCommitDataForSHA(SHA, true);
  expect(state.providerStatusFor("jenkins").kind).not.toBe("error");
});

test("the footer activity says fetching only while a Jenkins fetch runs", async () => {
  const { jenkins, state, graph } = await mountJenkins();
  await jenkins.refresh();
  await settle();
  const activity = () => state.providers.get("jenkins")?.activity?.() ?? null;
  expect(activity()).toBeNull();
  let release!: () => void;
  graph.mockImplementationOnce(() => new Promise(resolve => (release = () => resolve(result([run()])))));
  const pending = jenkins.refresh();
  await settle(() => activity() === "fetching");
  expect(activity()).toBe("fetching");
  release();
  await pending;
  await settle(() => activity() === null);
  expect(activity()).toBeNull();
});

test("after a 401, entering the view again stays frozen; only Reload retries", async () => {
  const { jenkins, state, actions, graph } = await mountJenkins();
  const running = spyOn(api, "fetchJenkinsRunsForBuilds").mockResolvedValue({ data: [], error: null });
  cleanup.push(() => running.mockRestore());
  // A running build arrives with the 401, so re-entering the view would normally re-check it.
  graph.mockResolvedValue(result([run({ status: "running", conclusion: null })], BANNER.jenkins.tokenExpired));
  await jenkins.refresh();
  await settle();
  expect(state.providerStatusFor("jenkins")).toEqual({ kind: "error", message: BANNER.jenkins.tokenExpired });
  const calls = graph.mock.calls.length;
  // Come back after the stale threshold: an automatic fetch, which must not lift the freeze.
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  try {
    actions.setActiveProviderView("git");
    actions.setActiveProviderView("jenkins");
    await settle();
    expect(graph.mock.calls.length).toBe(calls);
    expect(running).not.toHaveBeenCalled();
    // Jobs are not requested while frozen either; the reason is shown instead.
    expect(await jenkins.fetchJobsForRun(run(), undefined)).toEqual({ jobs: [], error: BANNER.jenkins.tokenExpired });
  } finally {
    clock.mockRestore();
  }
  graph.mockResolvedValue(result([run()]));
  await jenkins.refresh();
  await settle(() => graph.mock.calls.length > calls);
  expect(graph.mock.calls.length).toBeGreaterThan(calls);
});

test("stages of a finished build are cached only once every stage has finished", async () => {
  const { jenkins } = await mountJenkins();
  const stage = (status: string) => ({
    id: "s",
    name: "build",
    status,
    conclusion: status === "completed" ? "success" : null,
    startedAt: null,
    completedAt: null,
  });
  const job = (stageStatus: string) => ({
    id: "j",
    name: "app",
    status: "completed",
    conclusion: "success",
    startedAt: null,
    completedAt: null,
    steps: [stage(stageStatus)],
  });
  const stages = spyOn(api, "fetchJenkinsRunJobs")
    .mockResolvedValueOnce({ jobs: [job("running")], error: null })
    .mockResolvedValue({ jobs: [job("completed")], error: null });
  cleanup.push(() => stages.mockRestore());
  await jenkins.fetchJobsForRun(run(), undefined);
  await jenkins.fetchJobsForRun(run(), undefined);
  expect(stages).toHaveBeenCalledTimes(2);
  await jenkins.fetchJobsForRun(run(), undefined);
  expect(stages).toHaveBeenCalledTimes(2);
});

test("a Reload queued behind a fetch of the same window still asks Jenkins again", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const { jenkins, graph } = await mountJenkins();
  graph.mockImplementationOnce(async () => {
    await gate;
    return result([run()]);
  });
  await settle(() => graph.mock.calls.length === 1);
  // The view-entry fetch covers the window; Reload waits behind it.
  const reload = jenkins.refresh();
  await settle();
  release();
  await reload;
  await settle(() => graph.mock.calls.length > 1);
  expect(graph.mock.calls.length).toBe(2);
  expect(graph.mock.calls[1]?.[3]).toContain(SHA);
});

test("loading shows every cached commit, also below the fetch depth, and asks Jenkins only for the depth", async () => {
  // Ten newer commits fill the fetch depth of 10; the cached one sits below it.
  const newer = Array.from({ length: 9 }, (_, i) => String(i + 1).repeat(40));
  const older = "a".repeat(40);
  const { state, graph } = await mountJenkins({
    fetchDepth: 10,
    older: [...newer, older],
    seed: root =>
      new JenkinsCache({ root, maxEntries: 200 }).write("/repo/jenkins-hook", {
        sha: older,
        runs: [run({ id: `${JOB_URL}#2`, headSha: older, runNumber: 2, url: `${JOB_URL}2/` })],
      }),
  });
  await settle(() => state.graphBadges().has(older));
  expect(state.graphBadges().has(older)).toBe(true);
  expect(graph.mock.calls.length).toBeGreaterThan(0);
  expect(graph.mock.calls.some(call => call[3].includes(older))).toBe(false);
});
