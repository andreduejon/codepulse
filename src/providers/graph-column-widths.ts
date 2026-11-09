import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH } from "../constants";
import type { GraphBadge, GraphStatusCounts, ProviderView } from "./provider";
import { statusCountChipsWidth } from "./shared/status-chips";
import { LAST_SCAN_COL_WIDTH, severityColumnWidth } from "./snyk/graph-columns";

/** Right padding inside the first (Author-position) column, before the second column. */
export const FIRST_COLUMN_PADDING = 2;

export interface GraphColumnWidths {
  /** Author position: Git author, CI status chips, OpenShift Live, Snyk severity (includes its right padding). */
  first: number;
  /** Date position: Git date, CI last run, OpenShift Cache, Snyk last scan. */
  second: number;
}

const GIT_WIDTHS: GraphColumnWidths = { first: AUTHOR_COL_WIDTH, second: DATE_COL_WIDTH };
const cache = new WeakMap<ReadonlyMap<string, GraphBadge>, Map<ProviderView, GraphColumnWidths>>();

function ciCounts(badge: GraphBadge): GraphStatusCounts {
  return {
    passCount: badge.passCount,
    failCount: badge.failCount,
    runningCount: badge.runningCount,
    unknownCount: badge.unknownCount ?? 0,
  };
}

function compute(view: ProviderView, badges: ReadonlyMap<string, GraphBadge>): GraphColumnWidths {
  if (view === "git") return GIT_WIDTHS;
  if (view === "snyk") return { first: severityColumnWidth(badges.values()), second: LAST_SCAN_COL_WIDTH };
  let first = 0;
  let second = 0;
  for (const badge of badges.values()) {
    if (view === "openshift") {
      first = Math.max(first, statusCountChipsWidth(badge.lanes?.live));
      second = Math.max(second, statusCountChipsWidth(badge.lanes?.cache));
    } else first = Math.max(first, statusCountChipsWidth(ciCounts(badge)));
  }
  return {
    first: Math.max(AUTHOR_COL_WIDTH, first + FIRST_COLUMN_PADDING),
    second: Math.max(DATE_COL_WIDTH, second),
  };
}

/**
 * Widths of the two provider columns, grown to fit the widest chips in the current badges so counts are never
 * clipped. Header, rows and the subject-width budget all use this, so they always agree. Cached per badge map.
 */
export function graphColumnWidths(view: ProviderView, badges: ReadonlyMap<string, GraphBadge>): GraphColumnWidths {
  let byView = cache.get(badges);
  if (!byView) {
    byView = new Map();
    cache.set(badges, byView);
  }
  let widths = byView.get(view);
  if (!widths) {
    widths = compute(view, badges);
    byView.set(view, widths);
  }
  return widths;
}

/** CI badge counts as chip counts, including the neutral (cancelled, skipped, unknown) count. */
export function ciBadgeCounts(badge: GraphBadge | undefined): GraphStatusCounts | undefined {
  return badge ? ciCounts(badge) : undefined;
}
