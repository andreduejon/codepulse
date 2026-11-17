/**
 * The fetch lifecycle contract (lifecycle-contract.ts) for each provider on the shared lifecycle. A provider that
 * moves to another implementation keeps its fixture and must still pass.
 */
import { spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batch, createRoot, createSignal, untrack } from "solid-js";
import { createAppState } from "../../context/state";
import { BANNER } from "../../debug/banner";
import { buildGraph } from "../../git/graph";
import * as githubApi from "../github-actions/api";
import type { GitHubWorkflowRun } from "../github-actions/types";
import { useGitHubCI } from "../github-actions/use-github-ci";
import * as jenkinsApi from "../jenkins/api";
import type { JenkinsRun } from "../jenkins/types";
import { useJenkinsCI } from "../jenkins/use-jenkins-ci";
import * as openShiftApi from "../openshift/api";
import type { OpenShiftCachedBuild } from "../openshift/cache";
import { commitDataFromCacheEntry, useOpenShift } from "../openshift/use-openshift";
import {
  type ContractFailure,
  type ContractFixture,
  type ContractMount,
  lifecycleContract,
} from "./lifecycle-contract";
import { closeProviderCaches } from "./sha-sqlite-cache";

const SHA = "d".repeat(40);

const commit = {
  hash: SHA,
  shortHash: SHA.slice(0, 7),
  parents: [],
  subject: "contract",
  body: "",
  author: "Author",
  authorEmail: "author@example.com",
  authorDate: "2026-01-01T00:00:00Z",
  committer: "Author",
  committerEmail: "author@example.com",
  commitDate: "2026-01-01T00:00:00Z",
  refs: [],
};

/**
 * What every fixture shares: a token in the environment, a cache folder of its own, the app's state with one commit,
 * the provider turned on and not suspended (both signals), and a root that disposes once.
 */
function harness<T>(
  options: Parameters<ContractFixture["mount"]>[0] & { tokenEnv: string; remoteUrl?: string },
  start: (context: {
    state: ReturnType<typeof createAppState>["state"];
    actions: ReturnType<typeof createAppState>["actions"];
    cacheRoot: string;
    enabled: () => boolean;
    suspended: () => boolean;
  }) => T,
): { provider: T; mount: Omit<ContractMount, "hasData" | "refresh"> } {
  const original = process.env[options.tokenEnv];
  process.env[options.tokenEnv] = "test-token";
  const cacheRoot = mkdtempSync(join(tmpdir(), "codepulse-contract-"));
  // Runs after the root is disposed: work it left pending settles first, so nothing writes the folder back.
  options.onCleanup(async () => {
    options.backend.release();
    await Bun.sleep(20);
    closeProviderCaches(cacheRoot);
    rmSync(cacheRoot, { recursive: true, force: true });
    if (original === undefined) delete process.env[options.tokenEnv];
    else process.env[options.tokenEnv] = original;
  });
  const [enabled, setEnabled] = createSignal(options.enabled ?? true);
  const [suspended, setSuspended] = createSignal(options.suspended ?? false);
  let disposeRoot!: () => void;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeRoot();
  };
  options.onCleanup(dispose);
  let provider!: T;
  let app!: ReturnType<typeof createAppState>;
  const open = (repo: string) =>
    batch(() => {
      app.actions.setRepoPath(repo);
      if (options.remoteUrl) app.actions.setRemoteUrl(options.remoteUrl);
      app.actions.setGraphRows(buildGraph([commit]));
    });
  createRoot(rootDispose => {
    disposeRoot = rootDispose;
    app = createAppState();
    open(options.repo);
    app.actions.setActiveProviderView(options.view);
    provider = start({ state: app.state, actions: app.actions, cacheRoot, enabled, suspended });
  });
  return {
    provider,
    mount: {
      state: app.state,
      actions: app.actions,
      setEnabled,
      setSuspended,
      openRepo: open,
      dispose,
    },
  };
}

const errorFor = (failure: ContractFailure, texts: { auth: string; server: string }) =>
  failure === "auth" ? texts.auth : failure === "server" ? texts.server : null;

// ── GitHub ──────────────────────────────────────────────────────────────────────

const githubRun = {
  id: 21,
  name: "CI",
  status: "completed",
  conclusion: "success",
  headSha: SHA,
  event: "push",
  runNumber: 7,
  startedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:01:00Z",
  url: "https://github.com/o/r/actions/runs/21",
} as GitHubWorkflowRun;

const github: ContractFixture = {
  name: "GitHub",
  view: "github-actions",
  tokenExpired: BANNER.github.tokenExpired,
  mount(options) {
    const tokenEnv = "CODEPULSE_CONTRACT_GITHUB_TOKEN";
    let repoPath = () => options.repo;
    const list = spyOn(githubApi, "fetchCIDataForSHAs").mockImplementation((_repo, _token, _shas, opts = {}) =>
      options.backend.request(untrack(repoPath), opts.signal, (hasData, failure) => ({
        data: hasData && !failure ? [githubRun] : [],
        jobs: new Map(),
        error: errorFor(failure, { auth: BANNER.github.tokenExpired, server: BANNER.github.fetchFailed }),
      })),
    );
    options.onCleanup(() => list.mockRestore());
    const { provider, mount } = harness(
      { ...options, tokenEnv, remoteUrl: "https://github.com/o/r.git" },
      ({ state, actions, cacheRoot, enabled, suspended }) => {
        repoPath = state.repoPath;
        return useGitHubCI({
          state,
          actions,
          cacheRoot,
          suspended,
          config: () => ({ enabled: enabled(), tokenEnvVar: tokenEnv, autoRefreshSeconds: 0 }),
        });
      },
    );
    return {
      ...mount,
      hasData: () => (provider.getCommitData(SHA)?.runs.length ?? 0) > 0,
      refresh: () => provider.refresh(),
    };
  },
};

