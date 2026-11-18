import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { Show } from "solid-js";
import { SHIFT_JUMP } from "../../constants";
import { useT } from "../../hooks/use-t";
import MessageBox from "../message-box";

/** No usable text yet, or none at all: what a log/object viewer shows instead of numbered lines. */
export type LogViewState =
  | { kind: "loading"; text: string }
  | { kind: "error"; title: string; message: string }
  | { kind: "empty"; text: string };

/**
 * Loading, error and empty states shared by the CI log and OpenShift resource dialogs: muted centred text while
 * fetching or when there is nothing to show, and an error box with the real reason. None gets a line number.
 */
export function LogViewStatus(props: Readonly<{ state: LogViewState }>) {
  const t = useT();
  return (
    <Show
      when={props.state.kind === "error" ? (props.state as Extract<LogViewState, { kind: "error" }>) : null}
      fallback={
        <box flexGrow={1} alignItems="center" justifyContent="center" paddingY={2}>
          <text fg={t().foregroundMuted}>{(props.state as Exclude<LogViewState, { kind: "error" }>).text}</text>
        </box>
      }
    >
      {error => (
        <box paddingY={1}>
          <MessageBox kind="error" title={error().title} message={error().message} variant="dialog" />
        </box>
      )}
    </Show>
  );
}

/**
 * Scrolling keys shared by the log viewers, by rendered rows (wrapped lines take several): ↑/↓ or j/k one row,
 * with shift ten, space half a page, g / G top and bottom. Returns true when the key was a scroll key.
 */
export function handleLogScrollKey(e: KeyEvent, scrollbox: ScrollBoxRenderable | undefined, pageRows: number): boolean {
  switch (e.name) {
    case "up":
    case "k":
      scrollbox?.scrollBy(e.shift ? -SHIFT_JUMP : -1, "absolute");
      return true;
    case "down":
    case "j":
      scrollbox?.scrollBy(e.shift ? SHIFT_JUMP : 1, "absolute");
      return true;
    case "space":
    case " ":
      scrollbox?.scrollBy(Math.max(1, Math.floor(pageRows / 2)), "absolute");
      return true;
    case "g":
      scrollbox?.scrollTo(e.shift ? Number.POSITIVE_INFINITY : 0);
      return true;
    default:
      return false;
  }
}
