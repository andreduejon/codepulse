/**
 * The app's state as a port: what it holds (the repository, the graph and its cursor, highlights, the details, the
 * providers' status and badges) and how it changes. The terminal app keeps it in Solid signals (context/state.ts);
 * another front end can keep it in any store with the same shape. The rules that don't depend on where the state is
 * kept (which highlight wins, which commits a search matches, how far the cursor may move) are functions here.
 */

import type { Branch, Commit, CommitDetail, GraphRow, TagInfo, UncommittedDetail } from "./git/types";
import type { GraphBadge, ProviderRegistry, ProviderView } from "./provider-model";
import type { ProviderStatus } from "./provider-status";
import { matchCommit, type ParsedSearch } from "./search";

/** A value the app reads, reactive where the app is: a Solid signal in the terminal app. */
export type Accessor<T> = () => T;

/** A detail tab: Git's own, or a provider's (its id, or a tab it adds). */
export type DetailTab = "files" | "info" | "stashes" | "staged" | "unstaged" | "untracked" | (string & {});

export type HighlightMode = "ancestry" | "path" | "search" | null;

export interface RepoState {
  commits: Accessor<Commit[]>;
  graphRows: Accessor<GraphRow[]>;
  branches: Accessor<Branch[]>;
  currentBranch: Accessor<string>;
  repoPath: Accessor<string>;
  remoteUrl: Accessor<string>;
  tagDetails: Accessor<Map<string, TagInfo>>;
  stashByParent: Accessor<Map<string, Commit[]>>;
}

export interface NavState {
  cursorIndex: Accessor<number>;
  selectedCommit: Accessor<Commit | null>;
  selectedRow: Accessor<GraphRow | null>;
  commitDetail: Accessor<CommitDetail | null>;
  searchQuery: Accessor<string>;
  scrollTargetIndex: Accessor<number>;
  pendingScrollHash: Accessor<string | null>;
  viewingBranch: Accessor<string | null>;
}

export interface FilterState {
  pathFilter: Accessor<string | null>;
  pathMatchSet: Accessor<Set<string> | null>;
  ancestrySet: Accessor<Set<string> | null>;
  highlightSet: Accessor<Set<string> | null>;
  highlightMode: Accessor<HighlightMode>;
}

/** The views with details of their own: the graph's (Git and the provider views) and the Dashboard's. */
export type DetailOwner = "graph" | "dashboard";

/** One view's details: what the shown view's `state.detail…` read, for a view named. */
export interface DetailSlotState {
  detailFocused: Accessor<boolean>;
  detailCursorIndex: Accessor<number>;
  detailCursorAction: Accessor<string | null>;
  detailActiveTab: Accessor<DetailTab>;
}

export interface DetailSlotActions {
  setDetailFocused: (focused: boolean) => void;
  setDetailCursorIndex: (index: number) => void;
  moveDetailCursor: (delta: number, itemCount: number) => void;
  setDetailCursorAction: (action: string | null) => void;
  setDetailActiveTab: (tab: DetailTab) => void;
}

export interface DetailState {
  /** One view's details by name; the others here are the shown view's. */
  detailFor: (owner: DetailOwner) => DetailSlotState;
  detailFocused: Accessor<boolean>;
  detailCursorIndex: Accessor<number>;
  detailLoading: Accessor<boolean>;
  detailCursorAction: Accessor<string | null>;
  detailActiveTab: Accessor<DetailTab>;
  uncommittedDetail: Accessor<UncommittedDetail | null>;
  /** Counts the refreshes that read a dirty working tree: the selected uncommitted row reloads its files on each. */
  workingTreeReads: Accessor<number>;
}

export interface SettingsState {
  error: Accessor<string | null>;
  loading: Accessor<boolean>;
  showAllBranches: Accessor<boolean>;
  maxGraphColumns: Accessor<number>;
  maxCount: Accessor<number>;
  autoRefreshInterval: Accessor<number>;
  autoFetchInterval: Accessor<number>;
  lastFetchTime: Accessor<Date | null>;
  fetching: Accessor<boolean>;
  /** `fetching` is loading more local history (scrolling), not a remote fetch. */
  fetchingHistory: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  historyError: Accessor<boolean>;
}

