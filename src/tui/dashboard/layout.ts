/** The Dashboard's columns in the terminal: how many characters the Branch column takes. */
import type { DashboardRow } from "../../core/dashboard/events";

/** The longest branch name the Branch column shows whole; a longer one ends in `…`. */
export const BRANCH_MAX = 20;

/** `feature/payments-retry-…` for a name longer than `max`. */
export const cutBranch = (name: string, max = BRANCH_MAX) => (name.length <= max ? name : `${name.slice(0, max - 1)}…`);

/** The Branch column: as wide as the longest branch shown (at most BRANCH_MAX) and its header, plus one of padding. */
export function branchColumnWidth(rows: readonly DashboardRow[]): number {
  let longest = "Branch".length;
  for (const row of rows)
    if (row.kind === "event" && row.event.branch) longest = Math.max(longest, row.event.branch.length);
  return Math.min(longest, BRANCH_MAX) + 1;
}
