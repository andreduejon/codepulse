/** OpenShift's marks, explained below its detail tab and beside its events on the Dashboard. */
import { statusIcon } from "../../utils/status-icon";
import type { LegendItem } from "../shared/detail-legend";
import { statusColor } from "../shared/status";

/** The row marks, explained below the tree (the namespace badges in the graph carry none). */
const LABELS = { pass: "ok", running: "in progress", fail: "failing", cancelled: "cancelled" } as const;

export const OPENSHIFT_LEGEND: LegendItem[] = (["pass", "running", "fail", "cancelled"] as const).map(category => [
  [[statusIcon(category), theme => statusColor(theme, category)]],
  LABELS[category],
]);

/** `!`: OpenShift warned about the resource. Its warnings are in the Events tab. */
export const OPENSHIFT_WARNING_LEGEND: LegendItem = [[["!", theme => theme.warning]], "warning"];
