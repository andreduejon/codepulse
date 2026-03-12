import { createContext, useContext, createSignal, type Accessor } from "solid-js";
import type { Commit, GraphRow, CommitDetail, Branch } from "../git/types";

export interface AppState {
  commits: Accessor<Commit[]>;
  graphRows: Accessor<GraphRow[]>;
  branches: Accessor<Branch[]>;
  currentBranch: Accessor<string>;
  repoName: Accessor<string>;
  repoPath: Accessor<string>;
  selectedIndex: Accessor<number>;
  selectedCommit: Accessor<Commit | null>;
  commitDetail: Accessor<CommitDetail | null>;
  loading: Accessor<boolean>;
  showAllBranches: Accessor<boolean>;
  searchQuery: Accessor<string>;
  filteredRows: Accessor<GraphRow[]>;
}

export interface AppActions {
  setSelectedIndex: (index: number) => void;
  moveSelection: (delta: number) => void;
  setCommitDetail: (detail: CommitDetail | null) => void;
  setLoading: (loading: boolean) => void;
  setShowAllBranches: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setCommits: (commits: Commit[]) => void;
  setGraphRows: (rows: GraphRow[]) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: string) => void;
  setRepoName: (name: string) => void;
  setRepoPath: (path: string) => void;
}

const AppStateContext = createContext<{ state: AppState; actions: AppActions }>();

export function createAppState() {
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [graphRows, setGraphRows] = createSignal<GraphRow[]>([]);
  const [branches, setBranches] = createSignal<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = createSignal("");
  const [repoName, setRepoName] = createSignal("");
  const [repoPath, setRepoPath] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [commitDetail, setCommitDetail] = createSignal<CommitDetail | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [showAllBranches, setShowAllBranches] = createSignal(true);
  const [searchQuery, setSearchQuery] = createSignal("");

  const selectedCommit = () => {
    const rows = filteredRows();
    const idx = selectedIndex();
    return idx >= 0 && idx < rows.length ? rows[idx].commit : null;
  };

  const filteredRows = () => {
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
  };

  const moveSelection = (delta: number) => {
    const rows = filteredRows();
    const newIndex = Math.max(0, Math.min(rows.length - 1, selectedIndex() + delta));
    setSelectedIndex(newIndex);
  };

  const state: AppState = {
    commits,
    graphRows,
    branches,
    currentBranch,
    repoName,
    repoPath,
    selectedIndex,
    selectedCommit,
    commitDetail,
    loading,
    showAllBranches,
    searchQuery,
    filteredRows,
  };

  const actions: AppActions = {
    setSelectedIndex,
    moveSelection,
    setCommitDetail,
    setLoading,
    setShowAllBranches,
    setSearchQuery,
    setCommits,
    setGraphRows,
    setBranches,
    setCurrentBranch,
    setRepoName,
    setRepoPath,
  };

  return { state, actions, AppStateContext };
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export { AppStateContext };
