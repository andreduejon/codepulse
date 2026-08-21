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
});