// ── Jenkins ─────────────────────────────────────────────────────────────────────

const JOB_URL = "https://jenkins.example.com/job/app/";
const jenkinsRun: JenkinsRun = {
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
};

const jenkins: ContractFixture = {
  name: "Jenkins",
  view: "jenkins",
  tokenExpired: BANNER.jenkins.tokenExpired,
  mount(options) {
    const tokenEnv = "CODEPULSE_CONTRACT_JENKINS_TOKEN";
    let repoPath = () => options.repo;
    const answer = (signal: AbortSignal | undefined) =>
      options.backend.request(untrack(repoPath), signal, (hasData, failure) => {
        const data = hasData && !failure ? [jenkinsRun] : [];
        return {
          data,
          error: errorFor(failure, { auth: BANNER.jenkins.tokenExpired, server: BANNER.jenkins.fetchFailed }),
          jobUrls: [JOB_URL],
          discoveryComplete: true,
          discoveryTruncated: false,
          branchJobs: { shown: 1, total: 1 },
          lastBuilds: new Map([[JOB_URL, data.length]]),
        };
      });
    const graph = spyOn(jenkinsApi, "fetchJenkinsGraphDataForSHAs").mockImplementation(
      (_jobs, _user, _token, _shas, opts = {}) => answer(opts.signal),
    );
    const full = spyOn(jenkinsApi, "fetchJenkinsDataForSHAs").mockImplementation(
      (_jobs, _user, _token, _shas, opts = {}) => answer(opts.signal),
    );
    options.onCleanup(() => {
      graph.mockRestore();
      full.mockRestore();
    });
    const { provider, mount } = harness(
      { ...options, tokenEnv },
      ({ state, actions, cacheRoot, enabled, suspended }) => {
        repoPath = state.repoPath;
        return useJenkinsCI({
          state,
          actions,
          cacheRoot,
          suspended,
          config: () => ({
            enabled: enabled(),
            username: "user",
            tokenEnvVar: tokenEnv,
            autoRefreshSeconds: 0,
            jobs: [{ url: JOB_URL }],
          }),
        });
      },
    );
    return {
      ...mount,
      hasData: () => (provider.getCommitData(SHA)?.runs.length ?? 0) > 0,
      refresh: () => provider.refresh(),
    };
  },
};

// ── OpenShift ───────────────────────────────────────────────────────────────────

const build: OpenShiftCachedBuild = {
  id: "Build:ns:app-1",
  namespace: "ns",
  name: "app-1",
  status: "pass",
  imageRefs: ["sha256:abc"],
  commitSha: SHA,
};
const listedCommit = (() => {
  const data = commitDataFromCacheEntry({ sha: SHA, builds: [build] });
  return {
    ...data,
    namespaces: data.namespaces.map(namespace => ({
      ...namespace,
      builds: namespace.builds.map(({ cacheOnly: _cacheOnly, ...listed }) => listed),
    })),
  };
})();

const openshift: ContractFixture = {
  name: "OpenShift",
  view: "openshift",
  tokenExpired: BANNER.openshift.tokenExpired,
  knownGaps: {
    backoff: "its build list never reports a result to the lifecycle, so failures don't back off (fix in v0.19 step 2)",
  },
  mount(options) {
    const tokenEnv = "CODEPULSE_CONTRACT_OPENSHIFT_TOKEN";
    let repoPath = () => options.repo;
    const inventory = spyOn(openShiftApi, "fetchOpenShiftInventory").mockImplementation((_config, _token, signal) =>
      options.backend.request(untrack(repoPath), signal, (hasData, failure) => ({
        data: hasData && !failure ? new Map([[SHA, listedCommit]]) : new Map(),
        error: errorFor(failure, { auth: BANNER.openshift.tokenExpired, server: BANNER.openshift.inventoryFailed }),
        failures: [],
        successfulRequests: failure ? 0 : 1,
      })),
    );
    // The live list and its watches: nothing running, and the watches wait until the test ends.
    const live = spyOn(openShiftApi, "fetchOpenShiftResources").mockResolvedValue({
      resources: [],
      controllers: [],
      failures: [],
      successfulRequests: 1,
      error: null,
      resourceVersions: new Map(),
    });
    const ends: ((result: openShiftApi.OpenShiftWatchResult) => void)[] = [];
    const watch = spyOn(openShiftApi, "watchOpenShiftStream").mockImplementation(
      () => new Promise(resolve => ends.push(resolve)),
    );
    options.onCleanup(() => {
      for (const end of ends) end("end");
      inventory.mockRestore();
      live.mockRestore();
      watch.mockRestore();
    });
    const { provider, mount } = harness(
      { ...options, tokenEnv },
      ({ state, actions, cacheRoot, enabled, suspended }) => {
        repoPath = state.repoPath;
        return useOpenShift({
          state,
          actions,
          cacheRoot,
          suspended,
          config: () => ({
            enabled: enabled(),
            tokenEnvVar: tokenEnv,
            serverUrl: "https://cluster.example",
            namespaces: ["ns"],
            autoRefreshSeconds: 0,
          }),
        });
      },
    );
    return {
      ...mount,
      hasData: () => provider.getCommitData(SHA)?.namespaces.some(namespace => namespace.builds.length > 0) ?? false,
      refresh: () => provider.refresh(),
    };
  },
};

const fixtures: ContractFixture[] = [github, jenkins, openshift];
for (const fixture of fixtures) lifecycleContract(fixture);
