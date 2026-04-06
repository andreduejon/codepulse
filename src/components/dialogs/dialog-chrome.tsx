import type { JSX } from "solid-js";
import { useT } from "../../hooks/use-t";
import { KeyHint } from "../key-hint";

/**
 * Full-screen semi-transparent overlay that centers its children.
 * Shared by all dialog components.
 */
export function DialogOverlay(props: Readonly<{ children: JSX.Element }>) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={"#00000080"}
      alignItems="center"
      justifyContent="center"
    >
      {props.children}
    </box>
  );
}

/**
 * Shared title bar for dialogs: title on the left, "esc close" hint on the right,
 * followed by a 1-row spacer.
 *
 * When `title` is a string it renders as bold text (backward-compatible).
 * When `title` is JSX the caller controls styling (used by the diff dialog
 * for per-segment colors).
 */
export function DialogTitleBar(props: Readonly<{ title: string | JSX.Element }>) {
  const t = useT();

  return (
    <>
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
        <text flexGrow={1} wrapMode="none">
          {typeof props.title === "string" ? (
            <strong>
              <span fg={t().foreground}>{props.title}</span>
            </strong>
          ) : (
            props.title
          )}
        </text>
        <KeyHint key="esc" desc=" close" />
      </box>
      <box height={1} flexShrink={0} />
    </>
  );
}

/**
 * Shared footer for dialogs: right-aligned keybind hints preceded by spacers.
 * Wrap keybind hint pairs (key + description `<text>` elements) as children.
 */
export function DialogFooter(props: Readonly<{ children: JSX.Element }>) {
  return (
    <>
      <box height={1} flexShrink={0} />
      <box height={1} flexShrink={0} />
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
        <box flexGrow={1} />
        {props.children}
      </box>
      <box height={1} flexShrink={0} />
    </>
  );
}
