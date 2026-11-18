/** Snyk's marks, explained below its detail tab and beside its events on the Dashboard. */

import { severityColor } from "../../utils/severity";
import type { LegendItem } from "../shared/detail-legend";

/** The triangle's color is a package's (on the dashboard, a scan's) worst severity: each level by its name. */
export const SNYK_SEVERITY_LEGEND: LegendItem[] = (["critical", "high", "medium", "low"] as const).map(severity => [
  [["▲", theme => severityColor(theme, severity)]],
  severity,
]);
