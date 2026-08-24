import { For } from "solid-js";
import { UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { formatRelativeDate } from "../../utils/date";
import type { GraphBadge } from "../provider";
import type { SnykScanResult, SnykSeverity } from "./types";

export interface SnykGraphColumnProps {
  /** Exact scan for the row's commit, or null when that commit has not been scanned. */
  scan: SnykScanResult | null;
  active: boolean;
}

const SEVERITIES: { severity: SnykSeverity; label: string }[] = [
  { severity: "critical", label: "C" },
  { severity: "high", label: "H" },
  { severity: "medium", label: "M" },
  { severity: "low", label: "L" },
];

const LAST_SCAN_COL_WIDTH = 11;
/** Four ` C0 ` chips (16) + three `gap={1}` (3) + padding before the date (2). */
const SEVERITY_CHIPS_WIDTH = 21;

export function severityColumnWidth(badges: Iterable<GraphBadge>): number {
  let width = SEVERITY_CHIPS_WIDTH;
  for (const badge of badges) {
    const counts = badge.severityCounts;
    if (!counts) continue;
    const extraDigits =
      String(counts.critical).length +
      String(counts.high).length +
      String(counts.medium).length +
      String(counts.low).length -
      4;
    width = Math.max(width, SEVERITY_CHIPS_WIDTH + extraDigits);
  }
  return width;
}

function severityColor(theme: Theme, severity: SnykSeverity): string {
  switch (severity) {
    case "critical":
      return theme.severityCritical;
    case "high":
      return theme.severityHigh;
    case "medium":
      return theme.severityMedium;
    case "low":
      return theme.severityLow;
  }
}

/** Four compact severity counts occupying the existing author column. */
export function SnykCountsColumn(props: Readonly<SnykGraphColumnProps>) {
  const t = useT();
  const { state } = useAppState();
  const columnWidth = () => severityColumnWidth(state.graphBadges().values());

  return (
    <box flexShrink={0} width={columnWidth()} paddingRight={2} overflow="hidden" flexDirection="row" gap={1}>
      {props.scan ? (
        <For each={SEVERITIES}>
          {item => {
            const count = () => props.scan?.counts[item.severity] ?? 0;
            const background = () => (count() === 0 ? t().backgroundElementActive : severityColor(t(), item.severity));
            const foreground = () => (count() === 0 ? t().foregroundMuted : t().background);
            const label = () => ` ${item.label}${count()} `;
            return (
              <box flexShrink={0} height={1} backgroundColor={background()}>
                <text flexShrink={0} wrapMode="none" fg={foreground()} bg={background()}>
                  {props.active ? <strong>{label()}</strong> : label()}
                </text>
              </box>
            );
          }}
        </For>
      ) : (
        <text fg={t().foregroundMuted} wrapMode="none">
          {UNCOMMITTED_PLACEHOLDER}
        </text>
      )}
    </box>
  );
}

export function snykScanLabel(scan: SnykScanResult | null): string {
  if (!scan) return UNCOMMITTED_PLACEHOLDER;
  return formatRelativeDate(scan.scannedAt);
}

/** Relative scan time in the existing date column. */
export function SnykScanColumn(props: Readonly<SnykGraphColumnProps>) {
  const t = useT();
  const label = () => snykScanLabel(props.scan);

  return (
    <box flexShrink={0} width={LAST_SCAN_COL_WIDTH} overflow="hidden">
      <text fg={t().foregroundMuted} wrapMode="none" truncate>
        {props.active ? <strong>{label()}</strong> : label()}
      </text>
    </box>
  );
}

export function SnykColumnHeaders() {
  const { state } = useAppState();
  const t = useT();
  const color = () => (!state.detailFocused() ? t().accent : t().foregroundMuted);
  const columnWidth = () => severityColumnWidth(state.graphBadges().values());

  return (
    <>
      <box flexShrink={0} width={columnWidth()} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Severity</strong>
        </text>
      </box>
      <box flexShrink={0} width={LAST_SCAN_COL_WIDTH}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Last Scan</strong>
        </text>
      </box>
    </>
  );
}
