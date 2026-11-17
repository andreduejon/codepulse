import { batch, createContext, createMemo, createSignal, untrack, useContext } from "solid-js";
import { DEFAULT_MAX_COUNT } from "../constants";
import { providerIdle } from "../core/provider-status";
import type { Branch, Commit, CommitDetail, GraphRow, TagInfo, UncommittedDetail } from "../git/types";
import type { KeyboardScope } from "../keyboard/scope";
import { createProviderRegistry, type GraphBadge, type ProviderView } from "../providers/provider";
import { matchCommit, parseSearchQuery } from "../search";
import type { AppActions, AppState, DetailOwner, DetailTab, HighlightMode, ProviderStatus } from "./app-state-types";

export type {
  AppActions,
  AppState,
  DetailActions,
  DetailOwner,
  DetailSlotActions,
  DetailSlotState,
  DetailState,
  DetailTab,
  FilterActions,
  FilterState,
  HighlightMode,
  NavActions,
  NavState,
  ProviderActions,
  ProviderAppState,
  ProviderStatus,
  RepoActions,
  RepoState,
  SettingsActions,
  SettingsState,
} from "./app-state-types";

export const DEFAULT_AUTO_REFRESH_INTERVAL = 30000;
export const DEFAULT_AUTO_FETCH_INTERVAL = 0;

export {
  providerError,
  providerIdle,
  providerLoading,
  providerStatusMessage,
  providerUnavailable,
  providerWarning,
} from "../core/provider-status";

const AppStateContext = createContext<{ state: AppState; actions: AppActions }>();

