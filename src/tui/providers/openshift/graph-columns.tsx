import type { OpenShiftStatus } from "../../../core/openshift/types";
import type { GraphBadge } from "../../../core/provider-model";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH } from "../../constants";
import { useAppState } from "../../context/state";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { cachedWidths, FIRST_COLUMN_PADDING } from "../graph-column-widths";
import type { ProviderGraphColumns } from "../module";
import { statusColor } from "../shared/status";
import { chipsWidth, type StatusChip, StatusChips, statusCountChips } from "../shared/status-chips";

/** Status colors are semantic tokens, not provider accent (OpenShift brand is red). */
export function openShiftStatusColor(t: Theme, status: OpenShiftStatus): string {
  return statusColor(t, status);
}

export function lookupOpenShiftBadge(badges: ReadonlyMap<string, GraphBadge>, sha: string): GraphBadge | undefined {
  return badges.get(sha) ?? badges.get(sha.toLowerCase());
}

/** What only the cache has: muted, after the chips of what the cluster has now. */
const cachedChip = (theme: Theme, count: number | undefined): StatusChip[] =>
  count ? [{ text: String(count), fg: theme.foregroundMuted, bg: theme.backgroundElementActive }] : [];

/** Resources: the status counts of what the cluster lists now, then how many only the cache has. */
function resourceChips(theme: Theme, badge: GraphBadge | undefined): StatusChip[] {
  return [...statusCountChips(theme, badge?.lanes?.live), ...cachedChip(theme, badge?.cachedCount)];
}

/**
 * Events: the warnings the cluster still reports in the warning color, the Normal events it lists now in the pass
 * color, then how many only the cache has.
 */
function eventChips(theme: Theme, badge: GraphBadge | undefined): StatusChip[] {
  const chip = (count: number | undefined, bg: string): StatusChip[] =>
    count ? [{ text: String(count), fg: theme.background, bg }] : [];
  return [
    ...chip(badge?.warningCount, theme.warning),
    ...chip(badge?.normalEventCount, statusColor(theme, "pass")),
    ...cachedChip(theme, badge?.cachedEventCount),
  ];
}

/** The chips' texts, for the columns' widths: the same as what is drawn, without a theme. */
const resourceTexts = (badge: GraphBadge) => {
  const live = badge.lanes?.live;
  const counts = live ? [live.failCount, live.runningCount, live.unknownCount, live.passCount] : [];
  return [...counts, badge.cachedCount ?? 0].filter(count => count > 0).map(String);
};
const eventTexts = (badge: GraphBadge) =>
  [badge.warningCount ?? 0, badge.normalEventCount ?? 0, badge.cachedEventCount ?? 0]
    .filter(count => count > 0)
    .map(String);

function OpenShiftChipsColumn(
  props: Readonly<{ chips: StatusChip[]; active: boolean; dimmed: boolean; width: number; paddingRight: number }>,
) {
  return (
    <StatusChips
      chips={props.chips}
      width={props.width}
      paddingRight={props.paddingRight}
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
      <box flexShrink={0} width={props.first} paddingRight={FIRST_COLUMN_PADDING}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Resources</strong>
        </text>
      </box>
      <box flexShrink={0} width={props.second}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Events</strong>
        </text>
      </box>
    </>
  );
}

/**
 * OpenShift's columns, named as its detail tabs: Resources (what the cluster has of the commit now, then muted what
 * only the cache has) and Events (the warnings the cluster still reports, the Normal events it lists now, then muted
 * the cached ones); and its
 * namespaces' names.
 */
export const OPENSHIFT_GRAPH_COLUMNS: ProviderGraphColumns = {
  widths: cachedWidths(badges => {
    let first = 0;
    let second = 0;
    for (const badge of badges.values()) {
      first = Math.max(first, chipsWidth(resourceTexts(badge)));
      second = Math.max(second, chipsWidth(eventTexts(badge)));
    }
    return {
      first: Math.max(AUTHOR_COL_WIDTH, first + FIRST_COLUMN_PADDING),
      second: Math.max(DATE_COL_WIDTH, second),
    };
  }),
  Headers: OpenShiftColumnHeaders,
  Cells: props => {
    const t = useT();
    return (
      <>
        <OpenShiftChipsColumn
          chips={resourceChips(t(), props.badge)}
          active={props.active}
          dimmed={props.dimmed}
          width={props.widths.first}
          paddingRight={FIRST_COLUMN_PADDING}
        />
        <OpenShiftChipsColumn
          chips={eventChips(t(), props.badge)}
          active={props.active}
          dimmed={props.dimmed}
          width={props.widths.second}
          paddingRight={0}
        />
      </>
    );
  },
  // By name only: whether it is ready, rolling out or failing shows in the counts and the details.
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
