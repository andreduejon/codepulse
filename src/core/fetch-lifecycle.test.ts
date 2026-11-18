/**
 * The fetch lifecycle on its own, without Solid: plain values for the app's state, a clock and timers moved by hand.
 */
import { expect, test } from "bun:test";
import { FetchLifecycle, type LifecycleProvider, type ProviderFetchArgs } from "./fetch-lifecycle";

function harness(options: { view?: string; interval?: number; fail?: boolean; hold?: Promise<void> } = {}) {
  const app = {
    view: options.view ?? "git",
    repoPath: "/repo",
    rows: [{ commit: { hash: "a".repeat(40) } }],
    interval: options.interval ?? 0,
    suspended: false,
  };
  let time = 1_000;
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;
  const calls: { kind: "initial" | "refresh"; args: ProviderFetchArgs }[] = [];
  let fail = options.fail ?? false;
  let lifecycle!: FetchLifecycle;
  const provider: LifecycleProvider = {
    providerId: "ci",
    isAvailable: () => true,
    isBackgroundReady: () => true,
    queriedSHAs: new Set(),
    skipShaBackground: true,
    reportUnavailable: () => {},
    runInitialFetch: async args => {
      calls.push({ kind: "initial", args });
      await options.hold;
      lifecycle.noteFetchStarted();
      lifecycle.noteFetchResult(!fail);
    },
    runRefresh: async args => {
      calls.push({ kind: "refresh", args });
      lifecycle.noteRefreshSettled();
      lifecycle.noteFetchResult(!fail);
    },
    onResetCaches: () => {},
  };
  lifecycle = new FetchLifecycle(
    {
      view: () => app.view,
      repoPath: () => app.repoPath,
      graphRows: () => app.rows,
      autoRefreshInterval: () => app.interval,
      suspended: () => app.suspended,
      untracked: fn => fn(),
      now: () => time,
      setInterval: (run, ms) => {
        const id = nextTimer++;
        timers.set(id, { run, ms });
        return id;
      },
      clearInterval: id => timers.delete(id as number),
      onReset: () => {},
      onActiveFetches: () => {},
    },
    provider,
  );
  return {
    app,
    lifecycle,
    calls,
    timers,
    setFail: (value: boolean) => {
      fail = value;
    },
    /** Moves the clock on and fires every timer due by then. */
    later: (ms: number) => {
      time += ms;
      for (const timer of [...timers.values()]) if (timer.ms <= ms) timer.run();
    },
    settle: () => new Promise(resolve => setTimeout(resolve, 0)),
  };
}

test("its view fetches once, showing status; the Dashboard fetches quietly; another view asks nothing", async () => {
  const h = harness();
  h.lifecycle.onViewChange();
  expect(h.calls).toHaveLength(0);
  h.app.view = "ci";
  h.lifecycle.onViewChange();
  await h.settle();
  expect(h.calls.map(call => [call.kind, call.args.showStatus])).toEqual([["initial", true]]);
  // Back soon: not stale yet, nothing asked.
  h.app.view = "dashboard";
  h.lifecycle.onViewChange();
  expect(h.calls).toHaveLength(1);
});

test("auto refresh runs on its timer while watched, and stops when the view goes", async () => {
  const h = harness({ view: "ci", interval: 60_000 });
  h.lifecycle.onViewChange();
  await h.settle();
  h.later(60_000);
  await h.settle();
  expect(h.calls.map(call => call.kind)).toEqual(["initial", "refresh"]);
  h.app.view = "git";
  h.lifecycle.onViewChange();
  expect(h.timers.size).toBe(0);
});

test("after two failures a quiet refresh waits out the backoff; a Reload asks at once", async () => {
  const h = harness({ view: "dashboard", fail: true });
  h.lifecycle.onViewChange();
  await h.settle();
  await h.lifecycle.fetchRefresh(undefined, true, true);
  expect(h.calls).toHaveLength(2);
  // A minute of backoff: 40 seconds on, a quiet refresh asks nothing.
  h.later(40_000);
  await h.lifecycle.fetchRefresh();
  expect(h.calls).toHaveLength(2);
  // A Reload shows status and asks anyway.
  h.setFail(false);
  await h.lifecycle.fetchRefresh(undefined, true, true);
  expect(h.calls).toHaveLength(3);
});

test("a Reload during a fetch runs after it, and its promise waits until then", async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  const h = harness({ view: "ci", hold });
  const first = h.lifecycle.fetchInitial(undefined, undefined, true);
  let reloaded = false;
  const reload = h.lifecycle.fetchRefresh(undefined, true, true).then(() => {
    reloaded = true;
  });
  await h.settle();
  expect(h.calls.map(call => call.kind)).toEqual(["initial"]);
  expect(reloaded).toBe(false);
  release();
  await first;
  await reload;
  expect(reloaded).toBe(true);
  expect(h.calls.map(call => call.kind)).toEqual(["initial", "refresh"]);
});
