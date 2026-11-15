import type { Theme } from "../context/theme";
import { providerColors } from "../providers/colors";
import { type EventSource, providerDisplayName } from "../providers/provider";
import { type LegendItem, runLegend } from "../providers/shared/detail-legend";
import { statusColor, statusIcon } from "../providers/shared/status";
import type { DashboardEvent } from "./events";

/** The knot every event shows in, in its provider's color. */
export const KNOT = "█";

/** The bottom row's legend: a knot in each shown provider's color, with its name. */
export function providerLegend(sources: readonly EventSource[]): LegendItem[] {
  return sources.map(source => [[[KNOT, theme => providerColors(theme, source).bg]], providerDisplayName(source)]);
}

/**
 * An event's mark before its text: how a run or build ended; for a scan, how bad its worst finding is. A commit has
 * none.
 */
export function eventMark(event: DashboardEvent): { icon: string; color: (theme: Theme) => string } | null {
  const status = event.status;
  if (status === null) return null;
  if (event.source === "snyk") {
    if (status === "pass") return { icon: "✓", color: theme => theme.success };
    return { icon: "▲", color: theme => (status === "fail" ? theme.error : theme.warning) };
  }
  return { icon: statusIcon(status), color: theme => statusColor(theme, status) };
}

/** The marks one provider's events use, for the side panel. */
export function markLegend(source: EventSource): LegendItem[] | null {
  switch (source) {
    case "git":
      return null;
    case "github-actions":
      return runLegend("cancelled");
    case "jenkins":
      return runLegend("aborted");
    case "openshift":
      return (["pass", "running", "fail"] as const).map(category => [
        [[statusIcon(category), theme => statusColor(theme, category)]],
        category === "pass" ? "complete" : category === "running" ? "running" : "failed",
      ]);
    case "snyk":
      return [
        [[["▲", theme => theme.error]], "critical or high"],
        [[["▲", theme => theme.warning]], "medium or low"],
        [[["✓", theme => theme.success]], "no vulnerabilities"],
      ];
  }
}
