import type { GraphBadge, GraphStatusCounts } from "../../core/provider-model";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH } from "../constants";
import { statusCountChipsWidth } from "./shared/status-chips";

/** Right padding inside the first (Author-position) column, before the second column. */
export const FIRST_COLUMN_PADDING = 2;

export interface GraphColumnWidths {
  /** Author position: Git author, CI status chips, OpenShift Live, Snyk severity (includes its right padding). */
  first: number;
  /** Date position: Git date, CI last run, OpenShift Cache, Snyk last scan. */
  second: number;
}

/** Git's Author and Date columns. */
export const GIT_WIDTHS: GraphColumnWidths = { first: AUTHOR_COL_WIDTH, second: DATE_COL_WIDTH };

/**
 * A provider's column widths, computed once per badge map (a refresh brings a new one): header, rows and the
 * subject-width budget all ask, so they always agree.
 */
export function cachedWidths(
  compute: (badges: ReadonlyMap<string, GraphBadge>) => GraphColumnWidths,
): (badges: ReadonlyMap<string, GraphBadge>) => GraphColumnWidths {
  const cache = new WeakMap<ReadonlyMap<string, GraphBadge>, GraphColumnWidths>();
  return badges => {
    let widths = cache.get(badges);
    if (!widths) {
      widths = compute(badges);
      cache.set(badges, widths);
    }
    return widths;
  };
}

/** Two columns of status chips, each grown to fit its widest chips so counts are never clipped. */
export function chipColumnWidths(
  badges: ReadonlyMap<string, GraphBadge>,
  first: (badge: GraphBadge) => GraphStatusCounts | undefined,
  second?: (badge: GraphBadge) => GraphStatusCounts | undefined,
): GraphColumnWidths {
  let firstWidth = 0;
  let secondWidth = 0;
  for (const badge of badges.values()) {
    firstWidth = Math.max(firstWidth, statusCountChipsWidth(first(badge)));
    if (second) secondWidth = Math.max(secondWidth, statusCountChipsWidth(second(badge)));
  }
  return {
    first: Math.max(AUTHOR_COL_WIDTH, firstWidth + FIRST_COLUMN_PADDING),
    second: Math.max(DATE_COL_WIDTH, secondWidth),
  };
}

/** CI badge counts as chip counts, including the neutral (cancelled, skipped, unknown) count. */
export function ciBadgeCounts(badge: GraphBadge | undefined): GraphStatusCounts | undefined {
  return badge
    ? {
        passCount: badge.passCount,
        failCount: badge.failCount,
        runningCount: badge.runningCount,
        unknownCount: badge.unknownCount ?? 0,
      }
    : undefined;
}