export function createAppState(
  initialMaxCount: number = DEFAULT_MAX_COUNT,
  initialAutoRefreshInterval?: number,
  initialAutoFetchInterval?: number,
  initialShowAllBranches: boolean = true,
) {
  // ── Repository data ───────────────────────────────────────────────
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [graphRows, setGraphRows] = createSignal<GraphRow[]>([]);
  const [branches, setBranches] = createSignal<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = createSignal("");
  const [repoPath, setRepoPath] = createSignal("");
  const [remoteUrl, setRemoteUrl] = createSignal("");
  const [tagDetails, setTagDetails] = createSignal<Map<string, TagInfo>>(new Map());
  const [stashByParent, setStashByParent] = createSignal<Map<string, Commit[]>>(new Map());
  const providers = createProviderRegistry();

  // ── Navigation & selection ────────────────────────────────────────
  const [cursorIndex, setCursorIndex] = createSignal(0);
  const [scrollTargetIndex, setScrollTargetIndex] = createSignal(0);
  const [pendingScrollHash, setPendingScrollHash] = createSignal<string | null>(null);
  const [commitDetail, setCommitDetail] = createSignal<CommitDetail | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [viewingBranch, setViewingBranch] = createSignal<string | null>(null);

  // ── Path filtering ────────────────────────────────────────────────────
  const [pathFilter, setPathFilter] = createSignal<string | null>(null);
  const [pathMatchSet, setPathMatchSet] = createSignal<Set<string> | null>(null);

  // ── Ancestry highlighting ─────────────────────────────────────────────
  const [ancestrySet, setAncestrySet] = createSignal<Set<string> | null>(null);

  // ── Detail panel ──────────────────────────────────────────────────
  /**
   * The details' cursor, tab and focus, one set per view that has details: the graph's (Git and the provider views)
   * and the Dashboard's. Moving between them leaves each where it was. `state.detailFocused()` and the others read the
   * shown view's; `detailFor` reaches one by name.
   */
  const makeDetailSlot = (initialTab: DetailTab) => {
    const [focused, setFocused] = createSignal(false);
    const [cursorIndex, setCursorIndex] = createSignal(-1);
    const [cursorAction, setCursorAction] = createSignal<string | null>(null);
    const [activeTab, setActiveTab] = createSignal<DetailTab>(initialTab);
    const [cursorShortcut, setCursorShortcut] = createSignal<{ key: string; desc: string } | null>(null);
    const moveCursor = (delta: number, itemCount: number) => {
      if (itemCount === 0) return;
      setCursorIndex(Math.max(0, Math.min(itemCount - 1, cursorIndex() + delta)));
    };
    return {
      state: {
        detailFocused: focused,
        detailCursorIndex: cursorIndex,
        detailCursorAction: cursorAction,
        detailActiveTab: activeTab,
        detailCursorShortcut: cursorShortcut,
      },
      actions: {
        setDetailFocused: (value: boolean) => setFocused(value),
        setDetailCursorIndex: (value: number) => setCursorIndex(value),
        moveDetailCursor: moveCursor,
        setDetailCursorAction: (value: string | null) => setCursorAction(value),
        setDetailActiveTab: (value: DetailTab) => setActiveTab(value),
        setDetailCursorShortcut: (value: { key: string; desc: string } | null) => setCursorShortcut(value),
      },
    };
  };
  const detailSlots: Record<DetailOwner, ReturnType<typeof makeDetailSlot>> = {
    graph: makeDetailSlot("files"),
    dashboard: makeDetailSlot("info"),
  };
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [snykPendingFilter, setSnykPendingFilter] = createSignal<string | null>(null);
  const [uncommittedDetail, setUncommittedDetail] = createSignal<UncommittedDetail | null>(null);
  const [workingTreeReads, setWorkingTreeReads] = createSignal(0);

  // ── UI state & settings ───────────────────────────────────────────
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [showAllBranches, setShowAllBranches] = createSignal(initialShowAllBranches);
  const [maxGraphColumns, setMaxGraphColumns] = createSignal(0);
  const [maxCount, setMaxCount] = createSignal(initialMaxCount);
  const [autoRefreshInterval, setAutoRefreshInterval] = createSignal(
    initialAutoRefreshInterval ?? DEFAULT_AUTO_REFRESH_INTERVAL,
  );
  const [autoFetchInterval, setAutoFetchInterval] = createSignal(
    initialAutoFetchInterval ?? DEFAULT_AUTO_FETCH_INTERVAL,
  );
  const [lastFetchTime, setLastFetchTime] = createSignal<Date | null>(null);
  const [fetching, setFetchingSignal] = createSignal(false);
  const [fetchingHistory, setFetchingHistory] = createSignal(false);
  const setFetching = (value: boolean, history = false) =>
    batch(() => {
      setFetchingSignal(value);
      setFetchingHistory(value && history);
    });
  const [hasMore, setHasMore] = createSignal(true);
  /** The last page of older history failed to load; scrolling to the end retries. */
  const [historyError, setHistoryError] = createSignal(false);

  // ── Provider / CI ─────────────────────────────────────────────────
  const [activeProviderView, setActiveProviderView] = createSignal<ProviderView>("git");
  /** The view whose details show: read tracked by what shows them, untracked by what changes them. */
  const detailOwner = (): DetailOwner => (activeProviderView() === "dashboard" ? "dashboard" : "graph");
  const shownDetail = () => detailSlots[detailOwner()];
  const changedDetail = () => detailSlots[untrack(detailOwner)];
  const [providerGraphBadges, setProviderGraphBadges] = createSignal<Map<ProviderView, Map<string, GraphBadge>>>(
    new Map(),
  );
  const [providerStatusMap, setProviderStatusMap] = createSignal<Map<ProviderView, ProviderStatus>>(new Map());
  const graphBadges = createMemo(() => providerGraphBadges().get(activeProviderView()) ?? new Map());
  const providerStatus = createMemo(() => providerStatusMap().get(activeProviderView()) ?? providerIdle());
  const [providerLastSuccessfulRefresh, setProviderLastSuccessfulRefreshMap] = createSignal<Map<ProviderView, Date>>(
    new Map(),
  );
  const [keyboardScopeOverride, setKeyboardScopeOverride] = createSignal<KeyboardScope | null>(null);

  // ── Search memo ───────────────────────────────────────────────────
  // Memoize parsed search separately so regex compilation only happens when
  // the query text changes, not on every graphRows update (e.g. auto-refresh).
  const parsedSearch = createMemo(() => {
    const query = searchQuery();
    return query ? parseSearchQuery(query) : null;
  });

  // ── Unified highlight system ──────────────────────────────────────
  // Priority: ancestry > path > search. Only one mode active at a time
  // (mutual exclusion enforced by the keyboard handler / command dispatch).

  const highlightMode = createMemo((): HighlightMode => {
    if (ancestrySet()) return "ancestry";
    if (pathMatchSet()) return "path";
    if (searchQuery()) return "search";
    return null;
  });

  // Mutable ref caching the last search-derived highlight set.
  // createMemo uses reference equality (===), so returning a new Set on every
  // graphRows() change (e.g. pagination, auto-refresh) would trigger downstream
  // recomputation even when the matching hashes are identical. By returning the
  // cached reference when contents are unchanged we avoid spurious re-renders —
  // the same pattern used in use-ancestry.ts for ancestrySet.
  // (AGENTS.md rule 3: mutable refs for state that must survive multiple effect firings.)
  let prevSearchSet: Set<string> | null = null;

  const highlightSet = createMemo((): Set<string> | null => {
    const aSet = ancestrySet();
    if (aSet) return aSet;

    const pSet = pathMatchSet();
    if (pSet) return pSet;

    const parsed = parsedSearch();
    if (parsed) {
      const matches = new Set<string>();
      for (const row of graphRows()) {
        if (matchCommit(row.commit, parsed)) matches.add(row.commit.hash);
      }
      const newSet = matches.size > 0 ? matches : new Set<string>();
      // Structural equality check: return cached ref when contents are unchanged
      // so downstream dimming/navigation memos don't recompute unnecessarily.
      if (prevSearchSet !== null && prevSearchSet.size === newSet.size) {
        let same = true;
        for (const h of newSet) {
          if (!prevSearchSet.has(h)) {
            same = false;
            break;
          }
        }
        if (same) return prevSearchSet;
      }
      prevSearchSet = newSet;
      return newSet;
    }

    prevSearchSet = null;
    return null;
  });

  // ── Selection memos (always use full graphRows) ───────────────────
  const selectedCommit = createMemo(() => {
    const rows = graphRows();
    const idx = cursorIndex();
    return idx >= 0 && idx < rows.length ? rows[idx].commit : null;
  });

  const selectedRow = createMemo(() => {
    const rows = graphRows();
    const idx = cursorIndex();
    return idx >= 0 && idx < rows.length ? rows[idx] : null;
  });

  const moveCursor = (delta: number) => {
    const rows = graphRows();
    const newIndex = Math.max(0, Math.min(rows.length - 1, cursorIndex() + delta));
    setCursorIndex(newIndex);
    setScrollTargetIndex(newIndex);
  };

  const state: AppState = {
    commits,
    graphRows,
    branches,
    currentBranch,
    repoPath,
    remoteUrl,
    tagDetails,
    stashByParent,
    error,
    cursorIndex,
    selectedCommit,
    selectedRow,
    commitDetail,
    loading,
    showAllBranches,
    searchQuery,
    maxGraphColumns,
    maxCount,
    autoRefreshInterval,
    autoFetchInterval,
    detailFocused: () => shownDetail().state.detailFocused(),
    detailCursorIndex: () => shownDetail().state.detailCursorIndex(),
    scrollTargetIndex,
    pendingScrollHash,
    lastFetchTime,
    fetching,
    fetchingHistory,
    hasMore,
    historyError,
    detailLoading,
    detailCursorAction: () => shownDetail().state.detailCursorAction(),
    detailActiveTab: () => shownDetail().state.detailActiveTab(),
    detailCursorShortcut: () => shownDetail().state.detailCursorShortcut(),
    detailFor: owner => detailSlots[owner].state,
    snykPendingFilter,
    uncommittedDetail,
    workingTreeReads,
    viewingBranch,
    pathFilter,
    pathMatchSet,
    ancestrySet,
    highlightSet,
    highlightMode,
    activeProviderView,
    graphBadges,
    providerStatus,
    providerStatusFor: view => providerStatusMap().get(view) ?? providerIdle(),
    graphBadgesFor: view => providerGraphBadges().get(view) ?? new Map(),
    providerLastSuccessfulRefresh,
    keyboardScopeOverride,
    providers,
  };

  const actions: AppActions = {
    setCursorIndex,
    moveCursor,
    setScrollTargetIndex,
    setPendingScrollHash,
    setCommitDetail,
    setLoading,
    setShowAllBranches,
    setSearchQuery,
    setDetailFocused: value => changedDetail().actions.setDetailFocused(value),
    setDetailCursorIndex: value => changedDetail().actions.setDetailCursorIndex(value),
    moveDetailCursor: (delta, itemCount) => changedDetail().actions.moveDetailCursor(delta, itemCount),
    setCommits,
    setGraphRows,
    setBranches,
    setCurrentBranch,
    setRepoPath,
    setRemoteUrl,
    setTagDetails,
    setStashByParent,
    setError,
    setMaxGraphColumns,
    setMaxCount,
    setAutoRefreshInterval,
    setAutoFetchInterval,
    setLastFetchTime,
    setFetching,
    setHasMore,
    setHistoryError,
    setAncestrySet,
    setDetailLoading,
    setDetailCursorAction: value => changedDetail().actions.setDetailCursorAction(value),
    setDetailActiveTab: value => changedDetail().actions.setDetailActiveTab(value),
    setDetailCursorShortcut: value => changedDetail().actions.setDetailCursorShortcut(value),
    detailFor: owner => detailSlots[owner].actions,
    setSnykPendingFilter,
    setUncommittedDetail,
    noteWorkingTreeRead: () => setWorkingTreeReads(count => count + 1),
    setViewingBranch,
    setPathFilter,
    setPathMatchSet,
    setActiveProviderView,
    setGraphBadges: (view, map) => {
      setProviderGraphBadges(prev => {
        const next = new Map(prev);
        next.set(view, map);
        return next;
      });
    },
    setProviderStatus: (view, status) => {
      setProviderStatusMap(prev => {
        const next = new Map(prev);
        next.set(view, status);
        return next;
      });
    },
    setProviderLastSuccessfulRefresh: (view, time) => {
      setProviderLastSuccessfulRefreshMap(prev => {
        const next = new Map(prev);
        next.set(view, time);
        return next;
      });
    },
    clearProviderState: () => {
      setProviderGraphBadges(new Map());
      setProviderStatusMap(new Map());
      setProviderLastSuccessfulRefreshMap(new Map());
    },
    setKeyboardScopeOverride,
    cycleProviderView: () => setActiveProviderView(providers.nextView(activeProviderView())),
  };

  return { state, actions };
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export { AppStateContext };
