import { Show } from "solid-js";
import type { OpenShiftStatus } from "../../../core/openshift/types";
import type { GraphBadge, GraphStatusCounts } from "../../../core/provider-model";
import { useAppState } from "../../context/state";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { cachedWidths, chipColumnWidths, FIRST_COLUMN_PADDING } from "../graph-column-widths";
import type { ProviderGraphColumns } from "../module";
import { statusColor } from "../shared/status";
import { StatusChips, statusCountChips, statusCountChipsWidth } from "../shared/status-chips";

/** ` !` after a commit's Live counts: OpenShift warned about it. What it said is in the Events tab. */
const WARNING_MARK_WIDTH = 2;

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
  const warned = () => props.lane === "live" && !!props.badge?.warnings;
  const markWidth = () => (warned() ? WARNING_MARK_WIDTH : 0);
  // The mark sits at the column's end, so the marks of every row line up.
  return (
    <box
      flexShrink={0}
      width={props.width}
      paddingRight={props.lane === "live" ? FIRST_COLUMN_PADDING : 0}
      flexDirection="row"
    >
      <StatusChips
        chips={statusCountChips(t(), countsForLane(props.badge, props.lane))}
        width={props.width - (props.lane === "live" ? FIRST_COLUMN_PADDING : 0) - markWidth()}
        active={props.active}
        dimmed={props.dimmed}
      />
      <Show when={warned()}>
        <box flexGrow={1} />
        <text
          flexShrink={0}
          width={WARNING_MARK_WIDTH}
          wrapMode="none"
          fg={props.dimmed ? t().foregroundMuted : t().warning}
        >
          {props.active ? <strong> !</strong> : " !"}
        </text>
      </Show>
    </box>
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
  widths: cachedWidths(badges => {
    const widths = chipColumnWidths(
      badges,
      badge => badge.lanes?.live,
      badge => badge.lanes?.cache,
    );
    // Room for the warning mark after the Live counts of a commit OpenShift warned about.
    let live = 0;
    for (const badge of badges.values())
      if (badge.warnings)
        live = Math.max(live, statusCountChipsWidth(badge.lanes?.live) + WARNING_MARK_WIDTH + FIRST_COLUMN_PADDING);
    return { ...widths, first: Math.max(widths.first, live) };
  }),
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
