import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { For } from "solid-js";
import { getDebugEvents } from "../../debug/events";
import { formatDebugDuration, formatDebugMessage, formatDebugTimestamp } from "../../debug/format";
import { useT } from "../../hooks/use-t";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

export default function DebugDialog(props: Readonly<{ onClose: () => void }>) {
  const t = useT();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const events = () => getDebugEvents();
  const dialogWidth = () => 90;
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.7), dimensions().height - 8);
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const sourceColor = (source: ReturnType<typeof events>[number]["source"]) => {
    switch (source) {
      case "Git":
        return t().foregroundMuted;
      case "GitHub":
        return t().githubActionsBg;
      case "Jenkins":
        return t().success;
      case "error":
        return t().error;
    }
  };

  const messageColor = (source: ReturnType<typeof events>[number]["source"]) =>
    source === "error" ? t().error : t().foreground;

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
      scrollboxRef?.scrollBy(e.shift ? -5 : -1, "absolute");
    } else if (e.name === "down" || e.name === "j") {
      e.preventDefault();
      scrollboxRef?.scrollBy(e.shift ? 5 : 1, "absolute");
    } else if (e.name === "g") {
      e.preventDefault();
      scrollboxRef?.scrollTo(e.shift ? Infinity : 0);
    }
  });

  return (
    <DialogOverlay>
      <box width={dialogWidth()} height={dialogHeight()} backgroundColor={t().background} flexDirection="column" paddingX={1} paddingY={1}>
        <DialogTitleBar title="Debug" />
        <scrollbox ref={scrollboxRef} flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            <For each={events()} fallback={<text fg={t().foregroundMuted}>No debug events yet</text>}>
              {event => (
                <box flexDirection="row" width="100%" paddingX={4} alignItems="flex-start">
                  <text width={10} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {formatDebugTimestamp(event.timestamp)}
                  </text>
                  <text width={10} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {formatDebugDuration(event.durationMs)}
                  </text>
                  <text width={10} flexShrink={0} wrapMode="none" fg={sourceColor(event.source)}>
                    {event.source}
                  </text>
                  <text flexGrow={1} wrapMode="word" fg={messageColor(event.source)}>
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
