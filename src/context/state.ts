import { createContext, useContext, createSignal, createMemo, type Accessor } from "solid-js";
import type { Commit, GraphRow, CommitDetail, Branch, TagInfo } from "../git/types";
import { DEFAULT_MAX_COUNT } from "../constants";

export const DEFAULT_AUTO_REFRESH_INTERVAL = 30000;

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

  // ── Navigation & selection ──────────────────────────────────────────
  cursorIndex: Accessor<number>;
  selectedCommit: Accessor<Commit | null>;
  selectedRow: Accessor<GraphRow | null>;
  commitDetail: Accessor<CommitDetail | null>;
  searchQuery: Accessor<string>;
  filteredRows: Accessor<GraphRow[]>;
  scrollTargetIndex: Accessor<number>;
  /** Branch being viewed (filtered perspective). null = show all / default. */
  viewingBranch: Accessor<string | null>;

  // ── Detail panel ────────────────────────────────────────────────────
  detailFocused: Accessor<boolean>;
  detailCursorIndex: Accessor<number>;
  detailOriginHash: Accessor<string | null>;
  /** True while commit detail (message, files, diff) is being loaded */
  detailLoading: Accessor<boolean>;
  /** Contextual enter-key action label for the detail cursor item (null = no action) */
  detailCursorAction: Accessor<string | null>;

  // ── UI state & settings ─────────────────────────────────────────────
  error: Accessor<string | null>;
  loading: Accessor<boolean>;
  showAllBranches: Accessor<boolean>;
  maxGraphColumns: Accessor<number>;
  maxCount: Accessor<number>;
  autoRefreshInterval: Accessor<number>;
  lastFetchTime: Accessor<Date | null>;
  fetching: Accessor<boolean>;
}

export interface AppActions {
  setCursorIndex: (index: number) => void;
  moveCursor: (delta: number) => void;
  setScrollTargetIndex: (index: number) => void;
  setCommitDetail: (detail: CommitDetail | null) => void;
  setLoading: (loading: boolean) => void;
  setShowAllBranches: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setDetailFocused: (focused: boolean) => void;
  setDetailCursorIndex: (index: number) => void;
  setDetailOriginHash: (hash: string | null) => void;
  moveDetailCursor: (delta: number, itemCount: number) => void;
  setCommits: (commits: Commit[]) => void;
  setGraphRows: (rows: GraphRow[]) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setRepoPath: (path: string) => void;
  setRemoteUrl: (url: string) => void;
  setTagDetails: (tags: Map<string, TagInfo>) => void;
  setError: (err: string | null) => void;
  setMaxGraphColumns: (cols: number) => void;
  setMaxCount: (n: number) => void;
  setAutoRefreshInterval: (ms: number) => void;
  setLastFetchTime: (time: Date | null) => void;
  setFetching: (fetching: boolean) => void;
  setDetailLoading: (loading: boolean) => void;
  setDetailCursorAction: (action: string | null) => void;
  setViewingBranch: (branch: string | null) => void;
}

const AppStateContext = createContext<{ state: AppState; actions: AppActions }>();

export function createAppState(initialMaxCount: number = DEFAULT_MAX_COUNT) {
  // ── Repository data ───────────────────────────────────────────────
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [graphRows, setGraphRows] = createSignal<GraphRow[]>([]);
  const [branches, setBranches] = createSignal<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = createSignal("");
  const [repoPath, setRepoPath] = createSignal("");
  const [remoteUrl, setRemoteUrl] = createSignal("");
  const [tagDetails, setTagDetails] = createSignal<Map<string, TagInfo>>(new Map());

  // ── Navigation & selection ────────────────────────────────────────
  const [cursorIndex, setCursorIndex] = createSignal(0);
  const [scrollTargetIndex, setScrollTargetIndex] = createSignal(0);
  const [commitDetail, setCommitDetail] = createSignal<CommitDetail | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [viewingBranch, setViewingBranch] = createSignal<string | null>(null);

  // ── Detail panel ──────────────────────────────────────────────────
  const [detailFocused, setDetailFocused] = createSignal(false);
  const [detailCursorIndex, setDetailCursorIndex] = createSignal(-1);
  const [detailOriginHash, setDetailOriginHash] = createSignal<string | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailCursorAction, setDetailCursorAction] = createSignal<string | null>(null);

  // ── UI state & settings ───────────────────────────────────────────
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [showAllBranches, setShowAllBranches] = createSignal(true);
  const [maxGraphColumns, setMaxGraphColumns] = createSignal(0);
  const [maxCount, setMaxCount] = createSignal(initialMaxCount);
  const [autoRefreshInterval, setAutoRefreshInterval] = createSignal(DEFAULT_AUTO_REFRESH_INTERVAL);
  const [lastFetchTime, setLastFetchTime] = createSignal<Date | null>(null);
  const [fetching, setFetching] = createSignal(false);

  const filteredRows = createMemo(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return graphRows();
    return graphRows().filter((row) => {
      const c = row.commit;
      return (
        c.subject.toLowerCase().includes(query) ||
        c.author.toLowerCase().includes(query) ||
        c.shortHash.toLowerCase().includes(query) ||
        c.refs.some((r) => r.name.toLowerCase().includes(query))
      );
    });
  });

  const selectedCommit = createMemo(() => {
    const rows = filteredRows();
    const idx = cursorIndex();
    return idx >= 0 && idx < rows.length ? rows[idx].commit : null;
  });

  const selectedRow = createMemo(() => {
    const rows = filteredRows();
    const idx = cursorIndex();
    return idx >= 0 && idx < rows.length ? rows[idx] : null;
  });

  const moveCursor = (delta: number) => {
    const rows = filteredRows();
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
    error,
    cursorIndex,
    selectedCommit,
    selectedRow,
    commitDetail,
    loading,
    showAllBranches,
    searchQuery,
    filteredRows,
    maxGraphColumns,
    maxCount,
    autoRefreshInterval,
    detailFocused,
    detailCursorIndex,
    detailOriginHash,
    scrollTargetIndex,
    lastFetchTime,
    fetching,
    detailLoading,
    detailCursorAction,
    viewingBranch,
  };

  const actions: AppActions = {
    setCursorIndex,
    moveCursor,
    setScrollTargetIndex,
    setCommitDetail,
    setLoading,
    setShowAllBranches,
    setSearchQuery,
    setDetailFocused,
    setDetailCursorIndex,
    setDetailOriginHash,
    moveDetailCursor,
    setCommits,
    setGraphRows,
    setBranches,
    setCurrentBranch,
    setRepoPath,
    setRemoteUrl,
    setTagDetails,
    setError,
    setMaxGraphColumns,
    setMaxCount,
    setAutoRefreshInterval,
    setLastFetchTime,
    setFetching,
    setDetailLoading,
    setDetailCursorAction,
    setViewingBranch,
  };

  return { state, actions, AppStateContext };
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export { AppStateContext };
