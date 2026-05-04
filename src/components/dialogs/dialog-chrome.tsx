import type { JSX } from "solid-js";
import { KeyHint } from "../key-hint";

const STANDARD_DIALOG_MIN_WIDTH = 72;
const STANDARD_DIALOG_MAX_WIDTH = 160;
const STANDARD_DIALOG_WIDTH_FRACTION = 0.9;
const STANDARD_DIALOG_MIN_HEIGHT = 10;
const STANDARD_DIALOG_HEIGHT_FRACTION = 0.85;
const STANDARD_DIALOG_VERTICAL_MARGIN = 4;

export function getStandardDialogFrame(dimensions: Readonly<{ width: number; height: number }>) {
  return {
    width: Math.min(
      Math.max(STANDARD_DIALOG_MIN_WIDTH, Math.floor(dimensions.width * STANDARD_DIALOG_WIDTH_FRACTION)),
      STANDARD_DIALOG_MAX_WIDTH,
    ),
    height: Math.min(
      Math.max(STANDARD_DIALOG_MIN_HEIGHT, Math.floor(dimensions.height * STANDARD_DIALOG_HEIGHT_FRACTION)),
      dimensions.height - STANDARD_DIALOG_VERTICAL_MARGIN,
    ),
  };
}

/**
 * Full-screen semi-transparent overlay that centers or top-aligns children.
 * Shared by all dialog components.
 */
export function DialogOverlay(
  props: Readonly<{ children: JSX.Element; align?: "center" | "top"; topOffset?: number }>,
) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={"#000000CC"}
      alignItems="center"
      justifyContent={props.align === "top" ? "flex-start" : "center"}
      paddingTop={props.align === "top" ? (props.topOffset ?? 2) : 0}
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
  return (
    <>
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
        <text flexGrow={1} wrapMode="none">
          {typeof props.title === "string" ? (
            <strong>
              <span>{props.title}</span>
            </strong>
          ) : (
            props.title
          )}
        </text>
        <box width={1} flexShrink={0} />
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
export function DialogFooter(props: Readonly<{ children: JSX.Element; left?: JSX.Element }>) {
  return (
    <>
      <box height={1} flexShrink={0} />
      <box height={1} flexShrink={0} />
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0}>
        {props.left}
        <box flexGrow={1} />
        {props.children}
      </box>
      <box height={1} flexShrink={0} />
    </>
  );
}
