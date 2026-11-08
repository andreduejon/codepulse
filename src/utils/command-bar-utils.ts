import { isUncommittedHash } from "../constants";
/**
 * Pure helper functions extracted from command-bar.tsx.
 *
 * These functions are framework-agnostic and unit-testable without SolidJS
 * or opentui dependencies.
 */
import type { CommandBarMode } from "../hooks/use-keyboard-navigation";

export function filterBadgeLabel(label: string, term: string | null): string {
  return ` ${label}${term ? ` · ${term.length > 10 ? `${term.slice(0, 9)}…` : term}` : ""} `;
}

/**
 * Derive the placeholder text for the command bar input based on the current mode.
 */
export function commandBarPlaceholder(mode: CommandBarMode): string {
  switch (mode) {
    case "command":
      return "Enter command...";
    case "search":
      return "Search commits...";
    case "path":
      return "Enter path...";
    default:
      return "";
  }
}

/**
 * Derive the commit count display text.
 *
 * - When a highlight is active: "matchCount / totalCount"
 * - Otherwise: "totalCount"
 */
/** Real commits among the graph rows: the working-tree changes node is a row, not a commit. */
export function realCommitCount(rows: readonly { commit: { hash: string } }[]): number {
  return rows.filter(row => !isUncommittedHash(row.commit.hash)).length;
}

export function commitCountText(highlightSet: Set<string> | null, totalRows: number): string {
  return highlightSet !== null ? `${highlightSet.size} / ${totalRows}` : `${totalRows}`;
}
