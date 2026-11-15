import type { Theme } from "../context/theme";
import { providerColors } from "../providers/colors";
import { GITHUB_LEGEND, JENKINS_LEGEND, OPENSHIFT_LEGEND, SNYK_SEVERITY_LEGEND } from "../providers/legends";
import { type EventSource, providerDisplayName } from "../providers/provider";
import type { LegendItem } from "../providers/shared/detail-legend";
import { statusColor, statusIcon } from "../providers/shared/status";
import { severityColor } from "../providers/snyk/severity";
import type { DashboardEvent } from "./events";

/** The knot every event shows in, in its provider's color. */
export const KNOT = "█";

/** The bottom row's legend: a knot in each shown provider's color, with its name. */
export function providerLegend(sources: readonly EventSource[]): LegendItem[] {
  return sources.map(source => [[[KNOT, theme => providerColors(theme, source).bg]], providerDisplayName(source)]);
}

/**
 * An event's mark before its text, as its provider's tab shows it: how a run or build ended; for a scan, its worst
 * finding's severity. A commit and a clean scan have none.
 */
export function eventMark(event: DashboardEvent): { icon: string; color: (theme: Theme) => string } | null {
  const status = event.status;
  if (status === null) return null;
  if (event.source === "snyk") {
    const severity = event.severity;
    return severity ? { icon: "▲", color: theme => severityColor(theme, severity) } : null;
  }
  return { icon: statusIcon(status), color: theme => statusColor(theme, status) };
}

/** The marks one provider's events use, for the side panel: the legend of the provider's own detail tab. */
export function markLegend(source: EventSource): LegendItem[] | null {
  switch (source) {
    case "git":
      return null;
    case "github-actions":
      return GITHUB_LEGEND;
    case "jenkins":
      return JENKINS_LEGEND;
    case "openshift":
      return OPENSHIFT_LEGEND;
    case "snyk":
      return SNYK_SEVERITY_LEGEND;
  }
}
