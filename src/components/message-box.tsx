import { For } from "solid-js";
import { useT } from "../hooks/use-t";

export type UIMessageKind = "error" | "info";

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
}

export default function MessageBox(props: Readonly<MessageBoxProps>) {
  const t = useT();
  const borderColor = () => (props.kind === "error" ? t().error : t().info);
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
      <box paddingX={4}>
        <text wrapMode="word" fg={t().foreground}>
          <strong>{headerLine()}</strong>
        </text>
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
