import { MouseButton } from "@opentui/core";
import { createSignal, type JSX, Show } from "solid-js";
import { useT } from "../hooks/use-t";

interface KeyHintProps {
  key: JSX.Element | string;
  desc: JSX.Element | string;
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * A keybind hint strip: bold key label followed by a muted description.
 * Used in footers and title bars across the app.
 *
 * The `desc` prop should include its own leading/trailing spaces for spacing,
 * e.g. desc=" confirm  " or desc=" help".
 */
export function KeyHint(props: Readonly<KeyHintProps>) {
  const t = useT();
  const [hovered, setHovered] = createSignal(false);
  return (
    <Show
      when={props.onClick && !props.disabled}
      fallback={
        <>
          <text
            selectable={false}
            flexShrink={0}
            wrapMode="none"
            fg={props.disabled ? t().foregroundMuted : t().foreground}
          >
            {props.key}
          </text>
          <text selectable={false} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {props.desc}
          </text>
        </>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: TUI action also has its displayed keyboard shortcut. */}
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard invokes the same action. */}
      <text
        selectable={false}
        flexShrink={0}
        wrapMode="none"
        fg={hovered() ? t().foreground : t().foregroundMuted}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseDown={event => {
          if (event.button !== MouseButton.LEFT) return;
          event.preventDefault();
          event.stopPropagation();
          props.onClick?.();
        }}
      >
        <span style={{ fg: t().foreground }}>{props.key}</span>
        {props.desc}
      </text>
    </Show>
  );
}

export function KeyHintSeparator() {
  const t = useT();
  return (
    <text selectable={false} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
      {" · "}
    </text>
  );
}
