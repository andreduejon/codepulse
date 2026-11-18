import type { OpenShiftStatus } from "../../../core/openshift/types";
import type { GraphBadge, GraphStatusCounts } from "../../../core/provider-model";
import { useAppState } from "../../context/state";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { cachedWidths, chipColumnWidths } from "../graph-column-widths";
import type { ProviderGraphColumns } from "../module";
import { statusColor } from "../shared/status";
import { StatusChips, statusCountChips } from "../shared/status-chips";

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

/** OpenShift's columns: what runs each commit now (Live) and what its cache saw (Cache), and its namespaces' names. */
export const OPENSHIFT_GRAPH_COLUMNS: ProviderGraphColumns = {
  widths: cachedWidths(badges =>
    chipColumnWidths(
      badges,
      badge => badge.lanes?.live,
      badge => badge.lanes?.cache,
    ),
  ),
  Headers: OpenShiftColumnHeaders,
  Cells: props => (
    <>
      <OpenShiftCountsColumn
        badge={props.badge}
        lane="live"
        active={props.active}
        dimmed={props.dimmed}
        width={props.widths.first}
      />
      <OpenShiftCountsColumn
        badge={props.badge}
        lane="cache"
        active={props.active}
        dimmed={props.dimmed}
        width={props.widths.second}
      />
    </>
  ),
  // By name only: whether it is ready, rolling out or failing shows in the Live counts and the details.
  refs: badge => badge?.namespaces?.map(marker => marker.namespace) ?? [],
  // Namespaces that run a commit the graph does not show (older than the loaded history, or filtered out), named at
  // the end of the graph since they have no row to carry the badge.
  unseen: (shown, badges) => {
    const parts: string[] = [];
    for (const [sha, badge] of badges) {
      if (!badge.namespaces || shown.has(sha.toLowerCase())) continue;
      for (const marker of badge.namespaces) parts.push(`${marker.namespace} runs ${sha.slice(0, 7)}`);
    }
    return parts.length > 0 ? `Not in the graph: ${parts.join(", ")}` : null;
  },
};
