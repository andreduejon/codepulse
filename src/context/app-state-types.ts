import type { Accessor } from "solid-js";
import type { Branch, Commit, CommitDetail, GraphRow, TagInfo, UncommittedDetail } from "../git/types";
import type { KeyboardScope } from "../keyboard/scope";
import type { GraphBadge, ProviderRegistry, ProviderView } from "../providers/provider";

export type DetailTab =
  | "files"
  | "info"
  | "stashes"
  | "staged"
  | "unstaged"
  | "untracked"
  | "github-actions"
  | "jenkins"
  | "openshift";

export type HighlightMode = "ancestry" | "path" | "search" | null;

export type ProviderStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "warning"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

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

export interface DetailState {
  detailFocused: Accessor<boolean>;
  detailCursorIndex: Accessor<number>;
  detailLoading: Accessor<boolean>;
  detailCursorAction: Accessor<string | null>;
  detailActiveTab: Accessor<DetailTab>;
  uncommittedDetail: Accessor<UncommittedDetail | null>;
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
  hasMore: Accessor<boolean>;
  keyboardScopeOverride: Accessor<KeyboardScope | null>;
}

export interface ProviderAppState {
  activeProviderView: Accessor<ProviderView>;
  graphBadges: Accessor<Map<string, GraphBadge>>;
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
  setDetailFocused: (focused: boolean) => void;
  setDetailCursorIndex: (index: number) => void;
  moveDetailCursor: (delta: number, itemCount: number) => void;
  setDetailLoading: (loading: boolean) => void;
  setDetailCursorAction: (action: string | null) => void;
  setDetailActiveTab: (tab: DetailTab) => void;
  setUncommittedDetail: (detail: UncommittedDetail | null) => void;
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
  setFetching: (fetching: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setKeyboardScopeOverride: (scope: KeyboardScope | null) => void;
}

export interface ProviderActions {
  setActiveProviderView: (view: ProviderView) => void;
  setGraphBadges: (view: ProviderView, map: Map<string, GraphBadge>) => void;
  setProviderStatus: (view: ProviderView, status: ProviderStatus) => void;
  setProviderLastSuccessfulRefresh: (view: ProviderView, time: Date) => void;
  cycleProviderView: () => void;
}

export type AppActions = RepoActions & NavActions & FilterActions & DetailActions & SettingsActions & ProviderActions;
