/** Jenkins's marks, explained below its detail tab and beside its events on the Dashboard. */
import { type LegendItem, runLegend } from "../shared/detail-legend";

/** A cancelled build is `aborted` in Jenkins. */
export const JENKINS_LEGEND: LegendItem[] = runLegend("aborted");
