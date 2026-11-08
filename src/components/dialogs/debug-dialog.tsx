import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { For } from "solid-js";
import { SHIFT_JUMP } from "../../constants";
import { getDebugEvents } from "../../debug/events";
import { formatDebugDuration, formatDebugMessage, formatDebugStatus, formatDebugTimestamp } from "../../debug/format";
import { useT } from "../../hooks/use-t";
import { debugSourceColor } from "../../providers/colors";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function DebugDialog(props: Readonly<{ onClose: () => void; gitColor: string }>) {
  const t = useT();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const events = () => getDebugEvents();
  const dialogWidth = () => 90;
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.7), dimensions().height - 8);
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const sourceColor = (source: ReturnType<typeof events>[number]["source"]) =>
    debugSourceColor(t(), source, props.gitColor);

  /** Errors are red whatever their source (a GitHub request error as much as a Git one). */
  const messageColor = (event: ReturnType<typeof events>[number]) =>
    event.status === "error" || event.source === "error" ? t().error : t().foreground;

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (e.name === "q") {
      e.preventDefault();
      renderer.destroy();
    } else if (e.name === "escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.name === "up" || e.name === "k") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? -SHIFT_JUMP : -1, "absolute");
    } else if (e.name === "down" || e.name === "j") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? SHIFT_JUMP : 1, "absolute");
    } else if (e.name === "g") {
      e.preventDefault();
      scrollboxRef?.scrollTo(e.shift ? Infinity : 0);
    }
  });

  return (
    <DialogOverlay>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().background}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Debug" onClose={props.onClose} />
        <box width="100%" paddingX={4} flexShrink={0}>
          <box flexGrow={1} border={["top"]} borderStyle="single" borderColor={t().accent} />
        </box>
        <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
          <text width={10} flexShrink={0} wrapMode="none" fg={t().accent}>
            <strong>Provider</strong>
          </text>
          <text width={10} flexShrink={0} wrapMode="none" fg={t().accent}>
            <strong>Status</strong>
          </text>
          <text width={10} flexShrink={0} wrapMode="none" fg={t().accent}>
            <strong>Duration</strong>
          </text>
          <text width={10} flexShrink={0} wrapMode="none" fg={t().accent}>
            <strong>Time</strong>
          </text>
          <text flexGrow={1} wrapMode="none" fg={t().accent}>
            <strong>Message</strong>
          </text>
        </box>
        <box width="100%" paddingX={4} flexShrink={0}>
          <box flexGrow={1} border={["top"]} borderStyle="single" borderColor={t().border} />
        </box>
        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          scrollY
          scrollX={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column">
            <For
              each={events()}
              fallback={
                <box paddingX={4}>
                  <text fg={t().foregroundMuted}>No debug events yet</text>
                </box>
              }
            >
              {event => (
                <box flexDirection="row" width="100%" paddingX={4} alignItems="flex-start">
                  <text width={10} flexShrink={0} wrapMode="none" fg={sourceColor(event.source)}>
                    {event.source}
                  </text>
                  <text width={10} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {formatDebugStatus(event.status)}
                  </text>
                  <text width={10} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {formatDebugDuration(event.durationMs)}
                  </text>
                  <text width={10} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {formatDebugTimestamp(event.timestamp)}
                  </text>
                  <text flexGrow={1} wrapMode="word" fg={messageColor(event)}>
                    {formatDebugMessage(event)}
                  </text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
      </box>
    </DialogOverlay>
  );
}
