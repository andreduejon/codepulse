import { MouseButton, type MouseEvent } from "@opentui/core";
import { createSignal, For, Show } from "solid-js";
import { bannerParts } from "../debug/banner";
import { useT } from "../hooks/use-t";
import { TITLE_SEP } from "./dialogs/title-utils";

export type UIMessageKind = "error" | "warning" | "info";

export interface UIMessage {
  kind: UIMessageKind;
  /** Where the message comes from (`Git`, `Snyk`, …); shown muted after the headline. */
  source?: string;
  title?: string;
  message: string;
  detail?: string;
}

interface MessageBoxProps {
  kind: UIMessageKind;
  /** Shown muted after the headline. Without a title, the message's first sentence becomes the headline. */
  source?: string;
  title?: string;
  message: string;
  detail?: string;
  variant?: "screen" | "dialog";
  /** Shows a clickable `✕` at the end of the header line. */
  onDismiss?: () => void;
  mouseEnabled?: boolean;
}

export default function MessageBox(props: Readonly<MessageBoxProps>) {
  const t = useT();
  const [closeHovered, setCloseHovered] = createSignal(false);
  const borderColor = () => (props.kind === "error" ? t().error : props.kind === "warning" ? t().warning : t().info);
  const backgroundColor = () => (props.variant === "dialog" ? t().backgroundPanel : t().background);
  const parts = () => {
    const lines = props.message.split("\n");
    if (props.title) return { title: props.title, detail: lines };
    if (props.source) return bannerParts(props.source, props.message);
    return { title: lines[0] ?? "", detail: lines.slice(1) };
  };
  const bodyLines = () => [...parts().detail, ...(props.detail ? props.detail.split("\n") : [])];

  return (
    <box
      width="100%"
      flexDirection="column"
      backgroundColor={backgroundColor()}
      paddingX={1}
      paddingY={1}
      border={["left"]}
      borderStyle="single"
      borderColor={borderColor()}
    >
      <box paddingX={4} flexDirection="row">
        <text wrapMode="word" flexGrow={1} flexShrink={1} fg={t().foreground}>
          <strong>{parts().title}</strong>
          {props.source ? <span style={{ fg: t().foregroundMuted }}>{`${TITLE_SEP}${props.source}`}</span> : null}
        </text>
        <Show when={props.onDismiss}>
          {dismiss => (
            // biome-ignore lint/a11y/noStaticElementInteractions: TUI banners also close with `:clear`.
            // biome-ignore lint/a11y/useKeyWithMouseEvents: `:clear` provides the keyboard equivalent.
            <box
              flexShrink={0}
              onMouseOver={() => setCloseHovered(true)}
              onMouseOut={() => setCloseHovered(false)}
              onMouseDown={(event: MouseEvent) => {
                if (props.mouseEnabled === false || event.button !== MouseButton.LEFT) return;
                event.preventDefault();
                event.stopPropagation();
                dismiss()();
              }}
            >
              <text selectable={false} wrapMode="none" fg={closeHovered() ? t().foreground : t().foregroundMuted}>
                {"  ✕"}
              </text>
            </box>
          )}
        </Show>
      </box>
      <For each={bodyLines()}>
        {line => (
          <box paddingX={4}>
            <text wrapMode="word" fg={t().foregroundMuted}>
              {line}
            </text>
          </box>
        )}
      </For>
    </box>
  );
}
