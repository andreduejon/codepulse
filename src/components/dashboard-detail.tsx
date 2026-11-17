import { MouseButton, type ScrollBoxRenderable } from "@opentui/core";
import { type Accessor, createEffect, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import type { DetailTab } from "../context/state";
import { providerDisplayName } from "../core/provider-model";
import type { DashboardEvent } from "../dashboard/events";
import { markLegend } from "../dashboard/legend";
import { type CommitInfo, loadCommitInfo } from "../dashboard/load";
import { useT } from "../hooks/use-t";
import { DetailLegend, type LegendItem } from "../providers/shared/detail-legend";
import { formatDate } from "../utils/date";
import { DashboardEventText } from "./dashboard-event-text";

/** One of the selected event's provider tabs (Snyk has two). */
export interface DashboardDetailTab {
  id: DetailTab;
  label: string;
}

/**
 * The dashboard's side panel: the selected event, like the graph's details show the selected commit. What happened,
 * then its provider's own tab for its commit (runs, builds, resources, findings), as that provider's view shows it.
 * A commit, which has no provider tab, shows what the app's repository knows about it.
 */
export function DashboardDetail(
  props: Readonly<{
    event: Accessor<DashboardEvent | null>;
    appName: (path: string) => string;
    /** How an event's commit is read (tests); from the app's repository otherwise. */
    loadCommit?: (app: string, sha: string) => Promise<CommitInfo | null>;
    /** The content's scrollbox, for the compact dialog's ↑/↓. */
    scrollboxRef?: (element: ScrollBoxRenderable) => void;
    /** The first row: the event's commit in its provider's view, with that provider's details. */
    onShowInGraph?: () => void;
    mouseEnabled?: () => boolean;
    /** The selected event's provider tabs; none for a commit. */
    tabs?: Accessor<readonly DashboardDetailTab[]>;
    activeTab?: Accessor<DetailTab | null>;
    /** The tab's rows have the keyboard (→ from the events). */
    focused?: Accessor<boolean>;
    onSelectTab?: (tab: DetailTab) => void;
    /** The tab's content for the event's commit: its provider's own tab, or Info (with the commit as Git reads it). */
    renderTab?: (event: DashboardEvent, tab: DetailTab, commit: Accessor<CommitInfo | null>) => JSX.Element;
    /** The legend below: the active tab's own, else the provider's. */
    legend?: () => readonly LegendItem[] | null;
    /** A click inside the panel gives it the keyboard. */
    onMouseFocus?: () => void;
  }>,
) {
  const t = useT();
  const [actionHovered, setActionHovered] = createSignal(false);
  const commits = new Map<string, Promise<CommitInfo | null>>();
  const [commit, setCommit] = createSignal<CommitInfo | null>(null);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  createEffect(() => {
    const event = props.event();
    setCommit(null);
    if (!event) return;
    const key = `${event.app}\u0000${event.sha}`;
    let pending = commits.get(key);
    if (!pending) {
      pending = (props.loadCommit ?? loadCommitInfo)(event.app, event.sha);
      commits.set(key, pending);
    }
    void pending.then(info => {
      if (!disposed && props.event() === event) setCommit(info);
    });
  });

  const legend = () => {
    const event = props.event();
    if (!event) return null;
    return props.legend ? props.legend() : markLegend(event.source);
  };
  const tabs = () => (props.event() ? (props.tabs?.() ?? []) : []);
  /** The shown tab's identity: another event or tab builds its own content. */
  const tabKey = (): string | null => {
    const event = props.event();
    const tab = props.activeTab?.();
    return props.renderTab && event && tab ? `${event.id}\u0000${tab}` : null;
  };
  const [hoveredTab, setHoveredTab] = createSignal<DetailTab | null>(null);

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <Show
        when={tabs().length > 0}
        fallback={
          // One tab, drawn like the graph's detail tabs.
          <box flexDirection="column" width="100%" flexShrink={0}>
            <box border={["top"]} borderStyle="single" borderColor={t().foregroundMuted} flexShrink={0} />
            <box flexDirection="row" justifyContent="center" flexShrink={0}>
              <text selectable={false} wrapMode="none" fg={t().foregroundMuted}>
                <strong>{props.event() ? providerDisplayName(props.event()?.source ?? "git") : "Event"}</strong>
              </text>
            </box>
            <box border={["top"]} borderStyle="single" borderColor={t().border} flexShrink={0} />
          </box>
        }
      >
        {/* The provider's tabs, drawn and colored like the graph's detail tabs. */}
        <box flexDirection="row" width="100%" flexShrink={0}>
          <For each={tabs()}>
            {tab => {
              const active = () => props.activeTab?.() === tab.id;
              const focused = () => active() && !!props.focused?.();
              const hovered = () => props.mouseEnabled?.() !== false && hoveredTab() === tab.id;
              const line = () =>
                focused() ? t().accent : hovered() ? t().foreground : active() ? t().foregroundMuted : t().border;
              const label = () => (focused() ? t().accent : hovered() ? t().foreground : t().foregroundMuted);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: TUI tabs also support Left/Right.
                // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard-selected tabs already use accent colors.
                <box
                  flexGrow={1}
                  flexBasis={tab.label.length + 2}
                  flexDirection="column"
                  onMouseOver={() => setHoveredTab(tab.id)}
                  onMouseOut={() => setHoveredTab(null)}
                  onMouseDown={mouse => {
                    if (mouse.button !== MouseButton.LEFT || props.mouseEnabled?.() === false) return;
                    mouse.preventDefault();
                    props.onSelectTab?.(tab.id);
                  }}
                >
                  <box border={["top"]} borderStyle="single" borderColor={line()} flexShrink={0} />
                  <box flexDirection="row" justifyContent="center" flexShrink={0}>
                    <text selectable={false} wrapMode="none" fg={label()}>
                      {active() ? <strong>{tab.label}</strong> : tab.label}
                    </text>
                  </box>
                </box>
              );
            }}
          </For>
        </box>
        <box border={["top"]} borderStyle="single" borderColor={t().border} flexShrink={0} />
      </Show>
      <scrollbox
        ref={element => props.scrollboxRef?.(element)}
        flexGrow={1}
        scrollY
        scrollX={false}
        verticalScrollbarOptions={{ visible: false }}
      >
        <Show
          when={props.event()}
          fallback={
            <text fg={t().foregroundMuted} wrapMode="none">
              No event selected
            </text>
          }
        >
          {event => (
            <box flexDirection="column" width="100%">
              <Show when={props.onShowInGraph}>
                {/* The first row, like a provider tab's Reload commit: here, the way to the event's commit. */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI row; Enter does the same. */}
                {/* biome-ignore lint/a11y/useKeyWithMouseEvents: Hover only shades the row. */}
                <box
                  flexDirection="row"
                  width="100%"
                  flexShrink={0}
                  backgroundColor={
                    actionHovered() && props.mouseEnabled?.() !== false ? t().backgroundElement : undefined
                  }
                  onMouseOver={() => setActionHovered(true)}
                  onMouseOut={() => setActionHovered(false)}
                  onMouseDown={mouse => {
                    if (mouse.button !== MouseButton.LEFT || props.mouseEnabled?.() === false) return;
                    mouse.preventDefault();
                    props.onShowInGraph?.();
                  }}
                >
                  <text flexGrow={1} fg={t().foreground} wrapMode="none">
                    {`Show in ${providerDisplayName(event().source)}`}
                  </text>
                </box>
                {/* Without a tab, what happened follows; a tab's own first row (Reload commit) comes right after. */}
                <Show when={!props.renderTab}>
                  <box height={1} flexShrink={0} />
                </Show>
              </Show>
              {/* What happened, where no tab shows it: the tab opens and marks the event's own entry instead. */}
              <Show when={!props.renderTab}>
                <DashboardEventText event={event()} wrap bold />
                <box height={1} flexShrink={0} />
              </Show>
              <Show
                when={tabKey()}
                keyed
                fallback={
                  <>
                    <text fg={t().foregroundMuted} wrapMode="word">
                      {[event().branch, props.appName(event().app), formatDate(new Date(event().time).toISOString())]
                        .filter(Boolean)
                        .join(" · ")}
                    </text>
                    <DashboardCommitFields event={event()} commit={commit()} facts />
                  </>
                }
              >
                {(_key: string) => {
                  const tab = props.activeTab?.();
                  const shown = props.event();
                  return tab && shown ? props.renderTab?.(shown, tab, commit) : null;
                }}
              </Show>
            </box>
          )}
        </Show>
      </scrollbox>
      <Show when={legend()}>
        {items => (
          <>
            <box height={1} flexShrink={0} />
            <DetailLegend items={items()} />
          </>
        )}
      </Show>
    </box>
  );
}

