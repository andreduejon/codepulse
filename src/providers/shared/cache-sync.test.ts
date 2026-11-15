import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BANNER } from "../../debug/banner";
import * as githubApi from "../github-actions/api";
import { GitHubCache } from "../github-actions/cache";
import { syncGitHubCache } from "../github-actions/sync";
import type { GitHubJob, GitHubWorkflowRun } from "../github-actions/types";
import { DEFAULT_GITHUB_CONFIG } from "../github-actions/types";
import * as jenkinsApi from "../jenkins/api";
import { JenkinsCache } from "../jenkins/cache";
import { syncJenkinsCache } from "../jenkins/sync";
import type { JenkinsRun } from "../jenkins/types";
import { DEFAULT_JENKINS_CONFIG } from "../jenkins/types";
import * as openShiftApi from "../openshift/api";
import { OpenShiftCache } from "../openshift/cache";
import { syncOpenShiftCache } from "../openshift/sync";
import type { OpenShiftCommitData, OpenShiftResource } from "../openshift/types";
import { DEFAULT_OPENSHIFT_CONFIG } from "../openshift/types";
import { closeProviderCaches } from "./sha-sqlite-cache";

const APP = "/repo/dashboard-sync";
const DONE = "a".repeat(40);
const RUNNING = "b".repeat(40);
const OTHER = "c".repeat(40);
const TOKEN_ENV = "CODEPULSE_TEST_SYNC_TOKEN";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

