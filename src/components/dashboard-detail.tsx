import { MouseButton, type ScrollBoxRenderable } from "@opentui/core";
import { type Accessor, createEffect, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import type { DashboardEvent } from "../dashboard/events";
import { markLegend } from "../dashboard/legend";
import { type CommitInfo, loadCommitInfo } from "../dashboard/load";
import { useT } from "../hooks/use-t";
import { providerDisplayName } from "../providers/provider";
import { DetailLegend } from "../providers/shared/detail-legend";
import { formatDate } from "../utils/date";
import { DashboardEventText } from "./dashboard-event-text";

/**
 * The dashboard's side panel: the selected event, like the graph's details show the selected commit. What happened,
 * the provider's facts about it, and its commit as the app's repository knows it, with the provider's marks below.
 */
export function DashboardDetail(
  props: Readonly<{
    event: Accessor<DashboardEvent | null>;
    appName: (path: string) => string;
    /** How an event's commit is read (tests); from the app's repository otherwise. */
    loadCommit?: (app: string, sha: string) => Promise<CommitInfo | null>;
    /** The content's scrollbox, for the compact dialog's ↑/↓. */
    scrollboxRef?: (element: ScrollBoxRenderable) => void;
    /** The first row: the event's commit in the graph, on its provider's tab. */
    onShowInGraph?: () => void;
    mouseEnabled?: () => boolean;
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

  const Field = (fieldProps: { label: string; children: JSX.Element; wrap?: boolean }) => (
    <>
      <box height={1} />
      <text fg={t().accent} wrapMode="none">
        <strong>{fieldProps.label}</strong>
      </text>
      <text fg={t().foreground} wrapMode={fieldProps.wrap ? "word" : "none"} truncate={!fieldProps.wrap}>
        {fieldProps.children}
      </text>
    </>
  );

  const legend = () => {
    const event = props.event();
    return event ? markLegend(event.source) : null;
  };

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {/* One tab, drawn like the graph's detail tabs. */}
      <box flexDirection="column" width="100%" flexShrink={0}>
        <box border={["top"]} borderStyle="single" borderColor={t().foregroundMuted} flexShrink={0} />
        <box flexDirection="row" justifyContent="center" flexShrink={0}>
          <text selectable={false} wrapMode="none" fg={t().foregroundMuted}>
            <strong>{props.event() ? providerDisplayName(props.event()?.source ?? "git") : "Event"}</strong>
          </text>
        </box>
        <box border={["top"]} borderStyle="single" borderColor={t().border} flexShrink={0} />
      </box>
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
                    Show in graph
                  </text>
                  <text flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
                    {event().sha.slice(0, 7)}
                  </text>
                </box>
                <box height={1} flexShrink={0} />
              </Show>
              <DashboardEventText event={event()} wrap bold />
              <text fg={t().foregroundMuted} wrapMode="none" truncate>
                {`${props.appName(event().app)} · ${formatDate(new Date(event().time).toISOString())}`}
              </text>
              <For each={event().facts ?? []}>
                {fact => (
                  <Field label={fact.label} wrap={fact.label === "Reason"}>
                    {fact.value}
                  </Field>
                )}
              </For>
              <Show when={event().branch}>
                {branch => (
                  <Field label="Branch" wrap>
                    {branch()}
                  </Field>
                )}
              </Show>
              <Field label="Commit">{event().sha}</Field>
              <Show when={commit()}>
                {info => (
                  <>
                    <Field label="Subject" wrap>
                      {info().subject}
                    </Field>
                    <Field label="Author">{`${info().author} <${info().email}>`}</Field>
                    <Show when={event().source !== "git"}>
                      <Field label="Date">{formatDate(info().date)}</Field>
                    </Show>
                  </>
                )}
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
