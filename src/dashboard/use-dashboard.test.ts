import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import type { DashboardEvent } from "./events";
import { useDashboard } from "./use-dashboard";

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

async function dashboard(events: DashboardEvent[]) {
  const [active, setActive] = createSignal(false);
  const loads: string[] = [];
  const state = createRoot(() =>
    useDashboard({
      apps: () => [
        { path: "/shop", name: "shop" },
        { path: "/web", name: "web" },
      ],
      active,
      now: () => NOW,
      load: async app => {
        loads.push(app);
        return events.filter(item => item.app === app);
      },
    }),
  );
  return { state, setActive, loads };
}

test("reads only once shown; the cursor starts on the newest event and skips date and rope rows", async () => {
  const d = await dashboard([event("/shop", 5), event("/shop", 10), event("/web", 70)]);
  await settle();
  expect(d.loads).toEqual([]);
  d.setActive(true);
  await settle();
  expect(d.loads).toEqual(["/shop", "/web"]);
  expect(d.state.rows().map(row => row.kind)).toEqual(["date", "event", "event", "gap", "event"]);
  expect(d.state.cursor()).toBe(1);
  d.state.move(2);
  expect(d.state.cursor()).toBe(4);
  d.state.move(1);
  expect(d.state.cursor()).toBe(4);
  d.state.moveToEnd("first");
  expect(d.state.cursor()).toBe(1);
});

test("←/→ go through all apps, then each app; the event count follows", async () => {
  const d = await dashboard([event("/shop", 5), event("/web", 70)]);
  d.setActive(true);
  await settle();
  expect(d.state.eventCount()).toBe(2);
  d.state.cycleScope(1);
  expect(d.state.scope()).toBe("/shop");
  expect(d.state.shownApps().map(app => app.name)).toEqual(["shop"]);
  expect(d.state.eventCount()).toBe(1);
  d.state.cycleScope(1);
  expect(d.state.scope()).toBe("/web");
  d.state.cycleScope(1);
  expect(d.state.scope()).toBeNull();
  d.state.cycleScope(-1);
  expect(d.state.scope()).toBe("/web");
});

test("Enter on a knot's last row opens it and stays there; on an event it hands the event over", async () => {
  const d = await dashboard(Array.from({ length: 7 }, (_, index) => event("/shop", index + 1)));
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
