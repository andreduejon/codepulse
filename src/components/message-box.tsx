import { MouseButton, type MouseEvent } from "@opentui/core";
import { createSignal, For, Show } from "solid-js";
import { useT } from "../hooks/use-t";

export type UIMessageKind = "error" | "warning" | "info";

export interface UIMessage {
  kind: UIMessageKind;
  title?: string;
  message: string;
  detail?: string;
}

interface MessageBoxProps {
  kind: UIMessageKind;
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
  const messageLines = () => props.message.split("\n");
  const detailLines = () => (props.detail ? props.detail.split("\n") : []);
  const headerLine = () => props.title ?? messageLines()[0] ?? "";
  const bodyLines = () =>
    props.title ? [...messageLines(), ...detailLines()] : [...messageLines().slice(1), ...detailLines()];

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
          <strong>{headerLine()}</strong>
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