/**
 * A commit as Git reads it, in the order of the graph's Info tab: for one the graph doesn't hold (older than its pages,
 * outside its branch filter). With `facts`, the event's provider facts come first (the panel without tabs).
 */
export function DashboardCommitFields(
  props: Readonly<{ event: DashboardEvent; commit: CommitInfo | null; facts?: boolean }>,
) {
  const t = useT();
  const Field = (fieldProps: { label: string; children: JSX.Element; wrap?: boolean; muted?: boolean }) => (
    <>
      <box height={1} />
      <text fg={t().accent} wrapMode="none">
        <strong>{fieldProps.label}</strong>
      </text>
      <text
        fg={fieldProps.muted ? t().foregroundMuted : t().foreground}
        wrapMode={fieldProps.wrap ? "word" : "none"}
        truncate={!fieldProps.wrap}
      >
        {fieldProps.children}
      </text>
    </>
  );
  return (
    <>
      <Show when={props.facts}>
        <For each={props.event.facts ?? []}>
          {fact => (
            <Field label={fact.label} wrap={fact.label === "Reason"}>
              {fact.value}
            </Field>
          )}
        </For>
      </Show>
      <Field label="Commit">{props.event.sha}</Field>
      <Show when={props.commit}>
        {info => (
          <>
            <Field label="Author">{`${info().author} <${info().email}>`}</Field>
            <Field label="Date">{formatDate(info().date)}</Field>
            <Field label="Subject" wrap>
              {info().subject}
            </Field>
            <Show when={info().body}>
              <Field label="Body" wrap muted>
                {info().body}
              </Field>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}
