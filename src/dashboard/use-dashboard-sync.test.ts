import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { BANNER } from "../debug/banner";
import type { CacheSyncResult } from "../providers/shared/cache-sync";
import type { DashboardEvent } from "./events";
import type { SyncTarget } from "./sync";
import { useDashboard } from "./use-dashboard";

const MINUTE = 60_000;
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * A dashboard over shop (GitHub every 2 minutes, Jenkins only when shown or refreshed) and web (GitHub every 2
 * minutes), with a clock the test moves and syncs that finish when the test says so.
 */
function syncedDashboard() {
  const [active, setActive] = createSignal(false);
  let now = Date.parse("2026-11-15T10:00:00Z");
  const targets: Record<string, SyncTarget[]> = {
    "/shop": [
      { app: "/shop", source: "github-actions", intervalMs: 2 * MINUTE },
      { app: "/shop", source: "jenkins", intervalMs: 0 },
    ],
    "/web": [{ app: "/web", source: "github-actions", intervalMs: 2 * MINUTE }],
  };
  const runs: string[] = [];
  const pending: Array<(result?: CacheSyncResult) => void> = [];
  const answers = new Map<string, CacheSyncResult>();
  const loads: string[] = [];
  const state = createRoot(() =>
    useDashboard({
      apps: () => [
        { path: "/shop", name: "shop" },
        { path: "/web", name: "web" },
      ],
      active,
      now: () => now,
      tickMs: 5,
      load: async app => {
        loads.push(app);
        return [] as DashboardEvent[];
      },
      sync: {
        targets: app => targets[app] ?? [],
        run: target =>
          new Promise(resolve => {
            const key = `${target.app} ${target.source}`;
            runs.push(key);
            pending.push(result => resolve(result ?? answers.get(key) ?? { error: null, authFailed: false }));
          }),
      },
    }),
  );
  const finishAll = async () => {
    for (const finish of pending.splice(0)) finish();
    await settle();
  };
  return {
    state,
    setActive,
    runs,
    loads,
    answers,
    finishAll,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("shown: every app's providers are asked, the footer says fetching, and the events are read again after", async () => {
  const d = syncedDashboard();
  await settle();
  expect(d.runs).toEqual([]);
  d.setActive(true);
  await settle();
  expect(d.runs.sort()).toEqual(["/shop github-actions", "/shop jenkins", "/web github-actions"]);
  expect(d.state.fetching()).toBe(true);
  const readsBefore = d.loads.length;
  await d.finishAll();
  expect(d.state.fetching()).toBe(false);
  expect(d.loads.length).toBeGreaterThan(readsBefore);
});

test("each provider is asked again once its own auto refresh is due; one without auto refresh is not", async () => {
  const d = syncedDashboard();
  d.setActive(true);
  await settle();
  await d.finishAll();
  d.runs.length = 0;
  d.advance(MINUTE);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(d.runs).toEqual([]);
  d.advance(MINUTE);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(d.runs.sort()).toEqual(["/shop github-actions", "/web github-actions"]);
});

test("hidden: nothing is asked, a sync running is stopped, and showing again asks only what is due", async () => {
  const d = syncedDashboard();
  d.setActive(true);
  await settle();
  await d.finishAll();
  d.setActive(false);
  d.runs.length = 0;
  d.advance(5 * MINUTE);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(d.runs).toEqual([]);
  d.setActive(true);
  await settle();
  expect(d.runs.sort()).toEqual(["/shop github-actions", "/web github-actions"]);
  d.setActive(false);
  await settle();
  expect(d.state.fetching()).toBe(false);
});

test("a refused token stops asking that provider of that app until refresh; refresh asks everything", async () => {
  const d = syncedDashboard();
  d.answers.set("/web github-actions", { error: BANNER.github.tokenExpired, authFailed: true });
  d.setActive(true);
  await settle();
  await d.finishAll();
  d.runs.length = 0;
  d.advance(3 * MINUTE);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(d.runs).toEqual(["/shop github-actions"]);
  await d.finishAll();
  d.runs.length = 0;
  void d.state.refresh();
  await settle();
  expect(d.runs.sort()).toEqual(["/shop github-actions", "/shop jenkins", "/web github-actions"]);
  await d.finishAll();
});
