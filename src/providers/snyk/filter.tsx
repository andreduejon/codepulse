import { type KeyEvent, MouseButton, type Renderable } from "@opentui/core";
import { createEffect, createSignal, type JSX, onCleanup } from "solid-js";
import { useT } from "../../hooks/use-t";
import type { SnykDetailTabProps } from "./detail-tab";
import { snykFixKind } from "./parser";
import type { SnykFinding } from "./types";

/** `name@version` queries match the finding's own package exactly (like Dependencies); anything else is a substring of any field. */
export function filterSnykFindings(findings: readonly SnykFinding[], query: string): SnykFinding[] {
  const term = query.trim().toLowerCase();
  if (term.lastIndexOf("@") > 0)
    return findings.filter(finding => `${finding.dependency}@${finding.installedVersion}`.toLowerCase() === term);
  return findings.filter(
    finding =>
      !term ||
      [
        finding.dependency,
        `${finding.dependency}@${finding.installedVersion}`,
        finding.title,
        finding.id,
        ...(finding.cves ?? []),
        snykFixKind(finding),
        finding.exploit ?? "",
        finding.targetFile ?? "",
        finding.dependencyPath?.[0] ?? "",
      ].some(value => value.toLowerCase().includes(term)),
  );
}

/** Filter hits: the first case-insensitive occurrence of `query` in `text`, in `color`; else plain text. */
export function highlightMatch(text: string, query: string, color: string): JSX.Element {
  const term = query.trim().toLowerCase();
  const at = term ? text.toLowerCase().indexOf(term) : -1;
  if (at < 0) return text;
  return [
    text.slice(0, at),
    <span style={{ fg: color }}>{text.slice(at, at + term.length)}</span>,
    text.slice(at + term.length),
  ];
}

/** `index` is the filter row's cursor position in the owning tab. */
export function useSnykFilter(props: Readonly<SnykDetailTabProps>, index = 1) {
  const [query, setQuery] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  let autoEditSuppressed = false;
  const stop = () => {
    autoEditSuppressed = props.detailCursorIndex() === index;
    setEditing(false);
  };
  const start = () => {
    autoEditSuppressed = false;
    props.onMouseFocus?.();
    props.setDetailCursorIndex(index);
    setEditing(true);
    props.navRef?.scrollToCursor?.();
  };
  const reset = () => {
    stop();
    setQuery("");
  };
  /** Restoring the cursor onto the filter row must not start editing (Left/Right would move the caret). */
  const suppressAutoEdit = () => {
    autoEditSuppressed = true;
  };
  const handleKey = (event: KeyEvent) => {
    if (!editing()) {
      if (query() && event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        return true;
      }
      return false;
    }
    if (["escape", "return", "up", "down", "tab"].includes(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      stop();
      if (event.name === "up" || (event.name === "tab" && event.shift)) props.setDetailCursorIndex(index - 1);
      else if (event.name === "down" || event.name === "tab")
        props.setDetailCursorIndex(Math.min(index + 1, (props.navRef?.itemCount ?? index + 1) - 1));
    }
    return true;
  };
  createEffect(() => {
    if (!props.detailFocused() || props.detailCursorIndex() !== index || !props.scan) {
      autoEditSuppressed = false;
      setEditing(false);
    } else if (!autoEditSuppressed) setEditing(true);
  });
  if (props.navRef) props.navRef.handleFilterKey = handleKey;
  onCleanup(() => {
    if (props.navRef?.handleFilterKey === handleKey) delete props.navRef.handleFilterKey;
  });
  return { query, setQuery, editing, start, stop, reset, suppressAutoEdit };
}

export function SnykFilterRow(props: {
  filter: ReturnType<typeof useSnykFilter>;
  selected: boolean;
  mouseEnabled?: boolean;
  rowRef?: (element: Renderable) => void;
  placeholder?: string;
  children?: JSX.Element;
}) {
  const t = useT();
  const [hovered, setHovered] = createSignal(false);
  const background = () =>
    props.filter.editing() || props.selected || (props.mouseEnabled && hovered())
      ? t().backgroundElement
      : t().background;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI filter row also supports keyboard Enter.
    // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard selection and Enter provide equivalent input access.
    <box
      ref={props.rowRef}
      height={1}
      flexShrink={0}
      width="100%"
      flexDirection="row"
      backgroundColor={background()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={event => {
        if (!props.mouseEnabled || event.button !== MouseButton.LEFT) return;
        event.stopPropagation();
        if (!props.filter.editing()) {
          event.preventDefault();
          props.filter.start();
        }
      }}
    >
      <input
        focused={props.filter.editing() && props.mouseEnabled !== false}
        flexGrow={1}
        flexShrink={1}
        value={props.filter.query()}
        onInput={value => {
          if (props.filter.editing()) props.filter.setQuery(value);
        }}
        onMouseDown={event => {
          if (!props.mouseEnabled || event.button !== MouseButton.LEFT) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        placeholder={props.placeholder ?? "Enter vulnerability filter..."}
        textColor={t().foreground}
        focusedTextColor={t().foreground}
        placeholderColor={t().foregroundMuted}
        cursorColor={t().accent}
        backgroundColor={background()}
        focusedBackgroundColor={t().backgroundElement}
      />
      {props.children}
    </box>
  );
}
