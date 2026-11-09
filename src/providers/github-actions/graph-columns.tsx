/**
 * CI graph columns (GitHub Actions and Jenkins).
 *
 * In a CI view these replace the Author and Date columns:
 *
 *   Column 1 (Status): run-count chips — fail, running, neutral (cancelled, skipped, unknown), pass. Zero counts are
 *     skipped. The column grows to fit the widest chips (see `graphColumnWidths`).
 *   Column 2 (Last Run): relative time of the latest run, or `running` in the running colour.
 */

import { UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import { useT } from "../../hooks/use-t";
import { formatRelativeDate } from "../../utils/date";
import { ciBadgeCounts } from "../graph-column-widths";
import type { GraphBadge } from "../provider";
import { statusColor } from "../shared/status";
import { providerTextColor, StatusChips, statusCountChips } from "../shared/status-chips";

interface ActionsColumnProps {
  badge: GraphBadge | undefined;
  active: boolean;
  dimmed: boolean;
  width: number;
}

/** Coloured run-count chips in the author column. */
export function ActionsCountsColumn(props: Readonly<ActionsColumnProps>) {
  const t = useT();
  return (
    <StatusChips
      chips={statusCountChips(t(), ciBadgeCounts(props.badge))}
      width={props.width}
      paddingRight={2}
      active={props.active}
      dimmed={props.dimmed}
    />
  );
}

/** The latest run's relative time (or `running`) in the date column. */
export function ActionsDateColumn(props: Readonly<ActionsColumnProps>) {
  const t = useT();
  const running = () => props.badge?.latestStatus === "running";
  const label = () => {
    const b = props.badge;
    if (!b?.latestRunAt) return UNCOMMITTED_PLACEHOLDER;
    return running() ? "running" : formatRelativeDate(b.latestRunAt);
  };
  const fg = () =>
    running() && !props.dimmed ? statusColor(t(), "running") : providerTextColor(t(), props.active, props.dimmed);
  return (
    <box flexShrink={0} width={props.width} overflow="hidden">
      <text fg={fg()} wrapMode="none" truncate>
        {props.active ? <strong>{label()}</strong> : label()}
      </text>
    </box>
  );
}

/** Column headers for CI views (replace Author / Date). */
export function ActionsColumnHeaders(props: Readonly<{ first: number; second: number }>) {
  const { state } = useAppState();
  const t = useT();
  const color = () => (!state.detailFocused() ? t().accent : t().foregroundMuted);

  return (
    <>
      <box flexShrink={0} width={props.first} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Status</strong>
        </text>
      </box>
      <box flexShrink={0} width={props.second}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Last Run</strong>
        </text>
      </box>
    </>
  );
}
