/**
 * Pure helper functions extracted from use-data-loader.ts.
 *
 * These functions contain the core data-loading business logic and are
 * framework-agnostic, making them unit-testable without SolidJS, opentui,
 * or live git subprocess dependencies.
 */
import { isUncommittedHash, UNCOMMITTED_HASH } from "../constants";
import type { Commit, GraphRow } from "../git/types";

/**
 * Compute the effective max commit count for a silent (auto-refresh or
 * settings-preserve) reload.
 *
 * For normal (non-silent) loads the configured pageSize is used as-is.
 * For silent/preserveLoaded reloads we fetch at least as many commits as are
 * already loaded, so the user doesn't lose history they've paged through.
 *
 * @param pageSize        The configured page size (maxCount from settings).
 * @param currentCommits  The currently loaded commit list (may include uncommitted node).
 * @param silent          Whether this is a background/silent reload.
 * @param preserveLoaded  Whether to preserve the current scroll depth.
 */
export function computeSilentMaxCount(
  pageSize: number,
  currentCommits: Commit[],
  silent: boolean,
  preserveLoaded: boolean,
): number {
  if (!silent && !preserveLoaded) return pageSize;
  const realCount = currentCommits.filter(c => !isUncommittedHash(c.hash)).length;
  return Math.max(pageSize, realCount);
}

/**
 * Determine whether a fresh load result is identical to what's already loaded,
 * so that a silent auto-refresh can skip unnecessary reactive updates.
 *
 * Compares both hash and refs (serialized) for every commit.
 *
 * @param oldCommits  Currently loaded commits (including possible uncommitted node).
 * @param newCommits  Freshly fetched commits (including possible uncommitted node).
 */
export function isStaleResult(oldCommits: Commit[], newCommits: Commit[]): boolean {
  if (oldCommits.length !== newCommits.length) return false;
  return oldCommits.every(
    (c, i) => c.hash === newCommits[i].hash && JSON.stringify(c.refs) === JSON.stringify(newCommits[i].refs),
  );
}

/**
 * Inject a synthetic "uncommitted changes" node at the front of the commit list
 * when the working tree is dirty.
 *
 * The node's parent is the HEAD commit, so buildGraph draws it as a side branch
 * off the tip.
 *
 * @param commits   The commit list to prepend to (mutated in-place).
 * @param headHash  Hash of the HEAD commit (first commit in the list before injection).
 */
export function injectUncommittedNode(commits: Commit[], headHash: string): void {
  const uncommitted: Commit = {
    hash: UNCOMMITTED_HASH,
    shortHash: "\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7",
    parents: [headHash],
    subject: "Uncommitted changes",
    body: "",
    author: "",
    authorEmail: "",
    authorDate: "",
    committer: "",
    committerEmail: "",
    commitDate: "",
    refs: [{ name: "uncommitted", type: "uncommitted" as const, isCurrent: false }],
  };
  commits.unshift(uncommitted);
}

/**
 * Build a stash-by-parent map from a list of stash commits, filtering to only
 * stashes whose parent hash exists in the loaded commit set.
 *
 * Also injects synthetic "stash (N)" ref badges onto the parent commits so the
 * graph can render them.
 *
 * @param stashes   Stash commit objects (from getStashList).
 * @param commits   The real commit list (excluding any uncommitted node).
 * @returns         Map of parent-hash → stash Commit[].
 */
export function buildStashByParent(stashes: Commit[], commits: Commit[]): Map<string, Commit[]> {
  const stashByParent = new Map<string, Commit[]>();
  if (stashes.length === 0) return stashByParent;

  const commitHashSet = new Set(commits.map(c => c.hash));
  for (const s of stashes) {
    const parentHash = s.parents[0];
    if (!parentHash || !commitHashSet.has(parentHash)) continue;
    const group = stashByParent.get(parentHash);
    if (group) group.push(s);
    else stashByParent.set(parentHash, [s]);
  }

  // Inject "stash (N)" ref badges onto parent commits
  for (const [parentHash, stashGroup] of stashByParent) {
    const parentCommit = commits.find(c => c.hash === parentHash);
    if (parentCommit) {
      parentCommit.refs.push({
        name: `stash (${stashGroup.length})`,
        type: "stash" as const,
        isCurrent: false,
      });
    }
  }

  return stashByParent;
}

/**
 * Compute the target cursor index after loading new data.
 *
 * Priority:
 *   1. stickyHash — restore the user's previous position by hash.
 *   2. Current-branch tip — land on the first current-branch row.
 *   3. Index 0 — fallback.
 *
 * @param rows        Newly built graph rows.
 * @param stickyHash  Hash to restore (undefined = use current-branch tip).
 */
export function computeTargetIndex(rows: GraphRow[], stickyHash?: string): number {
  if (stickyHash) {
    const idx = rows.findIndex(r => r.commit.hash === stickyHash);
    if (idx >= 0) return idx;
    // stickyHash not found (e.g. rebased away) — fall through to current branch
  }
  const cbIdx = rows.findIndex(r => r.isOnCurrentBranch);
  return cbIdx >= 0 ? cbIdx : 0;
}
