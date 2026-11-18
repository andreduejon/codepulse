/**
 * The marks each provider's detail tab explains below it. The dashboard explains a provider's events with the same
 * legend, so a mark means the same in both.
 */

import { statusIcon } from "../utils/status-icon";
import { type LegendItem, runLegend } from "./shared/detail-legend";
import { statusColor } from "./shared/status";
import { severityColor } from "./snyk/severity";

export const GITHUB_LEGEND: LegendItem[] = runLegend("cancelled");

/** A cancelled build is `aborted` in Jenkins. */
export const JENKINS_LEGEND: LegendItem[] = runLegend("aborted");

/** The row marks, explained below the tree (the namespace badges in the graph carry none). */
export const OPENSHIFT_LEGEND: LegendItem[] = (["pass", "running", "fail"] as const).map(category => [
  [[statusIcon(category), theme => statusColor(theme, category)]],
  category === "pass" ? "ok" : category === "running" ? "in progress" : "failing",
]);

/** The triangle's color is a package's (on the dashboard, a scan's) worst severity: each level by its name. */
export const SNYK_SEVERITY_LEGEND: LegendItem[] = (["critical", "high", "medium", "low"] as const).map(severity => [
  [["▲", theme => severityColor(theme, severity)]],
  severity,
]);
