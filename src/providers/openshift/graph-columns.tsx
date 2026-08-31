import { For } from "solid-js";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH, UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import type { GraphBadge, GraphStatusCounts } from "../provider";
import type { OpenShiftStatus } from "./types";

/** Status colors are semantic tokens, not provider accent (OpenShift brand is red). */
export function openShiftStatusColor(t: Theme, status: OpenShiftStatus): string {
  switch (status) {
    case "fail":
      return t.error;
    case "running":
      return t.info;
    case "pass":
      return t.success;
    default:
      return t.foregroundMuted;
  }
}

interface OpenShiftCountsColumnProps {
  badge: GraphBadge | undefined;
  lane: "live" | "cache";
  active: boolean;
}

export function lookupOpenShiftBadge(badges: ReadonlyMap<string, GraphBadge>, sha: string): GraphBadge | undefined {
  return badges.get(sha) ?? badges.get(sha.toLowerCase());
}

function countsForLane(badge: GraphBadge | undefined, lane: "live" | "cache"): GraphStatusCounts | undefined {
  if (!badge) return undefined;
  return badge.lanes?.[lane];
}

function countBlocks(counts: GraphStatusCounts | undefined, t: Theme): { count: number; fg: string; bg: string }[] {
  if (!counts) return [];
  const next: { count: number; fg: string; bg: string }[] = [];
  if (counts.failCount > 0)
    next.push({ count: counts.failCount, fg: t.background, bg: openShiftStatusColor(t, "fail") });
  if (counts.runningCount > 0)
    next.push({ count: counts.runningCount, fg: t.background, bg: openShiftStatusColor(t, "running") });
  if (counts.unknownCount > 0)
    next.push({ count: counts.unknownCount, fg: t.foreground, bg: t.backgroundElementActive });
  if (counts.passCount > 0)
    next.push({ count: counts.passCount, fg: t.background, bg: openShiftStatusColor(t, "pass") });
  return next;
}

export function OpenShiftCountsColumn(props: Readonly<OpenShiftCountsColumnProps>) {
  const t = useT();
  const width = () => (props.lane === "live" ? AUTHOR_COL_WIDTH : DATE_COL_WIDTH);
  const blocks = () => countBlocks(countsForLane(props.badge, props.lane), t());

  return (
    <box
      flexShrink={0}
      width={width()}
      paddingRight={props.lane === "live" ? 2 : 0}
      overflow="hidden"
      flexDirection="row"
      gap={1}
    >
      {blocks().length === 0 ? (
        <text fg={t().foregroundMuted} wrapMode="none">
          {UNCOMMITTED_PLACEHOLDER}
        </text>
      ) : (
        <For each={blocks()}>
          {block => (
            <text flexShrink={0} wrapMode="none" fg={block.fg} bg={block.bg}>
              {` ${block.count} `}
            </text>
          )}
        </For>
      )}
    </box>
  );
}

export function OpenShiftColumnHeaders() {
  const { state } = useAppState();
  const t = useT();
  const color = () => (!state.detailFocused() ? t().accent : t().foregroundMuted);

  return (
    <>
      <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Live</strong>
        </text>
      </box>
      <box flexShrink={0} width={DATE_COL_WIDTH}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Cache</strong>
        </text>
      </box>
    </>
  );
}
