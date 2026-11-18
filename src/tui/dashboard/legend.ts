import type { DashboardEvent } from "../../core/dashboard/events";
import type { EventSource } from "../../core/provider-model";
import { moduleOf } from "../context/provider-modules";
import type { Theme } from "../context/theme";
import type { AnyProviderModule } from "../providers/module";
import type { LegendItem } from "../providers/shared/detail-legend";
import { statusColor } from "../providers/shared/status";
import { statusIcon } from "../utils/status-icon";

/** The knot every event shows in, in its provider's color. */
export const KNOT = "█";

/**
 * An event's mark before its text, as its provider's tab shows it: how a run or build ended, or what its provider
 * marks instead (a scan: its worst finding's severity). A commit has none.
 */
export function eventMark(
  event: DashboardEvent,
  modules: readonly AnyProviderModule[],
): { icon: string; color: (theme: Theme) => string } | null {
  const status = event.status;
  if (status === null) return null;
  const own = moduleOf(modules, event.source)?.eventMark;
  if (own) return own(event);
  return { icon: statusIcon(status), color: theme => statusColor(theme, status) };
}

/** The marks one provider's events use, for the side panel: the legend of the provider's own detail tab. */
export function markLegend(source: EventSource, modules: readonly AnyProviderModule[]): readonly LegendItem[] | null {
  return moduleOf(modules, source)?.legend ?? null;
}