async function setup() {
  const original = process.env[TOKEN_ENV];
  process.env[TOKEN_ENV] = "test-token";
  cleanup.push(() => {
    if (original === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = original;
  });
  const root = await mkdtemp(join(tmpdir(), "codepulse-cache-sync-"));
  cleanup.push(async () => {
    closeProviderCaches();
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

const githubRun = (id: number, sha: string, status = "completed"): GitHubWorkflowRun => ({
  id,
  name: "CI",
  status,
  conclusion: status === "completed" ? "failure" : null,
  headSha: sha,
  event: "push",
  runNumber: id,
  updatedAt: "2026-11-15T10:00:00Z",
});
const githubJob = (id: number): GitHubJob => ({
  id,
  name: "build",
  status: "completed",
  conclusion: "failure",
  startedAt: "2026-11-15T09:58:00Z",
  completedAt: "2026-11-15T10:00:00Z",
  steps: [],
});

test("GitHub: the asked commits' finished runs and their jobs go into the cache, running ones do not", async () => {
  const root = await setup();
  const fetch = spyOn(githubApi, "fetchCIDataForSHAs").mockResolvedValue({
    data: [githubRun(7, DONE), githubRun(8, RUNNING, "in_progress")],
    jobs: new Map([[7, [githubJob(70)]]]),
    error: null,
  });
  cleanup.push(() => fetch.mockRestore());

  const result = await syncGitHubCache({
    app: APP,
    config: { ...DEFAULT_GITHUB_CONFIG, enabled: true, tokenEnvVar: TOKEN_ENV },
    remoteUrl: "git@github.com:demo/shop.git",
    shas: [DONE, RUNNING],
    cacheRoot: root,
  });

  expect(result).toEqual({ error: null, authFailed: false });
  expect(fetch.mock.calls[0]?.[2]).toEqual([DONE, RUNNING]);
  const cache = new GitHubCache({ root, maxEntries: 200 });
  expect(await cache.read(APP, DONE, { touch: false })).toEqual({
    sha: DONE,
    runs: [githubRun(7, DONE)],
    jobs: { "7": [githubJob(70)] },
  });
  expect(await cache.read(APP, RUNNING, { touch: false })).toBeNull();
});

test("GitHub: an expired token is reported as an authentication failure, and nothing is written", async () => {
  const root = await setup();
  const fetch = spyOn(githubApi, "fetchCIDataForSHAs").mockResolvedValue({
    data: [],
    jobs: new Map(),
    error: BANNER.github.tokenExpired,
  });
  cleanup.push(() => fetch.mockRestore());

  const result = await syncGitHubCache({
    app: APP,
    config: { ...DEFAULT_GITHUB_CONFIG, enabled: true, tokenEnvVar: TOKEN_ENV },
    remoteUrl: "https://github.com/demo/shop.git",
    shas: [DONE],
    cacheRoot: root,
  });

  expect(result).toEqual({ error: BANNER.github.tokenExpired, authFailed: true });
  expect(await new GitHubCache({ root }).list(APP)).toEqual([]);
});

const JOB_URL = "https://jenkins.example.com/job/shop/";
const jenkinsRun = (number: number, sha: string, status = "completed"): JenkinsRun => ({
  id: `${JOB_URL}#${number}`,
  name: "shop",
  status,
  conclusion: status === "completed" ? "success" : null,
  headSha: sha,
  runNumber: number,
  startedAt: "2026-11-15T09:00:00Z",
  updatedAt: "2026-11-15T09:05:00Z",
  url: `${JOB_URL}${number}/`,
  jobLabel: "shop",
  jobUrl: JOB_URL,
});

test("Jenkins: the configured jobs are read for the asked commits, main first, and the finished builds are cached with their stages kept", async () => {
  const root = await setup();
  const stages = { [`${JOB_URL}#1`]: [] };
  await new JenkinsCache({ root, maxEntries: 200 }).write(APP, {
    sha: DONE,
    runs: [jenkinsRun(1, DONE)],
    jobs: stages,
  });
  const fetch = spyOn(jenkinsApi, "fetchJenkinsGraphDataForSHAs").mockResolvedValue({
    data: [jenkinsRun(2, DONE), jenkinsRun(3, RUNNING, "in_progress")],
    error: null,
    jobUrls: [JOB_URL],
    discoveryComplete: false,
    discoveryTruncated: true,
    branchJobs: { shown: 25, total: 40 },
    lastBuilds: new Map(),
  });
  cleanup.push(() => fetch.mockRestore());

  const result = await syncJenkinsCache({
    app: APP,
    config: { ...DEFAULT_JENKINS_CONFIG, enabled: true, tokenEnvVar: TOKEN_ENV, jobs: [{ url: JOB_URL }] },
    shas: [DONE, RUNNING],
    branches: ["main"],
    cacheRoot: root,
  });

  expect(result).toEqual({ error: null, authFailed: false });
  const [jobs, , , shas, options] = fetch.mock.calls[0] ?? [];
  expect(jobs).toEqual([{ url: JOB_URL }]);
  expect(shas).toEqual([DONE, RUNNING]);
  expect([...(options?.preferredBranches ?? [])]).toEqual(["main"]);
  const cache = new JenkinsCache({ root, maxEntries: 200 });
  expect(await cache.read(APP, DONE, { touch: false })).toEqual({
    sha: DONE,
    runs: [jenkinsRun(1, DONE), jenkinsRun(2, DONE)],
    jobs: stages,
  });
  expect(await cache.read(APP, RUNNING, { touch: false })).toBeNull();
});

const build = (name: string, sha: string, status: OpenShiftResource["status"]): OpenShiftResource => ({
  id: `Build/shop-dev/${name}`,
  kind: "Build",
  namespace: "shop-dev",
  name,
  status,
  imageRefs: [],
  commitSha: sha,
  updatedAt: "2026-11-15T09:30:00Z",
});
const commitData = (sha: string, builds: OpenShiftResource[]): OpenShiftCommitData => ({
  sha,
  liveFetched: false,
  namespaces: [
    { namespace: "shop-dev", builds, imageStreamTags: [], deployments: [], deploymentConfigs: [], pods: [] },
  ],
});

test("OpenShift: the namespaces' finished builds of the asked commits are cached, other commits' builds are not", async () => {
  const root = await setup();
  const fetch = spyOn(openShiftApi, "fetchOpenShiftInventory").mockResolvedValue({
    data: new Map([
      [DONE, commitData(DONE, [build("shop-api-44", DONE, "pass"), build("shop-api-45", DONE, "running")])],
      [OTHER, commitData(OTHER, [build("shop-api-40", OTHER, "fail")])],
    ]),
    error: null,
    failures: [],
    successfulRequests: 2,
  });
  cleanup.push(() => fetch.mockRestore());

  const result = await syncOpenShiftCache({
    app: APP,
    config: {
      ...DEFAULT_OPENSHIFT_CONFIG,
      enabled: true,
      serverUrl: "https://api.example.com:6443",
      namespaces: ["shop-dev"],
      tokenEnvVar: TOKEN_ENV,
    },
    shas: [DONE],
    cacheRoot: root,
  });

  expect(result).toEqual({ error: null, authFailed: false });
  expect(fetch.mock.calls[0]?.[4]).toEqual({ commitShas: [DONE] });
  const cache = new OpenShiftCache({ root, maxEntries: 200 });
  expect((await cache.read(APP, DONE, { touch: false }))?.builds.map(cached => cached.name)).toEqual(["shop-api-44"]);
  expect(await cache.read(APP, OTHER, { touch: false })).toBeNull();
});

test("OpenShift: a list where every request failed is an error, and an expired token an authentication failure", async () => {
  const root = await setup();
  const config = {
    ...DEFAULT_OPENSHIFT_CONFIG,
    enabled: true,
    serverUrl: "https://api.example.com:6443",
    namespaces: ["shop-dev"],
    tokenEnvVar: TOKEN_ENV,
  };
  const fetch = spyOn(openShiftApi, "fetchOpenShiftInventory").mockResolvedValue({
    data: new Map(),
    error: "OpenShift is down",
    failures: [],
    successfulRequests: 0,
  });
  cleanup.push(() => fetch.mockRestore());
  expect(await syncOpenShiftCache({ app: APP, config, shas: [DONE], cacheRoot: root })).toEqual({
    error: "OpenShift is down",
    authFailed: false,
  });
  fetch.mockResolvedValue({
    data: new Map(),
    error: BANNER.openshift.tokenExpired,
    failures: [],
    successfulRequests: 0,
  });
  expect(await syncOpenShiftCache({ app: APP, config, shas: [DONE], cacheRoot: root })).toEqual({
    error: BANNER.openshift.tokenExpired,
    authFailed: true,
  });
});

test("without a token, nothing is asked and nothing is reported", async () => {
  const root = await setup();
  delete process.env[TOKEN_ENV];
  const fetch = spyOn(githubApi, "fetchCIDataForSHAs");
  cleanup.push(() => fetch.mockRestore());
  const result = await syncGitHubCache({
    app: APP,
    config: { ...DEFAULT_GITHUB_CONFIG, enabled: true, tokenEnvVar: TOKEN_ENV },
    remoteUrl: "git@github.com:demo/shop.git",
    shas: [DONE],
    cacheRoot: root,
  });
  expect(result).toEqual({ error: null, authFailed: false });
  expect(fetch).not.toHaveBeenCalled();
});