export interface ProviderAppState {
  activeProviderView: Accessor<ProviderView>;
  /** The shown view's badges. */
  graphBadges: Accessor<Map<string, GraphBadge>>;
  /** One provider's badges, whichever view is shown (the dashboard shows none of its own). */
  graphBadgesFor: (view: ProviderView) => ReadonlyMap<string, GraphBadge>;
  providerStatus: Accessor<ProviderStatus>;
  providerStatusFor: (view: ProviderView) => ProviderStatus;
  providerLastSuccessfulRefresh: Accessor<Map<ProviderView, Date>>;
  providers: ProviderRegistry;
}

export type AppState = RepoState & NavState & FilterState & DetailState & SettingsState & ProviderAppState;

export interface RepoActions {
  setCommits: (commits: Commit[]) => void;
  setGraphRows: (rows: GraphRow[]) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setRepoPath: (path: string) => void;
  setRemoteUrl: (url: string) => void;
  setTagDetails: (tags: Map<string, TagInfo>) => void;
  setStashByParent: (map: Map<string, Commit[]>) => void;
}

export interface NavActions {
  setCursorIndex: (index: number) => void;
  moveCursor: (delta: number) => void;
  setScrollTargetIndex: (index: number) => void;
  setPendingScrollHash: (hash: string | null) => void;
  setCommitDetail: (detail: CommitDetail | null) => void;
  setSearchQuery: (query: string) => void;
  setViewingBranch: (branch: string | null) => void;
}

export interface FilterActions {
  setPathFilter: (path: string | null) => void;
  setPathMatchSet: (set: Set<string> | null) => void;
  setAncestrySet: (set: Set<string> | null) => void;
}

export interface DetailActions {
  /** One view's details by name, also while another view shows; the others here change the shown view's. */
  detailFor: (owner: DetailOwner) => DetailSlotActions;
  setDetailFocused: (focused: boolean) => void;
  setDetailCursorIndex: (index: number) => void;
  moveDetailCursor: (delta: number, itemCount: number) => void;
  setDetailLoading: (loading: boolean) => void;
  setDetailCursorAction: (action: string | null) => void;
  setDetailActiveTab: (tab: DetailTab) => void;
  setUncommittedDetail: (detail: UncommittedDetail | null) => void;
  noteWorkingTreeRead: () => void;
}

export interface SettingsActions {
  setLoading: (loading: boolean) => void;
  setShowAllBranches: (show: boolean) => void;
  setError: (err: string | null) => void;
  setMaxGraphColumns: (cols: number) => void;
  setMaxCount: (n: number) => void;
  setAutoRefreshInterval: (ms: number) => void;
  setAutoFetchInterval: (ms: number) => void;
  setLastFetchTime: (time: Date | null) => void;
  /** `history` marks loading more local history rather than a remote fetch; both block each other. */
  setFetching: (fetching: boolean, history?: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setHistoryError: (failed: boolean) => void;
}

export interface ProviderActions {
  setActiveProviderView: (view: ProviderView) => void;
  setGraphBadges: (view: ProviderView, map: Map<string, GraphBadge>) => void;
  setProviderStatus: (view: ProviderView, status: ProviderStatus) => void;
  setProviderLastSuccessfulRefresh: (view: ProviderView, time: Date) => void;
  clearProviderState: () => void;
  cycleProviderView: () => void;
}

export type AppActions = RepoActions & NavActions & FilterActions & DetailActions & SettingsActions & ProviderActions;

// ── Rules ─────────────────────────────────────────────────────────────────────

/** One highlight at a time: ancestry, then path, then search. */
export function highlightModeOf(ancestry: unknown, pathMatches: unknown, searchQuery: string): HighlightMode {
  if (ancestry) return "ancestry";
  if (pathMatches) return "path";
  if (searchQuery) return "search";
  return null;
}

/** The rows' commits a search matches. */
export function searchMatches(rows: readonly GraphRow[], search: ParsedSearch): Set<string> {
  const matches = new Set<string>();
  for (const row of rows) if (matchCommit(row.commit, search)) matches.add(row.commit.hash);
  return matches;
}

/** Whether two sets hold the same values. */
export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** A cursor moved by `delta` within `count` items: it stops at the first and the last. */
export function clampCursor(cursor: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count - 1, cursor + delta));
}
