import { UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { formatRelativeDate } from "../../utils/date";
import type { GraphBadge } from "../provider";
import { providerTextColor, type StatusChip, StatusChips } from "../shared/status-chips";
import { severityColor } from "./tab-shared";
import type { SnykScanResult, SnykSeverity } from "./types";

export interface SnykGraphColumnProps {
  /** Exact scan for the row's commit, or null when that commit has not been scanned. */
  scan: SnykScanResult | null;
  active: boolean;
  dimmed: boolean;
  width: number;
}

const SEVERITIES: { severity: SnykSeverity; label: string }[] = [
  { severity: "critical", label: "C" },
  { severity: "high", label: "H" },
  { severity: "medium", label: "M" },
  { severity: "low", label: "L" },
];

/** Fits `scanning...`, the widest label (`12mo ago ?` fits too). */
export const LAST_SCAN_COL_WIDTH = 11;
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

function severityChips(theme: Theme, scan: SnykScanResult): StatusChip[] {
  return SEVERITIES.map(({ severity, label }) => {
    const count = scan.counts[severity];
    return {
      text: `${label}${count}`,
      fg: count === 0 ? theme.foregroundMuted : theme.background,
      bg: count === 0 ? theme.backgroundElementActive : severityColor(theme, severity),
    };
  });
}

/** Four compact severity counts occupying the author column. */
export function SnykCountsColumn(props: Readonly<SnykGraphColumnProps>) {
  const t = useT();
  return (
    <StatusChips
      chips={props.scan ? severityChips(t(), props.scan) : []}
      width={props.width}
      paddingRight={2}
      active={props.active}
      dimmed={props.dimmed}
    />
  );
}

export function snykScanLabel(scan: SnykScanResult | null): string {
  if (!scan) return UNCOMMITTED_PLACEHOLDER;
  return formatRelativeDate(scan.scannedAt);
}

/**
 * Relative scan time in the date column. A partial scan adds a `?` in the warning colour (some projects failed, so
 * zero findings is not a clean result); a scan in progress for this commit says `scanning...`.
 */
export function SnykScanColumn(props: Readonly<SnykGraphColumnProps & { scanning: boolean }>) {
  const t = useT();
  const label = () => (props.scanning ? BUSY.scanning : snykScanLabel(props.scan));
  const partial = () => !props.scanning && !!props.scan?.partial;
  const fg = () => providerTextColor(t(), props.active, props.dimmed);

  return (
    <box flexShrink={0} width={props.width} overflow="hidden" flexDirection="row">
      <text fg={fg()} wrapMode="none" flexShrink={1} truncate>
        {props.active ? <strong>{label()}</strong> : label()}
      </text>
      {partial() ? (
        <text flexShrink={0} wrapMode="none" fg={props.dimmed ? t().foregroundMuted : t().warning}>
          {props.active ? <strong>{" ?"}</strong> : " ?"}
        </text>
      ) : null}
    </box>
  );
}

export function SnykColumnHeaders(props: Readonly<{ first: number; second: number }>) {
  const { state } = useAppState();
  const t = useT();
  const color = () => (!state.detailFocused() ? t().accent : t().foregroundMuted);

  return (
    <>
      <box flexShrink={0} width={props.first} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Severity</strong>
        </text>
      </box>
      <box flexShrink={0} width={props.second}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Last Scan</strong>
        </text>
      </box>
    </>
  );
}
