import { useAppState } from "../../context/state";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import type { GraphBadge, GraphStatusCounts } from "../provider";
import { statusColor } from "../shared/status";
import { StatusChips, statusCountChips } from "../shared/status-chips";
import type { OpenShiftStatus } from "./types";

/** Status colors are semantic tokens, not provider accent (OpenShift brand is red). */
export function openShiftStatusColor(t: Theme, status: OpenShiftStatus): string {
  return statusColor(t, status);
}

export function lookupOpenShiftBadge(badges: ReadonlyMap<string, GraphBadge>, sha: string): GraphBadge | undefined {
  return badges.get(sha) ?? badges.get(sha.toLowerCase());
}

function countsForLane(badge: GraphBadge | undefined, lane: "live" | "cache"): GraphStatusCounts | undefined {
  return badge?.lanes?.[lane];
}

/** Live (author position) or Cache (date position) resource counts, in the shared chip style. */
export function OpenShiftCountsColumn(
  props: Readonly<{
    badge: GraphBadge | undefined;
    lane: "live" | "cache";
    active: boolean;
    dimmed: boolean;
    width: number;
  }>,
) {
  const t = useT();
  return (
    <StatusChips
      chips={statusCountChips(t(), countsForLane(props.badge, props.lane))}
      width={props.width}
      paddingRight={props.lane === "live" ? 2 : 0}
      active={props.active}
      dimmed={props.dimmed}
    />
  );
}

export function OpenShiftColumnHeaders(props: Readonly<{ first: number; second: number }>) {
  const { state } = useAppState();
  const t = useT();
  const color = () => (!state.detailFocused() ? t().accent : t().foregroundMuted);

  return (
    <>
      <box flexShrink={0} width={props.first} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Live</strong>
        </text>
      </box>
      <box flexShrink={0} width={props.second}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Cache</strong>
        </text>
      </box>
    </>
  );
}
