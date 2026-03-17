import { createContext, useContext, createSignal, createMemo, type Accessor } from "solid-js";
import type { Commit, GraphRow, CommitDetail, Branch } from "../git/types";

export interface AppState {
  commits: Accessor<Commit[]>;
  graphRows: Accessor<GraphRow[]>;
  branches: Accessor<Branch[]>;
  currentBranch: Accessor<string>;
  repoName: Accessor<string>;
  repoPath: Accessor<string>;
  highlightedIndex: Accessor<number>;
  selectedIndex: Accessor<number>;
  selectedCommit: Accessor<Commit | null>;
  commitDetail: Accessor<CommitDetail | null>;
  loading: Accessor<boolean>;
  showAllBranches: Accessor<boolean>;
  showTags: Accessor<boolean>;
  focusCurrentBranch: Accessor<boolean>;
  searchQuery: Accessor<string>;
  filteredRows: Accessor<GraphRow[]>;
  maxGraphColumns: Accessor<number>;
  detailFocused: Accessor<boolean>;
  maxCount: Accessor<number>;
  dimRemoteOnly: Accessor<boolean>;
  showAuthorColumn: Accessor<boolean>;
  showDateColumn: Accessor<boolean>;
  showHashColumn: Accessor<boolean>;
}

export interface AppActions {
  setHighlightedIndex: (index: number) => void;
  moveHighlight: (delta: number) => void;
  setSelectedIndex: (index: number) => void;
  selectHighlighted: () => void;
  setCommitDetail: (detail: CommitDetail | null) => void;
  setLoading: (loading: boolean) => void;
  setShowAllBranches: (show: boolean) => void;
  setShowTags: (show: boolean) => void;
  setFocusCurrentBranch: (focus: boolean) => void;
  setSearchQuery: (query: string) => void;
  setDetailFocused: (focused: boolean) => void;
  setCommits: (commits: Commit[]) => void;
  setGraphRows: (rows: GraphRow[]) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setRepoName: (name: string) => void;
  setRepoPath: (path: string) => void;
  setMaxGraphColumns: (cols: number) => void;
  setMaxCount: (n: number) => void;
  setDimRemoteOnly: (dim: boolean) => void;
  setShowAuthorColumn: (show: boolean) => void;
  setShowDateColumn: (show: boolean) => void;
  setShowHashColumn: (show: boolean) => void;
}

const AppStateContext = createContext<{ state: AppState; actions: AppActions }>();

export function createAppState(initialMaxCount: number = 200) {
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [graphRows, setGraphRows] = createSignal<GraphRow[]>([]);
  const [branches, setBranches] = createSignal<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = createSignal("");
  const [repoName, setRepoName] = createSignal("");
  const [repoPath, setRepoPath] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [commitDetail, setCommitDetail] = createSignal<CommitDetail | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [showAllBranches, setShowAllBranches] = createSignal(true);
  const [showTags, setShowTags] = createSignal(true);
  const [focusCurrentBranch, setFocusCurrentBranch] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [maxGraphColumns, setMaxGraphColumns] = createSignal(0);
  const [maxCount, setMaxCount] = createSignal(initialMaxCount);
  const [dimRemoteOnly, setDimRemoteOnly] = createSignal(true);
  const [showAuthorColumn, setShowAuthorColumn] = createSignal(true);
  const [showDateColumn, setShowDateColumn] = createSignal(true);
  const [showHashColumn, setShowHashColumn] = createSignal(true);
  const [detailFocused, setDetailFocused] = createSignal(false);

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
    const idx = selectedIndex();
    return idx >= 0 && idx < rows.length ? rows[idx].commit : null;
  });

  const moveHighlight = (delta: number) => {
    const rows = filteredRows();
    const newIndex = Math.max(0, Math.min(rows.length - 1, highlightedIndex() + delta));
    setHighlightedIndex(newIndex);
  };

  const selectHighlighted = () => {
    setSelectedIndex(highlightedIndex());
  };

  const state: AppState = {
    commits,
    graphRows,
    branches,
    currentBranch,
    repoName,
    repoPath,
    highlightedIndex,
    selectedIndex,
    selectedCommit,
    commitDetail,
    loading,
    showAllBranches,
    showTags,
    focusCurrentBranch,
    searchQuery,
    filteredRows,
    maxGraphColumns,
    maxCount,
    dimRemoteOnly,
    detailFocused,
    showAuthorColumn,
    showDateColumn,
    showHashColumn,
  };

  const actions: AppActions = {
    setHighlightedIndex,
    moveHighlight,
    setSelectedIndex,
    selectHighlighted,
    setCommitDetail,
    setLoading,
    setShowAllBranches,
    setShowTags,
    setFocusCurrentBranch,
    setSearchQuery,
    setDetailFocused,
    setCommits,
    setGraphRows,
    setBranches,
    setCurrentBranch,
    setRepoName,
    setRepoPath,
    setMaxGraphColumns,
    setMaxCount,
    setDimRemoteOnly,
    setShowAuthorColumn,
    setShowDateColumn,
    setShowHashColumn,
  };

  return { state, actions, AppStateContext };
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export { AppStateContext };
