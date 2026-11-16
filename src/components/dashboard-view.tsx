import { MouseButton, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { HASH_COL_WIDTH } from "../constants";
import type { DashboardEvent, DashboardRow } from "../dashboard/events";
import { eventMark, KNOT } from "../dashboard/legend";
import type { DashboardState } from "../dashboard/use-dashboard";
import { useT } from "../hooks/use-t";
import { providerColors } from "../providers/colors";
import { severityColor } from "../providers/snyk/severity";
import { formatClock, formatDayLabel } from "../utils/date";
import { type ScrollSchedule, scheduleScrollIntoView, scrollElementIntoView } from "../utils/scroll";

const SNYK_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** Width of the Time column: `09:05` and its padding. */
const TIME_COL_WIDTH = 7;
/** The longest branch name the Branch column shows whole; a longer one ends in `…`. */
const BRANCH_MAX = 20;

/** `feature/payments-retry-…` for a name longer than `max`. */
const cutBranch = (name: string, max = BRANCH_MAX) => (name.length <= max ? name : `${name.slice(0, max - 1)}…`);

/**
 * The dashboard: the open app's rope, with each event a knot in its provider's color, newest first. Laid out like the
 * graph view: the rope, then Commit, Branch, Time and Event.
 */
export function DashboardView(
  props: Readonly<{
    dashboard: DashboardState;
    mouseEnabled?: () => boolean;
    now?: () => number;
  }>,
) {
  const t = useT();
  const d = props.dashboard;
  // The column's header is wider than the rope.
  const graphWidth = "Graph".length + 2;
  const [hovered, setHovered] = createSignal<number | null>(null);
  const days = () => d.settings().windowDays;
  /** As wide as the longest branch shown (at most BRANCH_MAX), and its header; one column of padding. */
  const branchWidth = () => {
    let longest = "Branch".length;
    for (const row of d.rows())
      if (row.kind === "event" && row.event.branch) longest = Math.max(longest, row.event.branch.length);
    return Math.min(longest, BRANCH_MAX) + 1;
  };

  /** The rope of one row: a knot in the provider's color for an event, plain rope elsewhere. */
  const Rope = (ropeProps: { row: DashboardRow }) => {
    const knot = () => {
      const row = ropeProps.row;
      return row.kind === "event" ? providerColors(t(), row.event.source).bg : null;
    };
    return (
      <box flexDirection="row" flexShrink={0} width={graphWidth} paddingLeft={1}>
        <text flexShrink={0} wrapMode="none" fg={knot() ?? t().border}>
          {knot() ? KNOT : "│"}
        </text>
      </box>
    );
  };

  /**
   * What happened: its mark (a commit has none), then its text. The commit is in its own column. A scan's counts take
   * their severity's color, muted without findings, and a partial scan ends in Snyk's warning `?`.
   */
  const EventText = (eventProps: { event: DashboardEvent }) => {
    const event = () => eventProps.event;
    const counts = () => {
      const found = event().counts;
      return found ? SNYK_SEVERITIES.map(severity => [severity, found[severity]] as const) : null;
    };
    return (
      <text wrapMode="none" truncate fg={t().foreground}>
        <Show when={eventMark(event())}>
          {mark => <span style={{ fg: mark().color(t()) }}>{`${mark().icon} `}</span>}
        </Show>
        <Show when={counts()} fallback={event().text}>
          {found => (
            <>
              {event().text.split(" · ").slice(0, 2).join(" · ")}
              <For each={found()}>
                {([severity, count]) => (
                  <>
                    {" · "}
                    <span style={{ fg: count > 0 ? severityColor(t(), severity) : t().foregroundMuted }}>
                      {`${count} ${severity}`}
                    </span>
                  </>
                )}
              </For>
              <Show when={event().partial}>
                <span style={{ fg: t().warning }}>{" ?"}</span>
              </Show>
            </>
          )}
        </Show>
      </text>
    );
  };

  let scrollbox: ScrollBoxRenderable | undefined;
  const rowRefs: Renderable[] = [];
  const schedule: ScrollSchedule = {};
  let lastCursor = -1;
  createEffect(() => {
    const index = d.cursor();
    if (index < 0) return;
    const direction: -1 | 0 | 1 = index > lastCursor ? 1 : index < lastCursor ? -1 : 0;
    lastCursor = index;
    scheduleScrollIntoView(schedule, () => {
      const element = rowRefs[index];
      return !!scrollbox && !!element && scrollElementIntoView(scrollbox, element, 1, direction);
    });
  });
  onCleanup(() => {
    if (schedule.scrollTimer) clearTimeout(schedule.scrollTimer);
  });

  const header = (label: string) => (
    <text wrapMode="none" truncate fg={t().accent}>
      <strong>{label}</strong>
    </text>
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      <box
        flexDirection="row"
        width="100%"
        flexShrink={0}
        border={["top"]}
        borderStyle="single"
        borderColor={t().accent}
      >
        <box flexShrink={0} width={graphWidth} paddingLeft={1}>
          {header("Graph")}
        </box>
        <box flexShrink={0} width={HASH_COL_WIDTH} paddingLeft={1}>
          {header("Commit")}
        </box>
        <box flexShrink={0} width={branchWidth() + 1} paddingLeft={1}>
          {header("Branch")}
        </box>
        <box flexShrink={0} width={TIME_COL_WIDTH} paddingLeft={1}>
          {header("Time")}
        </box>
        <box flexGrow={1} paddingLeft={1}>
          {header("Event")}
        </box>
      </box>
      <box border={["top"]} borderStyle="single" borderColor={t().accent} height={1} flexShrink={0} />
      <scrollbox
        ref={element => {
          scrollbox = element;
        }}
        flexGrow={1}
        scrollY
        scrollX={false}
        verticalScrollbarOptions={{ visible: false }}
      >
        <Show
          when={d.rows().length > 0}
          fallback={
            <box paddingLeft={2} height={1} flexShrink={0}>
              <text wrapMode="none" truncate fg={t().foregroundMuted}>
                {d.loading()
                  ? "reading events..."
                  : d.totalCount() > 0
                    ? "Every event is hidden. Click a provider's badge to show its events."
                    : days() === 1
                      ? "Nothing happened in the last day."
                      : `Nothing happened in the last ${days()} days.`}
              </text>
            </box>
          }
        >
          <For each={d.rows()}>
            {(row, index) => {
              const selectable = () => row.kind === "event";
              const active = () => index() === d.cursor();
              const lit = () => active() || (hovered() === index() && props.mouseEnabled?.() !== false);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: TUI rows use the dashboard's keyboard navigation.
                // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard selection already highlights the row.
                <box
                  ref={element => {
                    rowRefs[index()] = element;
                  }}
                  flexDirection="row"
                  width="100%"
                  height={1}
                  flexShrink={0}
                  backgroundColor={selectable() && lit() ? t().backgroundElement : undefined}
                  onMouseOver={() => setHovered(selectable() ? index() : null)}
                  onMouseOut={() => setHovered(null)}
                  onMouseDown={event => {
                    if (event.button !== MouseButton.LEFT || props.mouseEnabled?.() === false || !selectable()) return;
                    event.preventDefault();
                    // Like the graph, a click only selects: the details' first row shows the event in the graph.
                    d.select(index());
                  }}
                >
                  <Rope row={row} />
                  <Switch>
                    <Match when={row.kind === "date" && row}>
                      {date => (
                        // The divider runs from the Commit column to the end; the day starts where the times do.
                        <box flexDirection="row" flexGrow={1} minWidth={0} paddingLeft={1}>
                          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                            <span style={{ fg: t().border }}>{`${"─".repeat(HASH_COL_WIDTH + branchWidth())} `}</span>
                            {`${formatDayLabel(date().time, props.now?.())} `}
                          </text>
                          <box flexGrow={1} height={1} border={["top"]} borderStyle="single" borderColor={t().border} />
                        </box>
                      )}
                    </Match>
                    <Match when={row.kind === "event" && row}>
                      {eventRow => (
                        <>
                          <box flexShrink={0} width={HASH_COL_WIDTH} paddingLeft={1} overflow="hidden">
                            <text wrapMode="none" truncate fg={t().foregroundMuted}>
                              {eventRow().event.sha.slice(0, 7)}
                            </text>
                          </box>
                          <box flexShrink={0} width={branchWidth() + 1} paddingLeft={1} overflow="hidden">
                            <text wrapMode="none" fg={t().foregroundMuted}>
                              {cutBranch(eventRow().event.branch ?? "")}
                            </text>
                          </box>
                          <box flexShrink={0} width={TIME_COL_WIDTH} paddingLeft={1}>
                            <text wrapMode="none" fg={t().foregroundMuted}>
                              {formatClock(eventRow().event.time)}
                            </text>
                          </box>
                          <box flexGrow={1} flexShrink={1} minWidth={0} paddingLeft={1} paddingRight={2}>
                            <EventText event={eventRow().event} />
                          </box>
                        </>
                      )}
                    </Match>
                  </Switch>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
