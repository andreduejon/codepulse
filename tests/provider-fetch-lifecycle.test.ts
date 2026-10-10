import { afterEach, describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createAppState } from "../src/context/state";
import { useProviderFetchLifecycle } from "../src/providers/shared/use-provider-fetch-lifecycle";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("useProviderFetchLifecycle", () => {
  test("queues a second fetch while one is in flight", async () => {
    let resolveFirst!: () => void;
    let initialCalls = 0;
    createRoot(dispose => {
      disposers.push(dispose);
      const { state, actions } = createAppState(100, 0, 0);
      actions.setAutoRefreshInterval(0);
      const lifecycle = useProviderFetchLifecycle({
        state,
        providerId: "jenkins",
        identity: () => "id",
        isAvailable: () => true,
        isBackgroundReady: () => false,
        skipShaBackground: true,
        queriedSHAs: new Set(),
        reportUnavailable: () => {},
        runInitialFetch: async () => {
          initialCalls++;
          if (initialCalls === 1) {
            await new Promise<void>(r => {
              resolveFirst = r;
            });
          }
        },
        runRefresh: async () => {},
        onResetCaches: () => {},
      });
      void lifecycle.fetchInitial();
      void lifecycle.fetchInitial();
    });
    expect(initialCalls).toBe(1);
    resolveFirst();
    await new Promise(r => setTimeout(r, 10));
    expect(initialCalls).toBe(2);
  });

  test("resetCaches bumps epoch and notifies owner", () => {
    let resets = 0;
    createRoot(dispose => {
      disposers.push(dispose);
      const { state, actions } = createAppState(100, 0, 0);
      actions.setAutoRefreshInterval(0);
      const lifecycle = useProviderFetchLifecycle({
        state,
        providerId: "jenkins",
        identity: () => "id",
        isAvailable: () => true,
        isBackgroundReady: () => false,
        skipShaBackground: true,
        queriedSHAs: new Set(),
        reportUnavailable: () => {},
        runInitialFetch: async () => {},
        runRefresh: async () => {},
        onResetCaches: () => {
          resets++;
        },
      });
      expect(lifecycle.getEpoch()).toBe(0);
      lifecycle.resetCaches();
      expect(lifecycle.getEpoch()).toBe(1);
    });
    expect(resets).toBe(1);
  });

  test("resetCaches aborts active work and invalidates captured repository context", async () => {
    let signal: AbortSignal | undefined;
    let lifecycle!: ReturnType<typeof useProviderFetchLifecycle>;
    createRoot(dispose => {
      disposers.push(dispose);
      const { state, actions } = createAppState(100, 0, 0);
      actions.setRepoPath("/repo-a");
      actions.setAutoRefreshInterval(0);
      lifecycle = useProviderFetchLifecycle({
        state,
        providerId: "jenkins",
        identity: () => state.repoPath(),
        isAvailable: () => true,
        isBackgroundReady: () => false,
        skipShaBackground: true,
        queriedSHAs: new Set(),
        reportUnavailable: () => {},
        runInitialFetch: async args => {
          signal = args.signal;
          await new Promise<void>(() => {});
        },
        runRefresh: async () => {},
        onResetCaches: () => {},
      });
      void lifecycle.fetchInitial(new AbortController().signal);
      const epoch = lifecycle.getEpoch();
      expect(lifecycle.isCurrent(epoch, "/repo-a")).toBe(true);
      lifecycle.resetCaches();
      expect(lifecycle.isCurrent(epoch, "/repo-a")).toBe(false);
    });
    expect(signal?.aborted).toBe(true);
  });

  test("repository path mismatch invalidates captured work before reactive reset", () => {
    createRoot(dispose => {
      disposers.push(dispose);
      const { state, actions } = createAppState(100, 0, 0);
      actions.setRepoPath("/repo-a");
      const lifecycle = useProviderFetchLifecycle({
        state,
        providerId: "jenkins",
        identity: () => state.repoPath(),
        isAvailable: () => true,
        isBackgroundReady: () => false,
        skipShaBackground: true,
        queriedSHAs: new Set(),
        reportUnavailable: () => {},
        runInitialFetch: async () => {},
        runRefresh: async () => {},
        onResetCaches: () => {},
      });
      const epoch = lifecycle.getEpoch();
      actions.setRepoPath("/repo-b");
      expect(lifecycle.isCurrent(epoch, "/repo-a")).toBe(false);
    });
  });

  test("repo switches settle cancelled initial fetches and refreshes without rejecting", async () => {
    let lifecycle!: ReturnType<typeof useProviderFetchLifecycle>;
    const waitForAbort = ({ signal }: { signal?: AbortSignal }) =>
      new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    createRoot(dispose => {
      disposers.push(dispose);
      const { state } = createAppState(100, 0, 0);
      lifecycle = useProviderFetchLifecycle({
        state,
        providerId: "jenkins",
        identity: () => "id",
        isAvailable: () => true,
        isBackgroundReady: () => false,
        skipShaBackground: true,
        queriedSHAs: new Set(),
        reportUnavailable: () => {},
        runInitialFetch: waitForAbort,
        runRefresh: waitForAbort,
        onResetCaches: () => {},
      });
    });
    const initial = lifecycle.fetchInitial();
    lifecycle.resetCaches();
    await expect(initial).resolves.toBeUndefined();
    const refresh = lifecycle.fetchRefresh();
    lifecycle.resetCaches();
    await expect(refresh).resolves.toBeUndefined();
  });

  test("clearProviderState removes badges, statuses, and refresh timestamps", () => {
    createRoot(dispose => {
      disposers.push(dispose);
      const { state, actions } = createAppState();
      actions.setActiveProviderView("jenkins");
      actions.setGraphBadges(
        "jenkins",
        new Map([
          [
            "sha",
            {
              sha: "sha",
              badge: "pass",
              passCount: 1,
              failCount: 0,
              runningCount: 0,
              latestRunAt: "now",
              latestStatus: "pass",
            },
          ],
        ]),
      );
      actions.setProviderStatus("jenkins", { kind: "error", message: "old repo" });
      actions.setProviderLastSuccessfulRefresh("jenkins", new Date());

      actions.clearProviderState();

      expect(state.graphBadges()).toEqual(new Map());
      expect(state.providerStatusFor("jenkins")).toEqual({ kind: "idle" });
      expect(state.providerLastSuccessfulRefresh()).toEqual(new Map());
    });
  });

  test("reports unavailable instead of fetching", () => {
    let reported = false;
    let fetched = false;
    createRoot(dispose => {
      disposers.push(dispose);
      const { state, actions } = createAppState(100, 0, 0);
      actions.setAutoRefreshInterval(0);
      const lifecycle = useProviderFetchLifecycle({
        state,
        providerId: "jenkins",
        identity: () => "id",
        isAvailable: () => false,
        isBackgroundReady: () => false,
        skipShaBackground: true,
        queriedSHAs: new Set(),
        reportUnavailable: showStatus => {
          reported = showStatus;
        },
        runInitialFetch: async () => {
          fetched = true;
        },
        runRefresh: async () => {},
        onResetCaches: () => {},
      });
      void lifecycle.fetchInitial(undefined, undefined, true);
    });
    expect(reported).toBe(true);
    expect(fetched).toBe(false);
  });

  test("skips auto refresh during backoff and allows a manual refresh", async () => {
    let refreshes = 0;
    await new Promise<void>(resolve => {
      createRoot(dispose => {
        disposers.push(dispose);
        const { state, actions } = createAppState(100, 0, 0);
        actions.setAutoRefreshInterval(0);
        const lifecycle = useProviderFetchLifecycle({
          state,
          providerId: "jenkins",
          identity: () => "id",
          isAvailable: () => true,
          isBackgroundReady: () => false,
          skipShaBackground: true,
          queriedSHAs: new Set(),
          reportUnavailable: () => {},
          runInitialFetch: async () => {},
          runRefresh: async () => {
            refreshes++;
          },
          onResetCaches: () => {},
        });
        lifecycle.noteFetchResult(false);
        void lifecycle.fetchRefresh(undefined, false).then(() => lifecycle.fetchRefresh(undefined, true).then(resolve));
      });
    });
    expect(refreshes).toBe(1);
  });
});
