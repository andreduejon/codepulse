/**
 * useAncestry — manages ancestry-highlight state for the commit graph.
 *
 * Computes and maintains a "first-parent chain" (backbone) through a selected
 * commit — backward through ancestors and forward through descendants — so the
 * graph renderer can dim off-chain commits.
 *
 * The hook owns `ancestryAnchorHash` as a mutable ref (not a signal) so that
 * it persists correctly across multiple effect firings in the same reactive
 * flush without being consumed (see AGENTS.md rule 3).
 *
 * @param state   App state (reactive reads only — graphRows, ancestrySet, etc.)
 * @param actions App actions (setAncestrySet, setSearchQuery, setPathFilter, etc.)
 */
import { createEffect } from "solid-js";
import type { createAppState } from "../context/state";

type AppState = ReturnType<typeof createAppState>["state"];
type AppActions = ReturnType<typeof createAppState>["actions"];

export function useAncestry(state: AppState, actions: AppActions) {
  // Mutable ref: the hash of the commit used as the anchor.
  // A ref (not signal) because it must persist across multiple effect firings
  // in the same reactive flush without being consumed (see AGENTS.md rule 3).
  let ancestryAnchorHash: string | null = null;

  /**
   * Compute the first-parent chain passing through anchorHash in both directions.
   *
   * - Backward: follow parentHashes[0] from anchorHash up through ancestors.
   * - Forward: follow the reverse first-parent map (find rows whose first parent
   *   is already in the set) down through descendants.
   *
   * Result: the mainline "backbone" that passes through the selected commit —
   * its first-parent past and its first-parent future. Merge branches and
   * off-mainline commits are excluded (and therefore dimmed).
   */
  const buildFirstParentChain = (anchorHash: string): Set<string> => {
    const rows = state.graphRows();

    // Build two lookup maps using the TRUE git first parent (commit.parents[0]), NOT the
    // display-reordered parentHashes[0]. parentHashes is reordered by sameBranchFirst so
    // the "same branch" parent sorts to position 0 — which can differ from git's first parent
    // and would cause the chain to jump to a different branch at merge commits.
    //   firstParentOf[hash]    = hash's git first parent (commit.parents[0])
    //   firstChildOf[parent]   = the child whose git first parent is `parent`
    //                            (only the first such child encountered, graph order)
    const firstParentOf = new Map<string, string>();
    const firstChildOf = new Map<string, string>();
    const loadedHashes = new Set<string>();
    for (const row of rows) {
      const hash = row.commit.hash;
      loadedHashes.add(hash);
      const fp = row.commit.parents[0]; // git first parent — preserves true mainline
      if (fp) {
        firstParentOf.set(hash, fp);
        if (!firstChildOf.has(fp)) firstChildOf.set(fp, hash);
      }
    }

    const chain = new Set<string>();
    chain.add(anchorHash);

    // Walk backward (ancestors via first-parent).
    // Only add hashes that have loaded rows — if the parent isn't loaded,
    // stop. Adding unloaded hashes to the chain would break
    // computeBrightColumns' trailing-rows extension (it checks
    // ancestrySet.has(lastFirstParent) to decide whether to extend).
    let cur: string | undefined = firstParentOf.get(anchorHash);
    while (cur && !chain.has(cur) && loadedHashes.has(cur)) {
      chain.add(cur);
      cur = firstParentOf.get(cur);
    }

    // Walk forward (descendants via first-parent)
    cur = firstChildOf.get(anchorHash);
    while (cur && !chain.has(cur)) {
      chain.add(cur);
      cur = firstChildOf.get(cur);
    }

    return chain;
  };

  // Re-run chain computation when graphRows() changes and ancestry is active (lazy-loading support).
  // The prevGraphRows ref prevents redundant recomputation during the same reactive flush
  // that initially activates ancestry (command handler already sets the chain; this effect
  // should only fire when NEW data loads, not on the activation flush itself).
  let prevGraphRows: readonly object[] | null = null;
  createEffect(() => {
    const rows = state.graphRows();
    if (rows === prevGraphRows) return; // same reference — skip redundant flush
    prevGraphRows = rows;
    if (ancestryAnchorHash !== null) {
      const newSet = buildFirstParentChain(ancestryAnchorHash);
      // Structural comparison: skip setAncestrySet if the chain hasn't changed.
      // buildFirstParentChain always returns a new Set, but SolidJS uses ===
      // for signals, so a new Set always fires even when contents are identical.
      // This prevents the full render cascade (computeBrightColumns → dimChars →
      // every GraphLine) from re-running needlessly on auto-refresh / lazy load.
      const current = state.ancestrySet();
      if (current !== null && current.size === newSet.size) {
        let same = true;
        for (const h of newSet) {
          if (!current.has(h)) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      actions.setAncestrySet(newSet);
    }
  });

  /** Activate ancestry mode for the given commit hash. */
  const setAnchor = (hash: string) => {
    ancestryAnchorHash = hash;
    actions.setAncestrySet(buildFirstParentChain(hash));
  };

  /** Deactivate ancestry mode. */
  const clearAnchor = () => {
    ancestryAnchorHash = null;
    actions.setAncestrySet(null);
  };

  return { setAnchor, clearAnchor, buildFirstParentChain };
}
