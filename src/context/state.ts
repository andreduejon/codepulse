import { type Accessor, createContext, createMemo, createSignal, useContext } from "solid-js";
import { DEFAULT_MAX_COUNT } from "../constants";
import type { Branch, Commit, CommitDetail, GraphRow, TagInfo, UncommittedDetail } from "../git/types";
import type { GraphBadge, ProviderView } from "../providers/provider";
import { nextProviderView } from "../providers/provider";
import { matchCommit, parseSearchQuery } from "../search";

export const DEFAULT_AUTO_REFRESH_INTERVAL = 30000;

/** Valid tab identifiers for the detail panel. */
export type DetailTab = "files" | "detail" | "stashes" | "staged" | "unstaged" | "untracked" | "ci";

/**
 * Which highlighting mode is currently active.
 * - "ancestry": per-column graph lane brightness (computeBrightColumns)
 * - "path" | "search": per-row dimming, only commit node stays bright on matching rows
 * - null: no highlighting active
 */
export type HighlightMode = "ancestry" | "path" | "search" | null;

export interface AppState {
  // ── Repository data ─────────────────────────────────────────────────
  commits: Accessor<Commit[]>;
  graphRows: Accessor<GraphRow[]>;
  branches: Accessor<Branch[]>;
  currentBranch: Accessor<string>;
  repoPath: Accessor<string>;
  remoteUrl: Accessor<string>;
  /** Tag details keyed by tag name — annotated tags include tagger/message. */
  tagDetails: Accessor<Map<string, TagInfo>>;
  /** Stash commits grouped by parent hash — used for detail panel stash section. */
  stashByParent: Accessor<Map<string, Commit[]>>;

  // ── Navigation & selection ──────────────────────────────────────────
  cursorIndex: Accessor<number>;
  selectedCommit: Accessor<Commit | null>;
  selectedRow: Accessor<GraphRow | null>;
  commitDetail: Accessor<CommitDetail | null>;
  searchQuery: Accessor<string>;
  scrollTargetIndex: Accessor<number>;
  /** Commit hash to scroll into view after layout settles (e.g. after filter clear). */
  pendingScrollHash: Accessor<string | null>;
  /** Branch being viewed (filtered perspective). null = show all / default. */
  viewingBranch: Accessor<string | null>;

  // ── Path filtering ──────────────────────────────────────────────────
  /** Active pathspec filter string for display. null = no filter. */
  pathFilter: Accessor<string | null>;
  /** Set of commit hashes touching the active pathspec. null = inactive. */
  pathMatchSet: Accessor<Set<string> | null>;

  // ── Ancestry highlighting ────────────────────────────────────────────
  /**
   * Set of commit hashes that are ancestors of the selected anchor commit
   * (including the anchor itself). null = ancestry highlighting inactive.
   */
  ancestrySet: Accessor<Set<string> | null>;

  // ── Unified highlighting ────────────────────────────────────────────
  /**
   * Derived set of commit hashes that should be highlighted (bright).
   * Picks from whichever mode is active: ancestry > path > search.
   * null = no highlighting active (all rows normal).
   */
  highlightSet: Accessor<Set<string> | null>;
  /** Which highlighting mode is currently active. */
  highlightMode: Accessor<HighlightMode>;

  // ── Detail panel ────────────────────────────────────────────────────
  detailFocused: Accessor<boolean>;
  detailCursorIndex: Accessor<number>;
  /** True while commit detail (message, files, diff) is being loaded */
  detailLoading: Accessor<boolean>;
  /** Contextual enter-key action label for the detail cursor item (null = no action) */
  detailCursorAction: Accessor<string | null>;
  /** Active tab in the detail panel (e.g. "detail", "files", "stashes" or "staged", "unstaged", "untracked") */
  detailActiveTab: Accessor<DetailTab>;
  /** Separate file lists for the uncommitted-changes node (null when a normal commit is selected) */
  uncommittedDetail: Accessor<UncommittedDetail | null>;

  // ── UI state & settings ─────────────────────────────────────────────
  error: Accessor<string | null>;
  loading: Accessor<boolean>;
  showAllBranches: Accessor<boolean>;
  maxGraphColumns: Accessor<number>;
  maxCount: Accessor<number>;
  autoRefreshInterval: Accessor<number>;
  lastFetchTime: Accessor<Date | null>;
  fetching: Accessor<boolean>;
  /** True if there are likely more commits to load beyond the current page. */
  hasMore: Accessor<boolean>;

