import type { Accessor } from "solid-js";
import { batch, createContext, createMemo, createSignal, untrack, useContext } from "solid-js";
import type {
  AppActions as CoreAppActions,
  AppState as CoreAppState,
  DetailSlotActions as CoreDetailSlotActions,
  DetailSlotState as CoreDetailSlotState,
  DetailOwner,
  DetailTab,
} from "../../core/app-state";
import { clampCursor, highlightModeOf, sameSet, searchMatches } from "../../core/app-state";
import type { Branch, Commit, CommitDetail, GraphRow, TagInfo, UncommittedDetail } from "../../core/git/types";
import type { GraphBadge, ProviderView } from "../../core/provider-model";
import type { ProviderSet } from "../../core/provider-set";
import type { ProviderStatus } from "../../core/provider-status";
import { providerIdle } from "../../core/provider-status";
import { parseSearchQuery } from "../../core/search";
import {
  DEFAULT_AUTO_FETCH_INTERVAL,
  DEFAULT_AUTO_REFRESH_INTERVAL,
  DEFAULT_MAX_COUNT,
} from "../../core/settings/config";
import { type MergePreview, type MergePreviewSpan, mergePreviewSpan as spanOf } from "../graph/merge-preview";
import { MAX_GRAPH_COLUMNS } from "../graph/viewport";
import type { MenuTab } from "../hooks/menu-items-types";
import { createProviderRegistry } from "../providers/provider";
import { defaultPorts } from "./ports";

export type {
  DetailActions,
  DetailOwner,
  DetailState,
  DetailTab,
  FilterActions,
  FilterState,
  HighlightMode,
  NavActions,
  NavState,
  ProviderActions,
  ProviderAppState,
  RepoActions,
  RepoState,
  SettingsActions,
  SettingsState,
} from "../../core/app-state";
export type { ProviderStatus } from "../../core/provider-status";
export {
  providerError,
  providerIdle,
  providerLoading,
  providerStatusMessage,
  providerUnavailable,
  providerWarning,
} from "../../core/provider-status";

/** An extra key the cursored detail row offers (footer hint), e.g. `v` → Vulnerabilities on a vulnerable dependency. */
export type CursorShortcut = { key: string; desc: string } | null;

/** One view's details, with what the terminal adds: the cursored row's extra key. */
export interface DetailSlotState extends CoreDetailSlotState {
  detailCursorShortcut: Accessor<CursorShortcut>;
}

export interface DetailSlotActions extends CoreDetailSlotActions {
  setDetailCursorShortcut: (shortcut: CursorShortcut) => void;
}

/** The app's state (core/app-state.ts) with the terminal's own: the Menu's tab and the detail rows' extra keys. */
export interface AppState extends Omit<CoreAppState, "detailFor"> {
  detailFor: (owner: DetailOwner) => DetailSlotState;
  /** The shown view's cursored detail row's extra key. */
  detailCursorShortcut: Accessor<CursorShortcut>;
  /** The tab the Menu opens on: the one it was left on, or the one a command (`:providers`) asked for. */
  menuTab: Accessor<MenuTab>;
  /** The merge the graph previews (a pull request's, while its tab is open), and where its line runs; null for none. */
  mergePreviewSpan: Accessor<MergePreviewSpan | null>;
  /** The entry the graph's details put the cursor on for a commit: the Dashboard event "Show in" jumped from. */
  graphDetailTarget: Accessor<{ sha: string; entry: string } | null>;
}

export interface AppActions extends Omit<CoreAppActions, "detailFor"> {
  detailFor: (owner: DetailOwner) => DetailSlotActions;
  setDetailCursorShortcut: (shortcut: CursorShortcut) => void;
  setMenuTab: (tab: MenuTab) => void;
  setMergePreview: (preview: MergePreview | null) => void;
  setGraphDetailTarget: (target: { sha: string; entry: string } | null) => void;
}

const AppStateContext = createContext<{ state: AppState; actions: AppActions }>();

export function createAppState(
  initialMaxCount: number = DEFAULT_MAX_COUNT,
  initialAutoRefreshInterval?: number,
  initialAutoFetchInterval?: number,
  initialShowAllBranches: boolean = true,
  /** The providers the app runs with; the registered ports' unless given. */
  providerSet: ProviderSet = defaultPorts().providers,
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
  const providers = createProviderRegistry(providerSet);

  // ── Navigation & selection ────────────────────────────────────────
  const [cursorIndex, setCursorIndex] = createSignal(0);
  const [scrollTargetIndex, setScrollTargetIndex] = createSignal(0);
  const [pendingScrollHash, setPendingScrollHash] = createSignal<string | null>(null);
  const [commitDetail, setCommitDetail] = createSignal<CommitDetail | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [viewingBranch, setViewingBranch] = createSignal<string | null>(null);
  const [menuTab, setMenuTab] = createSignal<MenuTab>("repository");
  const [graphDetailTarget, setGraphDetailTarget] = createSignal<{ sha: string; entry: string } | null>(null);
  const [mergePreview, setMergePreview] = createSignal<MergePreview | null>(null, {
    equals: (a, b) => a?.head === b?.head && a?.base === b?.base && a?.baseRef === b?.baseRef,
  });

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
      setCursorIndex(clampCursor(cursorIndex(), delta, itemCount));
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

  const highlightMode = createMemo(() => highlightModeOf(ancestrySet(), pathMatchSet(), searchQuery()));
  // After graphRows, maxGraphColumns and mergePreview (a memo runs at once: AGENTS.md rule 1).
  // An equal span keeps its object: new rows (a page, a refresh) redraw no line for it.
  const mergePreviewSpan = createMemo(
    () => spanOf(graphRows(), mergePreview(), maxGraphColumns(), MAX_GRAPH_COLUMNS),
    null,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  // The last search set, returned again while its matches stay the same: pages and refreshes bring new rows, and an
  // equal set must not make the dimming and navigation that read it run again. (AGENTS.md rule 3: a mutable ref.)
  let prevSearchSet: Set<string> | null = null;

  const highlightSet = createMemo((): Set<string> | null => {
    const aSet = ancestrySet();
    if (aSet) return aSet;
    const pSet = pathMatchSet();
    if (pSet) return pSet;
    const parsed = parsedSearch();
    if (!parsed) {
      prevSearchSet = null;
      return null;
    }
    const matches = searchMatches(graphRows(), parsed);
    if (prevSearchSet && sameSet(prevSearchSet, matches)) return prevSearchSet;
    prevSearchSet = matches;
    return matches;
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
    const newIndex = clampCursor(cursorIndex(), delta, graphRows().length);
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
    uncommittedDetail,
    workingTreeReads,
    viewingBranch,
    menuTab,
    mergePreviewSpan,
    graphDetailTarget,
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
    setUncommittedDetail,
    noteWorkingTreeRead: () => setWorkingTreeReads(count => count + 1),
    setViewingBranch,
    setMenuTab,
    setMergePreview,
    setGraphDetailTarget,
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
