import { MouseButton, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { HASH_COL_WIDTH } from "../constants";
import type { DashboardEvent, DashboardRow } from "../dashboard/events";
import { eventMark, KNOT } from "../dashboard/legend";
import type { DashboardState } from "../dashboard/use-dashboard";
import { useT } from "../hooks/use-t";
import { providerColors } from "../providers/colors";
import { formatClock, formatDayLabel } from "../utils/date";
import { type ScrollSchedule, scheduleScrollIntoView, scrollElementIntoView } from "../utils/scroll";

/** Width of the Time column: `09:05` and its padding. */
const TIME_COL_WIDTH = 7;

/**
 * The dashboard: the open app's rope, with each event a knot in its provider's color, newest first. Laid out like the
 * graph view: the rope, then Commit, Time and Event.
 */
export function DashboardView(
  props: Readonly<{
    dashboard: DashboardState;
    mouseEnabled?: () => boolean;
    /** Enter on the selected row, or a click on a selected row. */
    onActivate: () => void;
    now?: () => number;
  }>,
) {
  const t = useT();
  const d = props.dashboard;
  // The column's header is wider than the rope.
  const graphWidth = "Graph".length + 2;
  const [hovered, setHovered] = createSignal<number | null>(null);
  const days = () => d.settings().windowDays;

  /** The rope of one row: a knot in the provider's color for an event, plain rope elsewhere. */
  const Rope = (ropeProps: { row: DashboardRow }) => {
    const knot = () => {
      const row = ropeProps.row;
      if (row.kind === "event") return providerColors(t(), row.event.source).bg;
      if (row.kind === "more") return t().foregroundMuted;
      return null;
    };
    return (
      <Show
        when={ropeProps.row.kind !== "date"}
        fallback={
          // A day's divider crosses the rope.
          <box flexShrink={0} width={graphWidth}>
            <text flexShrink={0} wrapMode="none" fg={t().border}>
              {`─┼${"─".repeat(graphWidth - 2)}`}
            </text>
          </box>
        }
      >
        <box flexDirection="row" flexShrink={0} width={graphWidth} paddingLeft={1}>
          <text flexShrink={0} wrapMode="none" fg={knot() ?? t().border}>
            {knot() ? KNOT : "│"}
          </text>
        </box>
      </Show>
    );
  };

  /** What happened: its mark (a commit has none), then its text. The commit is in its own column. */
  const EventText = (eventProps: { event: DashboardEvent }) => {
    const event = () => eventProps.event;
    return (
      <text wrapMode="none" truncate fg={t().foreground}>
        <Show when={eventMark(event())}>
          {mark => <span style={{ fg: mark().color(t()) }}>{`${mark().icon} `}</span>}
        </Show>
        {event().text}
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
                  : days() === 1
                    ? "Nothing happened in the last day."
                    : `Nothing happened in the last ${days()} days.`}
              </text>
            </box>
          }
        >
          <For each={d.rows()}>
            {(row, index) => {
              const selectable = () => row.kind === "event" || row.kind === "more";
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
                    if (active()) props.onActivate();
                    else d.select(index());
                  }}
                >
                  <Rope row={row} />
                  <Switch>
                    <Match when={row.kind === "date" && row}>
                      {date => (
                        // The divider goes on across the table, the day where the commits start.
                        <box flexDirection="row" flexGrow={1} minWidth={0} paddingLeft={1}>
                          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
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
                    <Match when={row.kind === "more" && row}>
                      {more => (
                        <box flexGrow={1} paddingLeft={HASH_COL_WIDTH + TIME_COL_WIDTH + 1}>
                          <text wrapMode="none" truncate fg={t().foregroundMuted}>
                            {`+${more().hidden} more`}
                          </text>
                        </box>
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
