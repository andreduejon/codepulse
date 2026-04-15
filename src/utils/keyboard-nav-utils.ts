/**
 * Pure helper functions extracted from use-keyboard-navigation.ts.
 *
 * These functions contain the core navigation logic and are framework-agnostic,
 * making them unit-testable without SolidJS or opentui dependencies.
 */
import type { GraphRow } from "../git/types";

/**
 * When any highlighting is active, find the nearest highlighted row in the
 * given direction from `from`, stepping `count` highlighted entries.
 *
 * Returns the index of the target row, or `from` if no match found.
 *
 * @param rows     Full list of graph rows.
 * @param hSet     Set of highlighted commit hashes (null = no highlight active).
 * @param from     Starting row index (exclusive — search begins at from+direction).
 * @param direction  1 = forward (down), -1 = backward (up).
 * @param count    Number of highlighted entries to step over.
 */
export function findHighlightedIndex(
  rows: GraphRow[],
  hSet: Set<string> | null,
  from: number,
  direction: 1 | -1,
  count: number,
): number {
  if (!hSet) return from;
  let idx = from;
  let steps = 0;
  let next = from + direction;
  while (next >= 0 && next < rows.length) {
    if (hSet.has(rows[next].commit.hash)) {
      idx = next;
      steps++;
      if (steps >= count) break;
    }
    next += direction;
  }
  return steps > 0 ? idx : from;
}

/**
 * Count how many highlighted rows exist below `from` (exclusive), up to `limit`.
 *
 * @param rows   Full list of graph rows.
 * @param hSet   Set of highlighted commit hashes (null = no highlight active).
 * @param from   Starting index (exclusive — count starts at from+1).
 * @param limit  Maximum count to return (short-circuits early).
 */
export function countHighlightedBelow(rows: GraphRow[], hSet: Set<string> | null, from: number, limit: number): number {
  if (!hSet) return 0;
  let count = 0;
  for (let i = from + 1; i < rows.length && count < limit; i++) {
    if (hSet.has(rows[i].commit.hash)) count++;
  }
  return count;
}

/**
 * When the cursor is on a dimmed (non-highlighted) row, compute the target
 * index of the nearest highlighted row. Prefers forward direction, falls back
 * to backward. Returns the current index if already on a highlighted row or
 * if no highlighted rows exist.
 *
 * @param rows     Full list of graph rows.
 * @param hSet     Set of highlighted commit hashes.
 * @param curIdx   Current cursor index.
 */
export function computeDisplacedIndex(rows: GraphRow[], hSet: Set<string> | null, curIdx: number): number {
  if (!hSet || hSet.size === 0) return curIdx;
  if (curIdx < rows.length && hSet.has(rows[curIdx].commit.hash)) return curIdx;

  let fwd = -1;
  for (let i = curIdx + 1; i < rows.length; i++) {
    if (hSet.has(rows[i].commit.hash)) {
      fwd = i;
      break;
    }
  }
  let bwd = -1;
  for (let i = curIdx - 1; i >= 0; i--) {
    if (hSet.has(rows[i].commit.hash)) {
      bwd = i;
      break;
    }
  }

  if (fwd >= 0 && bwd >= 0) {
    // Pick the closer one; on equal distance prefer backward (original behavior)
    return curIdx - bwd <= fwd - curIdx ? bwd : fwd;
  }
  return fwd >= 0 ? fwd : bwd >= 0 ? bwd : curIdx;
}

/**
 * Determine which cascade step to close next, given the current UI state.
 *
 * Returns a string token describing what should be closed, or null if nothing
 * is open. The caller is responsible for executing the actual state mutations.
 *
 * Cascade order (highest priority first):
 *   command-bar → dialog → search-focused → detail-focused →
 *   search-highlight → ancestry-highlight → path-highlight → branch-view → nothing
 */
export type CascadeTarget =
  | "command-bar"
  | "detail-dialog"
  | "diff-blame-compact"
  | "dialog"
  | "search-focused"
  | "detail-focused"
  | "search-highlight"
  | "ancestry-highlight"
  | "path-highlight"
  | "branch-view"
  | null;

export interface CascadeState {
  commandBarMode: "idle" | "command" | "search" | "path";
  searchFocused: boolean;
  dialog: string | null;
  layoutMode: "too-small" | "compact" | "normal";
  detailFocused: boolean;
  highlightSet: Set<string> | null;
  searchQuery: string;
  ancestrySet: Set<string> | null;
  pathFilter: string | null;
  viewingBranch: string | null;
}

export function computeCascadeTarget(s: CascadeState): CascadeTarget {
  if (s.commandBarMode !== "idle") return "command-bar";
  if (s.dialog) {
    if (s.dialog === "detail") return "detail-dialog";
    if (s.dialog === "diff-blame" && s.layoutMode === "compact" && s.detailFocused) return "diff-blame-compact";
    return "dialog";
  }
  if (s.searchFocused) return "search-focused";
  if (s.detailFocused) return "detail-focused";
  if (s.highlightSet !== null) {
    if (s.searchQuery) return "search-highlight";
    if (s.ancestrySet !== null) return "ancestry-highlight";
    if (s.pathFilter) return "path-highlight";
  }
  if (s.viewingBranch) return "branch-view";
  return null;
}
