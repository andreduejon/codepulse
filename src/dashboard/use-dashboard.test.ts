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

function dashboard(events: DashboardEvent[], settings: DashboardSettings = { windowDays: 7, knotMinutes: 60 }) {
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

test("Enter on a knot's last row opens it and stays there; on an event it hands the event over", async () => {
  const d = dashboard(Array.from({ length: 7 }, (_, index) => event("/shop", index + 1)));
  d.setActive(true);
  await settle();
  expect(d.state.activate()).toMatchObject({ id: "/shop:1" });
  d.state.moveToEnd("last");
  expect(d.state.rows()[d.state.cursor()]).toMatchObject({ kind: "more", hidden: 2 });
  expect(d.state.activate()).toBeNull();
  expect(d.state.rows().filter(row => row.kind === "event")).toHaveLength(7);
  // The cursor stays in place, on the first event the knot had hidden.
  expect(d.state.rows()[d.state.cursor()]).toMatchObject({ kind: "event", event: { id: "/shop:6" } });
  // The cursor keeps its event when rows change: still the first one.
  d.state.moveToEnd("first");
  expect(d.state.activate()).toMatchObject({ id: "/shop:1" });
});

test("the time window decides how far back it reads, and a new window reads again", async () => {
  const d = dashboard([event("/shop", 5), event("/shop", 3 * 24 * 60)], { windowDays: 1, knotMinutes: 60 });
  d.setActive(true);
  await settle();
  expect(d.loads.at(-1)?.since).toBe(NOW - 24 * 3_600_000);
  expect(d.state.eventCount()).toBe(1);
  d.setConfig({ windowDays: 7, knotMinutes: 60 });
  await settle();
  expect(d.state.eventCount()).toBe(2);
});

test("the knot size decides which events share a knot, without reading again", async () => {
  const d = dashboard([event("/shop", 5), event("/shop", 25)], { windowDays: 7, knotMinutes: 15 });
  d.setActive(true);
  await settle();
  expect(d.state.rows().map(row => row.kind)).toEqual(["date", "event", "gap", "event"]);
  const reads = d.loads.length;
  d.setConfig({ windowDays: 7, knotMinutes: 60 });
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
