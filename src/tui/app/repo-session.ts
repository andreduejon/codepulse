/**
 * The open repository and moving between repositories: the group's arrows, the project selector and a Dashboard jump
 * all switch through here. The apps left last keep their graph and scroll position, so coming back shows them at
 * once; what belongs to the repository left (dialogs, filters, notices, provider data) goes. Also the cache screen,
 * which pauses the providers while it is open.
 */

import { type Accessor, batch, createEffect, createSignal, onCleanup, type Setter } from "solid-js";
import type { CacheRepositorySummary, CacheStorePort } from "../../core/cache-store";
import { mergeOptions, startViewFor } from "../../core/settings/config";
import { RECENT_APPS } from "../constants";
import type { AppActions, AppState } from "../context/state";
import { nextGroupRepoPath } from "../utils/group-repos";
import { rememberRecent } from "../utils/recent";
import { applyRepoSession, captureRepoSession } from "./app-repo-session";
import type { RepoSessionSnapshot } from "./app-types";
import type { ProviderHost } from "./providers";
import type { RepoSettings } from "./repo-settings";

export function useRepoSession(opts: {
  state: AppState;
  actions: AppActions;
  repoPath: Accessor<string>;
  setRepoPath: Setter<string>;
  settings: RepoSettings;
  providers: Pick<ProviderHost, "invalidateAll">;
  cacheScreenVisible: Accessor<boolean>;
  setCacheScreenVisible: Setter<boolean>;
  /** What belongs to the repository being left: dialogs, the command bar, highlights, notices, the details. */
  clearTransient: () => void;
  /** The graph's scroll position, read when leaving it and set when coming back. */
  graphScroll: { top: () => number; scrollTo: (top: number) => void };
  closeDialog: () => void;
  isDisposed: () => boolean;
  /** The providers' cache. */
  cacheStore: CacheStorePort;
}) {
  const { state, actions, settings } = opts;
  /** The project selector (Menu → Switch repository). */
  const [selectorVisible, setSelectorVisible] = createSignal(false);
  /** The apps left last keep their graph, so coming back shows it at once; older ones read again. */
  let sessions: ReadonlyMap<string, RepoSessionSnapshot> = new Map();

  // The graph's scroll position to restore once it is laid out (a repository shown again, the cache screen closed).
  const [pendingGraphScrollTop, setPendingGraphScrollTop] = createSignal<number | null>(null);
  let scrollRestoreVersion = 0;
  let scrollRestoreTimers: ReturnType<typeof setTimeout>[] = [];
  const cancelScrollRestore = () => {
    scrollRestoreVersion++;
    for (const timer of scrollRestoreTimers) clearTimeout(timer);
    scrollRestoreTimers = [];
  };
  createEffect(() => {
    const top = pendingGraphScrollTop();
    if (top == null || state.loading()) return;
    cancelScrollRestore();
    const version = scrollRestoreVersion;
    const path = opts.repoPath();
    const restore = () => {
      if (version !== scrollRestoreVersion || opts.repoPath() !== path || state.loading()) return;
      opts.graphScroll.scrollTo(top);
    };
    scrollRestoreTimers = [
      setTimeout(restore, 0),
      setTimeout(restore, 16),
      setTimeout(() => {
        restore();
        if (version !== scrollRestoreVersion || opts.repoPath() !== path || state.loading()) return;
        setPendingGraphScrollTop(null);
        scrollRestoreTimers = [];
      }, 50),
    ];
    onCleanup(cancelScrollRestore);
  });

  const save = (path: string) => {
    if (!path || state.repoPath() !== path || state.graphRows().length === 0) return;
    sessions = rememberRecent(sessions, path, captureRepoSession(state, opts.graphScroll.top()), RECENT_APPS);
  };

  const switchTo = (nextPath: string) => {
    const currentPath = opts.repoPath();
    if (!nextPath || nextPath === currentPath) return;
    cancelScrollRestore();
    setPendingGraphScrollTop(null);
    save(currentPath);
    actions.setActiveProviderView("git");
    opts.providers.invalidateAll();
    actions.clearProviderState();
    opts.clearTransient();
    setSelectorVisible(false);
    // Its own Preferences, before its graph loads: they are per repository, like at startup.
    const nextConfig = settings.read(nextPath);
    const nextOptions = mergeOptions({ repoPath: nextPath }, nextConfig);
    actions.setAutoFetchInterval(nextOptions.autoFetchInterval);
    actions.setAutoRefreshInterval(nextOptions.autoRefreshInterval);
    actions.setMaxCount(nextOptions.maxCount);
    actions.setShowAllBranches(nextConfig.showAllBranches ?? true);
    // One update: the loader sets the new path as soon as the active one changes, and nothing may see the new path
    // with the previous repository's branches (Snyk would scan their tips in the wrong repository).
    batch(() => {
      opts.setRepoPath(nextPath);
      const snapshot = sessions.get(nextPath);
      if (snapshot) {
        applyRepoSession(actions, snapshot);
        setPendingGraphScrollTop(snapshot.graphScrollTop);
      } else {
        // A repository not shown yet in this session opens in its start view; one shown before, where it was left.
        actions.setActiveProviderView(startViewFor(nextConfig, state.providers.set.definitions));
        actions.setCommits([]);
        actions.setGraphRows([]);
        actions.setBranches([]);
        actions.setCurrentBranch("");
        actions.setRepoPath(nextPath);
        actions.setRemoteUrl("");
        actions.setTagDetails(new Map());
        actions.setStashByParent(new Map());
        actions.setLoading(true);
      }
    });
  };

  /** Where the graph was when the cache screen opened: it comes back there. */
  let cacheGraphScrollTop = 0;

  return {
    /** Every repository the config knows. */
    knownRepos: () => settings.port.knownRepos(),
    switchTo,
    /** The previous or next app of the open one's group (`shift ←` / `shift →`). */
    switchInGroup: (direction: 1 | -1) => {
      const nextPath = nextGroupRepoPath(settings.port.knownRepos(), opts.repoPath(), direction, settings.display());
      if (nextPath) switchTo(nextPath);
    },
    selectorVisible,
    setSelectorVisible,
    /** A scroll position the graph waits to take; it keeps the graph from scrolling to the cursor meanwhile. */
    pendingGraphScrollTop,
    openCacheScreen: () => {
      cacheGraphScrollTop = opts.graphScroll.top();
      opts.closeDialog();
      opts.setCacheScreenVisible(true);
    },
    closeCacheScreen: () => {
      opts.setCacheScreenVisible(false);
      setPendingGraphScrollTop(cacheGraphScrollTop);
    },
    /** Removes a repository's cache; the open one's providers start over. */
    evictCache: async (repo: CacheRepositorySummary) => {
      const { hash } = await opts.cacheStore.identity(opts.repoPath());
      if (opts.isDisposed() || !opts.cacheScreenVisible()) throw new Error("Cache screen is closed.");
      const removed = opts.cacheStore.evictRepository(repo.repoHash);
      if (hash === repo.repoHash) opts.providers.invalidateAll();
      return removed;
    },
  };
}

export type RepoSession = ReturnType<typeof useRepoSession>;
