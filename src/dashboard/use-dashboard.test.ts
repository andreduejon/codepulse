import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot, createSignal } from "solid-js";
import { GitHubCache } from "../providers/github-actions/cache";
import { closeProviderCaches } from "../providers/shared/sha-sqlite-cache";
import type { DashboardEvent } from "./events";
import type { DashboardSettings } from "./settings";
import { type DashboardApp, useDashboard } from "./use-dashboard";

const NOW = Date.parse("2026-03-02T11:00:00Z");
const event = (app: string, minutesAgo: number): DashboardEvent => ({
  id: `${app}:${minutesAgo}`,
  app,
  source: "git",
  time: NOW - minutesAgo * 60_000,
  status: null,
  text: `${app} ${minutesAgo}`,
  sha: "a".repeat(40),
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** Past the dashboard's wait after a cache write or a graph change. */
const afterReloadDelay = () => new Promise(resolve => setTimeout(resolve, 400));

const SHOP: DashboardApp = { path: "/shop", name: "shop" };
const WEB: DashboardApp = { path: "/web", name: "web" };

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

function dashboard(
  events: DashboardEvent[],
  settings: DashboardSettings = { enabled: true, windowDays: 7, knotMinutes: 60 },
) {
  const [active, setActive] = createSignal(false);
  const [app, setApp] = createSignal(SHOP);
  const [config, setConfig] = createSignal(settings);
  const [graph, setGraph] = createSignal(0);
  const loads: { app: string; since: number }[] = [];
  const state = createRoot(dispose => {
    cleanup.push(dispose);
    return useDashboard({
      app,
      active,
      settings: config,
      changes: graph,
      now: () => NOW,
      load: async (path, options) => {
        loads.push({ app: path, since: options.since });
        return events.filter(item => item.app === path && item.time >= options.since);
      },
    });
  });
  return { state, setActive, setApp, setConfig, setGraph, loads };
}

test("reads only once shown; the cursor starts on the newest event and skips date and rope rows", async () => {
  const d = dashboard([event("/shop", 5), event("/shop", 10), event("/shop", 70)]);
  await settle();
  expect(d.loads).toEqual([]);
  d.setActive(true);
  await settle();
  expect(d.loads.map(load => load.app)).toEqual(["/shop"]);
  expect(d.state.rows().map(row => row.kind)).toEqual(["date", "event", "event", "gap", "event"]);
  expect(d.state.cursor()).toBe(1);
  d.state.move(2);
  expect(d.state.cursor()).toBe(4);
  d.state.move(1);
  expect(d.state.cursor()).toBe(4);
  d.state.moveToEnd("first");
  expect(d.state.cursor()).toBe(1);
});

test("only the open app shows; switching the repository shows the other app from its newest event", async () => {
  const d = dashboard([event("/shop", 5), event("/shop", 10), event("/web", 70)]);
  d.setActive(true);
  await settle();
  expect(d.state.eventCount()).toBe(2);
  d.state.move(1);
  d.setApp(WEB);
  await settle();
  expect(d.state.app().name).toBe("web");
  expect(d.state.eventCount()).toBe(1);
  expect(d.state.rows()[d.state.cursor()]).toMatchObject({ kind: "event", event: { id: "/web:70" } });
});

test("a busy knot shows every event, and Enter hands the selected one over", async () => {
  const d = dashboard(Array.from({ length: 7 }, (_, index) => event("/shop", index + 1)));
  d.setActive(true);
  await settle();
  expect(d.state.rows().map(row => row.kind)).toEqual(["date", ...Array(7).fill("event")]);
  expect(d.state.activate()).toMatchObject({ id: "/shop:1" });
  d.state.moveToEnd("last");
  expect(d.state.activate()).toMatchObject({ id: "/shop:7" });
});

test("the time window decides how far back it reads, and a new window reads again", async () => {
  const d = dashboard([event("/shop", 5), event("/shop", 3 * 24 * 60)], {
    enabled: true,
    windowDays: 1,
    knotMinutes: 60,
  });
  d.setActive(true);
  await settle();
  expect(d.loads.at(-1)?.since).toBe(NOW - 24 * 3_600_000);
  expect(d.state.eventCount()).toBe(1);
  d.setConfig({ enabled: true, windowDays: 7, knotMinutes: 60 });
  await settle();
  expect(d.state.eventCount()).toBe(2);
});

test("the knot size decides which events share a knot, without reading again", async () => {
  const d = dashboard([event("/shop", 5), event("/shop", 25)], { enabled: true, windowDays: 7, knotMinutes: 15 });
  d.setActive(true);
  await settle();
  expect(d.state.rows().map(row => row.kind)).toEqual(["date", "event", "gap", "event"]);
  const reads = d.loads.length;
  d.setConfig({ enabled: true, windowDays: 7, knotMinutes: 60 });
  await settle();
  expect(d.state.rows().map(row => row.kind)).toEqual(["date", "event", "event"]);
  expect(d.loads.length).toBe(reads);
});

test("while shown, a provider's cache write or a new graph reads the events again, once for many; hidden, neither does", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-dashboard-live-"));
  cleanup.push(async () => {
    closeProviderCaches();
    await rm(root, { recursive: true, force: true });
  });
  const cache = new GitHubCache({ root, maxEntries: 200 });
  const write = (sha: string) => cache.write("/shop", { sha, runs: [] });
  const d = dashboard([event("/shop", 5)]);
  d.setActive(true);
  await settle();
  const shown = d.loads.length;
  await write("1".repeat(40));
  await write("2".repeat(40));
  await afterReloadDelay();
  expect(d.loads.length).toBe(shown + 1);
  d.setGraph(1);
  await afterReloadDelay();
  expect(d.loads.length).toBe(shown + 2);

  d.setActive(false);
  await settle();
  await write("3".repeat(40));
  d.setGraph(2);
  await afterReloadDelay();
  expect(d.loads.length).toBe(shown + 2);
});

test("a provider hidden from its badge leaves the rope with its events; the count says how many of all show", async () => {
  const run: DashboardEvent = { ...event("/shop", 20), id: "run", source: "jenkins", status: "pass" };
  const d = dashboard([event("/shop", 5), run, event("/shop", 40)]);
  d.setActive(true);
  await settle();
  d.state.select(d.state.rows().findIndex(row => row.kind === "event" && row.event.id === "run"));
  expect(d.state.selected()?.id).toBe("run");

  d.state.toggleSource("jenkins");
  expect(d.state.hidden().has("jenkins")).toBe(true);
  expect(d.state.rows().some(row => row.kind === "event" && row.event.source === "jenkins")).toBe(false);
  expect([d.state.eventCount(), d.state.totalCount()]).toEqual([2, 3]);
  // The selected event is hidden: the cursor goes to the newest one shown.
  expect(d.state.selected()?.id).toBe("/shop:5");

  // Shown again, nothing else changed: the same events as before.
  d.state.toggleSource("jenkins");
  expect(d.state.hidden().size).toBe(0);
  expect([d.state.eventCount(), d.state.totalCount()]).toEqual([3, 3]);
});

test("what the providers hold now joins the read events: a running build shows, and the read event wins once it ends", async () => {
  const SHA = "b".repeat(40);
  const finished: DashboardEvent = {
    id: "/shop:jenkins:7",
    app: "/shop",
    source: "jenkins",
    time: NOW - 5 * 60_000,
    status: "pass",
    text: "dev #7 passed",
    sha: SHA,
    branch: "dev",
  };
  const [live, setLive] = createSignal<DashboardEvent[]>([]);
  const [loaded, setLoaded] = createSignal<DashboardEvent[]>([]);
  const [active] = createSignal(true);
  const state = createRoot(dispose => {
    cleanup.push(dispose);
    return useDashboard({
      app: () => SHOP,
      active,
      now: () => NOW,
      live,
      load: async () => loaded(),
    });
  });
  await settle();
  const running: DashboardEvent = { ...finished, status: "running", text: "dev #7 running", time: NOW - 60_000 };
  const { branch: _branch, ...unbranched } = running;
  // The provider names no branch: the one a read event of the same commit has fills in.
  setLoaded([{ ...event("/shop", 30), sha: SHA, branch: "dev" }]);
  await state.reload();
  setLive([unbranched, { ...running, id: "/shop:jenkins:1", time: NOW - 9 * 24 * 3_600_000 }]);
  const texts = () => state.rows().flatMap(row => (row.kind === "event" ? [row.event.text] : []));
  expect(texts()).toEqual(["dev #7 running", "/shop 30"]);
  expect(state.rows().find(row => row.kind === "event" && row.event.id === finished.id)).toMatchObject({
    event: { branch: "dev" },
  });
  expect(state.totalCount()).toBe(2);

  // It ended: its provider holds the end and wrote it, with the same time. The read event, one copy.
  setLoaded([finished, { ...event("/shop", 30), sha: SHA, branch: "dev" }]);
  setLive([{ ...unbranched, status: "pass", text: "dev #7 passed", time: finished.time }]);
  await state.reload();
  expect(texts()).toEqual(["dev #7 passed", "/shop 30"]);

  // A hidden provider hides what it holds too.
  state.toggleSource("jenkins");
  expect(texts()).toEqual(["/shop 30"]);
});

test("another app shows none of the previous app's events while its own are read", async () => {
  const [app, setApp] = createSignal(SHOP);
  const [active] = createSignal(true);
  let release: () => void = () => {};
  const state = createRoot(dispose => {
    cleanup.push(dispose);
    return useDashboard({
      app,
      active,
      now: () => NOW,
      load: path =>
        path === SHOP.path
          ? Promise.resolve([event(SHOP.path, 5)])
          : new Promise(resolve => {
              release = () => resolve([event(WEB.path, 7)]);
            }),
    });
  });
  await settle();
  expect(state.selected()?.app).toBe(SHOP.path);
  setApp(WEB);
  // Still reading the web app: nothing of the shop, which an Enter would switch back to.
  expect(state.selected()).toBeNull();
  expect(state.totalCount()).toBe(0);
  release();
  await settle();
  expect(state.selected()?.app).toBe(WEB.path);
});

test("a run going again under the same id (a GitHub re-run) shows as it is now, not as its cached end", async () => {
  const failed: DashboardEvent = {
    id: "/shop:github-actions:1",
    app: "/shop",
    source: "github-actions",
    time: NOW - 30 * 60_000,
    status: "fail",
    text: "CI #9 failed",
    sha: "c".repeat(40),
  };
  const [live] = createSignal<DashboardEvent[]>([
    { ...failed, time: NOW - 60_000, status: "running", text: "CI #9 running" },
  ]);
  const [active] = createSignal(true);
  const state = createRoot(dispose => {
    cleanup.push(dispose);
    return useDashboard({ app: () => SHOP, active, now: () => NOW, live, load: async () => [failed] });
  });
  await settle();
  const texts = state.rows().flatMap(row => (row.kind === "event" ? [row.event.text] : []));
  expect(texts).toEqual(["CI #9 running"]);
});

test("only an app's first read shows as reading: reading it again keeps its events and stays quiet", async () => {
  const [active] = createSignal(true);
  let release: () => void = () => {};
  const state = createRoot(dispose => {
    cleanup.push(dispose);
    return useDashboard({
      app: () => SHOP,
      active,
      now: () => NOW,
      load: () =>
        new Promise(resolve => {
          release = () => resolve([event(SHOP.path, 5)]);
        }),
    });
  });
  await settle();
  expect(state.loading()).toBe(true);
  release();
  await settle();
  expect(state.loading()).toBe(false);
  // Read again (a provider wrote, r, the graph changed): no reading label, the events stay.
  const again = state.reload();
  await settle();
  expect(state.loading()).toBe(false);
  expect(state.totalCount()).toBe(1);
  release();
  await again;
});

test("a provider turned off shows none of its cached events", async () => {
  const [sources, setSources] = createSignal<ReadonlySet<string>>(new Set(["git", "jenkins"]));
  const [active] = createSignal(true);
  const build: DashboardEvent = {
    ...event(SHOP.path, 5),
    id: "/shop:jenkins:1",
    source: "jenkins",
    text: "main #1 passed",
  };
  const state = createRoot(dispose => {
    cleanup.push(dispose);
    return useDashboard({
      app: () => SHOP,
      active,
      now: () => NOW,
      shownSources: sources as () => ReadonlySet<"git" | "jenkins">,
      load: async () => [build, event(SHOP.path, 10)],
    });
  });
  await settle();
  expect(state.totalCount()).toBe(2);
  setSources(new Set(["git"]));
  expect(state.totalCount()).toBe(1);
  expect(state.rows().some(row => row.kind === "event" && row.event.source === "jenkins")).toBe(false);
});

test("back to an app read before, its events show at once while they are read again, without a reading label", async () => {
  const [app, setApp] = createSignal(SHOP);
  const [active] = createSignal(true);
  let release: () => void = () => {};
  let first = true;
  const state = createRoot(dispose => {
    cleanup.push(dispose);
    return useDashboard({
      app,
      active,
      now: () => NOW,
      load: path => {
        if (path === WEB.path || first) {
          first = path === WEB.path ? first : false;
          return Promise.resolve([event(path, 5)]);
        }
        return new Promise(resolve => {
          release = () => resolve([event(SHOP.path, 5), event(SHOP.path, 6)]);
        });
      },
    });
  });
  await settle();
  setApp(WEB);
  await settle();
  expect(state.selected()?.app).toBe(WEB.path);
  setApp(SHOP);
  await settle();
  expect(state.loading()).toBe(false);
  expect(state.selected()?.app).toBe(SHOP.path);
  expect(state.totalCount()).toBe(1);
  release();
  await settle();
  expect(state.totalCount()).toBe(2);
});
