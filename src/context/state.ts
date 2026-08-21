import { createContext, createMemo, createSignal, useContext } from "solid-js";
import { DEFAULT_MAX_COUNT } from "../constants";
import type { Branch, Commit, CommitDetail, GraphRow, TagInfo, UncommittedDetail } from "../git/types";
import type { KeyboardScope } from "../keyboard/scope";
import { createProviderRegistry, type GraphBadge, type ProviderView } from "../providers/provider";
import { matchCommit, parseSearchQuery } from "../search";
import type { AppActions, AppState, DetailTab, HighlightMode, ProviderStatus } from "./app-state-types";

export type {
  AppActions,
  AppState,
  DetailActions,
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

export const providerIdle = (): ProviderStatus => ({ kind: "idle" });
export const providerLoading = (): ProviderStatus => ({ kind: "loading" });
export const providerUnavailable = (message: string): ProviderStatus => ({
  kind: "unavailable",
  message,
});
export const providerError = (message: string): ProviderStatus => ({ kind: "error", message });
export const providerWarning = (message: string): ProviderStatus => ({ kind: "warning", message });

export function providerStatusMessage(status: ProviderStatus): string | null {
  return status.kind === "error" || status.kind === "warning" || status.kind === "unavailable" ? status.message : null;
}

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
  const [detailFocused, setDetailFocused] = createSignal(false);
  const [detailCursorIndex, setDetailCursorIndex] = createSignal(-1);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailCursorAction, setDetailCursorAction] = createSignal<string | null>(null);
  const [detailActiveTab, setDetailActiveTab] = createSignal<DetailTab>("files");
  const [uncommittedDetail, setUncommittedDetail] = createSignal<UncommittedDetail | null>(null);

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
  const [fetching, setFetching] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(true);

  // ── Provider / CI ─────────────────────────────────────────────────
  const [activeProviderView, setActiveProviderView] = createSignal<ProviderView>("git");
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

  const moveDetailCursor = (delta: number, itemCount: number) => {
    if (itemCount === 0) return;
    const cur = detailCursorIndex();
    const next = Math.max(0, Math.min(itemCount - 1, cur + delta));
    setDetailCursorIndex(next);
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
    detailFocused,
    detailCursorIndex,
    scrollTargetIndex,
    pendingScrollHash,
    lastFetchTime,
    fetching,
    hasMore,
    detailLoading,
    detailCursorAction,
    detailActiveTab,
    uncommittedDetail,
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
    setDetailFocused,
    setDetailCursorIndex,
    moveDetailCursor,
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
    setAncestrySet,
    setDetailLoading,
    setDetailCursorAction,
    setDetailActiveTab,
    setUncommittedDetail,
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
