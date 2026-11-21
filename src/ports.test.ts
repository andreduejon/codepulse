import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onProviderCacheWrite, ProviderCacheRegistry } from "./adapters/cache/sha-sqlite-cache";
import { githubProvider } from "./core/github/definition";
import { jenkinsProvider } from "./core/jenkins/definition";
import { openShiftProvider } from "./core/openshift/definition";
import { terminalPorts } from "./ports";

const SHA = "a".repeat(40);
const REPO = "/repo/own-registry";
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

async function ownPorts() {
  const root = await mkdtemp(join(tmpdir(), "codepulse-ports-"));
  const registry = new ProviderCacheRegistry();
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  cleanup.push(() => registry.close());
  return { root, registry, ports: terminalPorts({ cacheRoot: root, registry }) };
}

test("ports built on a cache registry of their own write through it: its listeners are told, the process's are not", async () => {
  const { ports } = await ownPorts();
  const own: string[] = [];
  const process: string[] = [];
  cleanup.push(ports.cacheStore.onWrite(repo => own.push(repo)));
  cleanup.push(onProviderCacheWrite(repo => process.push(repo)));
  for (const provider of [githubProvider, jenkinsProvider, openShiftProvider]) {
    const cache = ports.providers.adapters(provider as typeof githubProvider).cache(200);
    await cache.mergeMany(REPO, [{ sha: SHA, incoming: [1] }], (sha: string) => ({
      sha,
      runs: [],
      builds: [],
      namespaces: [],
    }));
  }
  expect(own).toEqual([REPO, REPO, REPO]);
  expect(process).toEqual([]);
});

test("an eviction through those ports drops a write that started before it", async () => {
  const { ports } = await ownPorts();
  const cache = ports.providers.adapters(githubProvider).cache(200);
  const { hash } = await ports.cacheStore.identity(REPO);
  await cache.mergeMany(REPO, [{ sha: SHA, incoming: [1] }], sha => ({ sha, runs: [] }));
  const held = cache.writeLog(REPO, SHA, "job", "written before the eviction");
  expect(ports.cacheStore.evictRepository(hash).snapshotCount).toBe(1);
  await held;
  expect(await cache.read(REPO, SHA)).toBeNull();
  expect(await cache.readLog(REPO, SHA, "job")).toBeNull();
  expect(ports.cacheStore.summary().groups).toEqual([]);
});

test("the Dashboard through those ports reads their caches", async () => {
  const { ports, root } = await ownPorts();
  expect(ports.cacheStore.path()).toBe(join(root, "cache.sqlite"));
  const run = {
    id: 7,
    name: "CI",
    status: "completed",
    conclusion: "failure",
    headSha: SHA,
    event: "push",
    runNumber: 812,
    updatedAt: "2026-03-02T10:52:00Z",
  };
  await ports.providers
    .adapters(githubProvider)
    .cache(200)
    .mergeMany(REPO, [{ sha: SHA, incoming: [run] }], sha => ({
      sha,
      runs: [run],
    }));
  const events = await ports.dashboard.readEvents(REPO, { since: Date.parse("2026-03-01T00:00:00Z") });
  expect(events.map(event => event.text)).toEqual(["CI #812 failed"]);
});