  // ── Provider / CI ────────────────────────────────────────────────────
  /** Which provider view is active — "git" (default) or a CI provider. */
  activeProviderView: Accessor<ProviderView>;
  /**
   * SHA → GraphBadge map populated by the active CI provider.
   * Empty map when no CI provider is active or no data has been fetched yet.
   */
  graphBadges: Accessor<Map<string, GraphBadge>>;
  /**
   * Status message from the active CI provider.
   * null = idle/ok, "loading" = fetching in progress,
   * any other string = last error message (shown in footer).
   */
  ciStatus: Accessor<string | null>;
}

export interface AppActions {
  setCursorIndex: (index: number) => void;
  moveCursor: (delta: number) => void;
  setScrollTargetIndex: (index: number) => void;
  setPendingScrollHash: (hash: string | null) => void;
  setCommitDetail: (detail: CommitDetail | null) => void;
  setLoading: (loading: boolean) => void;
  setShowAllBranches: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setDetailFocused: (focused: boolean) => void;
  setDetailCursorIndex: (index: number) => void;
  moveDetailCursor: (delta: number, itemCount: number) => void;
  setCommits: (commits: Commit[]) => void;
  setGraphRows: (rows: GraphRow[]) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setRepoPath: (path: string) => void;
  setRemoteUrl: (url: string) => void;
  setTagDetails: (tags: Map<string, TagInfo>) => void;
  setStashByParent: (map: Map<string, Commit[]>) => void;
  setError: (err: string | null) => void;
  setMaxGraphColumns: (cols: number) => void;
  setMaxCount: (n: number) => void;
  setAutoRefreshInterval: (ms: number) => void;
  setLastFetchTime: (time: Date | null) => void;
  setFetching: (fetching: boolean) => void;
  setDetailLoading: (loading: boolean) => void;
  setDetailCursorAction: (action: string | null) => void;
  setDetailActiveTab: (tab: DetailTab) => void;
  setUncommittedDetail: (detail: UncommittedDetail | null) => void;
  setViewingBranch: (branch: string | null) => void;
  setPathFilter: (path: string | null) => void;
  setPathMatchSet: (set: Set<string> | null) => void;
  setHasMore: (hasMore: boolean) => void;
  setAncestrySet: (set: Set<string> | null) => void;
  // ── Provider / CI ────────────────────────────────────────────────────
  setActiveProviderView: (view: ProviderView) => void;
  setGraphBadges: (map: Map<string, GraphBadge>) => void;
  /** Set the CI provider status message (null = ok, "loading", or error string). */
  setCiStatus: (status: string | null) => void;
  /** Advance to the next available provider view (Tab key cycling). */
  cycleProviderView: () => void;
}

const AppStateContext = createContext<{ state: AppState; actions: AppActions }>();

export function createAppState(initialMaxCount: number = DEFAULT_MAX_COUNT, initialAutoRefreshInterval?: number) {
  // ── Repository data ───────────────────────────────────────────────
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [graphRows, setGraphRows] = createSignal<GraphRow[]>([]);
  const [branches, setBranches] = createSignal<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = createSignal("");
  const [repoPath, setRepoPath] = createSignal("");
  const [remoteUrl, setRemoteUrl] = createSignal("");
  const [tagDetails, setTagDetails] = createSignal<Map<string, TagInfo>>(new Map());
  const [stashByParent, setStashByParent] = createSignal<Map<string, Commit[]>>(new Map());

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
  const [showAllBranches, setShowAllBranches] = createSignal(true);
  const [maxGraphColumns, setMaxGraphColumns] = createSignal(0);
  const [maxCount, setMaxCount] = createSignal(initialMaxCount);
  const [autoRefreshInterval, setAutoRefreshInterval] = createSignal(
    initialAutoRefreshInterval ?? DEFAULT_AUTO_REFRESH_INTERVAL,
  );
  const [lastFetchTime, setLastFetchTime] = createSignal<Date | null>(null);
  const [fetching, setFetching] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(true);

  // ── Provider / CI ─────────────────────────────────────────────────
  const [activeProviderView, setActiveProviderView] = createSignal<ProviderView>("git");
  const [graphBadges, setGraphBadges] = createSignal<Map<string, GraphBadge>>(new Map());
  const [ciStatus, setCiStatus] = createSignal<string | null>(null);

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
    ciStatus,
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
    setGraphBadges,
    setCiStatus,
    cycleProviderView: () => setActiveProviderView(nextProviderView(activeProviderView())),
  };

  return { state, actions };
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export { AppStateContext };
