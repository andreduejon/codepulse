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
  lastBuilds: new Map([[JOB_URL, data.length]]),
});

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

async function mountJenkins() {
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
  const graph = spyOn(api, "fetchJenkinsGraphDataForSHAs").mockResolvedValue(result([run()]));
  const full = spyOn(api, "fetchJenkinsDataForSHAs").mockResolvedValue(result([run()]));
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
    actions.setGraphRows(
      buildGraph([
        {
          hash: SHA,
          shortHash: SHA.slice(0, 7),
          parents: [],
          subject: "build",
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
    const jenkins = useJenkinsCI({
      state,
      actions,
      cacheRoot: root,
      config: {
        enabled: true,
        username: "user",
        tokenEnvVar: TOKEN_ENV,
        autoRefreshSeconds: 0,
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
