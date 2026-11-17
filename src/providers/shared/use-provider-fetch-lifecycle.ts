/**
 * The fetch lifecycle (core/fetch-lifecycle.ts) in a Solid component: effects tell it what changed — suspension, the
 * provider's identity, the view, the graph, the refresh period — and it reads the app state through accessors. The
 * lifecycle itself has no Solid in it.
 */
import { type Accessor, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { AppState } from "../../context/state";
import { FetchLifecycle, type LifecycleProvider } from "../../core/fetch-lifecycle";

export { DEFAULT_INITIAL_SHA_LIMIT, type ProviderFetchArgs } from "../../core/fetch-lifecycle";

export function useProviderFetchLifecycle(
  opts: LifecycleProvider & {
    state: AppState;
    suspended?: Accessor<boolean>;
    identity: () => string;
  },
) {
  const { state } = opts;
  const suspended = () => opts.suspended?.() ?? false;
  /** Bumped when the provider's data starts over: the effects below run again for the new data. */
  const [identityVersion, setIdentityVersion] = createSignal(0);
  const [activeFetches, setActiveFetches] = createSignal(0);

  const lifecycle = new FetchLifecycle(
    {
      view: state.activeProviderView,
      repoPath: state.repoPath,
      graphRows: state.graphRows,
      autoRefreshInterval: state.autoRefreshInterval,
      suspended,
      untracked: untrack,
      onReset: () => setIdentityVersion(version => version + 1),
      onActiveFetches: setActiveFetches,
    },
    opts,
  );

  createEffect(() => {
    if (suspended()) untrack(lifecycle.cancelRequests);
  });

  let previousIdentity = "";
  createEffect(() => {
    const identity = opts.identity();
    if (!previousIdentity) {
      previousIdentity = identity;
      return;
    }
    if (identity === previousIdentity) return;
    previousIdentity = identity;
    lifecycle.resetCaches();
  });

  // The lifecycle's own reads decide what these effects track, as when its code lived in them.
  createEffect(() => {
    identityVersion();
    lifecycle.onViewChange();
  });
  createEffect(() => {
    identityVersion();
    lifecycle.onGraphLoad();
  });
  createEffect(() => {
    identityVersion();
    lifecycle.onGraphCommits();
  });
  createEffect(() => lifecycle.onIntervalChange());

  onCleanup(lifecycle.dispose);

  return {
    getEpoch: lifecycle.getEpoch,
    isCurrent: lifecycle.isCurrent,
    noteFetchStarted: lifecycle.noteFetchStarted,
    noteRefreshSettled: lifecycle.noteRefreshSettled,
    noteFetchResult: lifecycle.noteFetchResult,
    resetCaches: lifecycle.resetCaches,
    startAutoRefresh: lifecycle.startAutoRefresh,
    fetchInitial: lifecycle.fetchInitial,
    fetchRefresh: lifecycle.fetchRefresh,
    runRequest: lifecycle.runRequest,
    trackFetch: lifecycle.trackFetch,
    /** True while a graph fetch, refresh or tracked reload runs. */
    isFetching: () => activeFetches() > 0,
  };
}
