/**
 * Path mode, without any UI framework: which commits touch a path, asked of Git in the graph's own scope (one branch,
 * or all of them), worked out again as the graph changes, with the cursor moved to the nearest matching row. An answer
 * for an older path, scope or repository is dropped.
 */
import type { GitPort } from "./port";
import type { GraphRow } from "./types";

/** The graph's scope: a branch shown on its own, else every branch or the checked-out one. */
export function pathScope(viewingBranch: string | null, showAllBranches: boolean): { branch?: string; all: boolean } {
  return { branch: viewingBranch ?? undefined, all: viewingBranch ? false : showAllBranches };
}

/** The matching row nearest the cursor (the earlier one on a tie), or -1; the cursor itself when it matches. */
export function nearestMatchingRow(rows: readonly GraphRow[], cursor: number, matches: ReadonlySet<string>): number {
  if (cursor < rows.length && matches.has(rows[cursor].commit.hash)) return cursor;
  let forward = -1;
  for (let i = cursor + 1; i < rows.length; i++) {
    if (matches.has(rows[i].commit.hash)) {
      forward = i;
      break;
    }
  }
  let backward = -1;
  for (let i = Math.min(cursor, rows.length) - 1; i >= 0; i--) {
    if (matches.has(rows[i].commit.hash)) {
      backward = i;
      break;
    }
  }
  if (forward >= 0 && backward >= 0) return cursor - backward <= forward - cursor ? backward : forward;
  return forward >= 0 ? forward : backward;
}

export interface PathFilterPorts {
  git: GitPort;
  repoPath: () => string;
  state: {
    pathFilter: () => string | null;
    viewingBranch: () => string | null;
    showAllBranches: () => boolean;
    graphRows: () => GraphRow[];
    cursorIndex: () => number;
  };
  actions: {
    setPathFilter: (path: string | null) => void;
    setPathMatchSet: (matches: Set<string> | null) => void;
    setCursorIndex: (index: number) => void;
    setScrollTargetIndex: (index: number) => void;
  };
}

export function createPathFilter(ports: PathFilterPorts) {
  const { git, repoPath, state, actions } = ports;
  let version = 0;
  const scope = () => pathScope(state.viewingBranch(), state.showAllBranches());

  /** Asks Git; the answer, or null when a newer question, path, scope or repository came first. */
  async function ask(pathspec: string): Promise<Set<string> | null> {
    const asked = ++version;
    const path = repoPath();
    const askedScope = scope();
    const hashes = await git.getPathMatchingHashes(path, pathspec, askedScope);
    const now = scope();
    const current =
      asked === version &&
      repoPath() === path &&
      state.pathFilter() === pathspec &&
      now.branch === askedScope.branch &&
      now.all === askedScope.all;
    return current ? hashes : null;
  }

  /** The graph changed (pages, a refresh, another scope): the matches are worked out again, the cursor kept on one. */
  async function refresh(): Promise<void> {
    const path = state.pathFilter();
    if (!path) {
      version++;
      return;
    }
    const hashes = await ask(path);
    if (!hashes) return;
    actions.setPathMatchSet(hashes);
    if (hashes.size === 0) return;
    const cursor = state.cursorIndex();
    const target = nearestMatchingRow(state.graphRows(), cursor, hashes);
    if (target >= 0 && target !== cursor) {
      actions.setCursorIndex(target);
      actions.setScrollTargetIndex(target);
    }
  }

  return {
    /**
     * Applies a path from the command bar; empty clears path mode. `leaveOtherModes` runs once the path is set and
     * before Git is asked: path mode replaces search and ancestry.
     */
    async apply(pathValue: string, leaveOtherModes?: () => void): Promise<void> {
      const path = pathValue || null;
      actions.setPathFilter(path);
      if (!path) {
        version++;
        actions.setPathMatchSet(null);
        return;
      }
      leaveOtherModes?.();
      await refresh();
    },
    refresh,
  };
}
