/**
 * Pure helper for merging paginated commit results.
 *
 * Extracted from App.loadMoreData() so it can be unit-tested without
 * SolidJS, reactive state, or git subprocess dependencies.
 */
import { UNCOMMITTED_HASH } from "../constants";
import type { Commit } from "./types";

/**
 * Merge a new page of commits onto an existing commit list.
 *
 * 1. Filters out the synthetic uncommitted node from `existingCommits`.
 * 2. Appends `newCommits`.
 * 3. Re-injects stash badges onto parent commits.
 * 4. Re-prepends the uncommitted node if it was present.
 *
 * Returns a new array — does not mutate the inputs (except stash badge
 * injection mutates the `refs` array on individual commits, matching the
 * original behaviour in App).
 */
export function mergeCommitPages(
  existingCommits: Commit[],
  newCommits: Commit[],
  stashByParent: Map<string, unknown[]>,
): Commit[] {
  const hadUncommitted = existingCommits[0]?.hash === UNCOMMITTED_HASH;
  const uncommittedNode = hadUncommitted ? existingCommits[0] : null;

  // Strip uncommitted node for the real-commit merge
  const realExisting = existingCommits.filter(c => c.hash !== UNCOMMITTED_HASH);
  const merged = [...realExisting, ...newCommits];

  // Re-inject stash badges onto parent commits
  for (const [parentHash, stashGroup] of stashByParent) {
    const parentCommit = merged.find(c => c.hash === parentHash);
    if (parentCommit && !parentCommit.refs.some(r => r.type === "stash")) {
      parentCommit.refs.push({
        name: `stash (${stashGroup.length})`,
        type: "stash" as const,
        isCurrent: false,
      });
    }
  }

  // Re-prepend uncommitted node if it was present
  if (uncommittedNode) {
    merged.unshift(uncommittedNode);
  }

  return merged;
}
