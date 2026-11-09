import { type BoxRenderable, MouseButton, type MouseEvent, type Renderable } from "@opentui/core";
import { createSignal, Show } from "solid-js";
import { useBannerScroll } from "../../hooks/use-banner-scroll";
import { useT } from "../../hooks/use-t";
import { cellWidth, sliceCells, truncateCells } from "../../utils/terminal-text";

/**
 * Hover and left-click handling shared by provider detail rows (CI runs/jobs, OpenShift namespaces/resources, action
 * rows). A click focuses the sidebar, moves the cursor to the row and activates it. Rows outside the cursor order
 * (index < 0) and inert rows (a disabled or busy action) neither react nor highlight.
 */
export function useDetailRowMouse(opts: {
  mouseEnabled: () => boolean | undefined;
  onMouseFocus?: () => void;
  setDetailCursorIndex: (index: number) => void;
  activate: () => unknown;
  /** True for a row that is visible but cannot be used right now. */
  inert?: (key: string) => boolean;
}) {
  const t = useT();
  const [hoveredKey, setHoveredKey] = createSignal<string | null>(null);
  const mouseRow = (key: string, index: () => number) => ({
    onMouseOver: () => setHoveredKey(key),
    onMouseOut: () => setHoveredKey(null),
    onMouseDown: (event: MouseEvent) => {
      if (!opts.mouseEnabled() || event.button !== MouseButton.LEFT) return;
      event.preventDefault();
      event.stopPropagation();
      if (index() < 0 || opts.inert?.(key)) return;
      opts.onMouseFocus?.();
      opts.setDetailCursorIndex(index());
      opts.activate();
    },
  });
  const hoverBg = (key: string) =>
    opts.mouseEnabled() && hoveredKey() === key && !opts.inert?.(key) ? t().backgroundElement : undefined;
  return { mouseRow, hoverBg, clearHover: () => setHoveredKey(null) };
}

export type DetailRowMouse = ReturnType<typeof useDetailRowMouse>;

/**
 * The first row of a provider tab: `Load commit` / `Reload commit`, with muted status on the right while it works
 * (`fetching runs...`) or what it last saw (`live`). A disabled row is muted and left out of the cursor order.
 */
export function ProviderActionRow(
  props: Readonly<{
    label: string;
    status?: string;
    disabled: boolean;
    cursored: boolean;
    mouseEnabled?: boolean;
    rows: DetailRowMouse;
    rowKey: string;
    index: () => number;
    rowRef: (element: Renderable) => void;
  }>,
) {
  const t = useT();
  return (
    <box
      ref={props.rowRef}
      {...props.rows.mouseRow(props.rowKey, props.index)}
      flexDirection="row"
      width="100%"
      backgroundColor={props.cursored ? t().backgroundElementActive : props.rows.hoverBg(props.rowKey)}
    >
      <text
        selectable={!props.mouseEnabled}
        flexGrow={1}
        fg={props.disabled ? t().foregroundMuted : props.cursored ? t().accent : t().foreground}
        wrapMode="none"
      >
        {props.label}
      </text>
      <Show when={props.status}>
        <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
          {props.status}
        </text>
      </Show>
    </box>
  );
}

/** The muted `total …  N` line under the action row; hidden until the commit's data is known (unknown ≠ zero). */
export function ProviderSummaryRow(props: Readonly<{ label: string; count: number }>) {
  const t = useT();
  return (
    <box flexDirection="row" width="100%">
      <box flexGrow={1}>
        <text fg={t().foregroundMuted} wrapMode="none">
          {props.label}
        </text>
      </box>
      <box flexShrink={0} width={2} />
      <text fg={t().foregroundMuted} wrapMode="none">
        {props.count}
      </text>
    </box>
  );
}

/**
 * A row label that banner-scrolls while its row is cursored and the text does not fit, like Info fields and Snyk
 * dependencies; otherwise it ends in `…` when cut. `grow: false` keeps it at its text width (for labels followed by a tag).
 */
/** A tail narrower than this is left out: `  Cr…` says nothing. */
const MIN_TAIL_WIDTH = 8;

export function ScrollingLabel(
  props: Readonly<{
    text: string;
    active: boolean;
    fg: string;
    selectable?: boolean;
    grow?: boolean;
    /**
     * Extra text after the name in its own color (a failure reason, a count): cut first when space is short, so the
     * name keeps its room, and scrolled into view with the name on the selected row. Starts with its own separator.
     */
    tail?: string;
    tailFg?: string;
  }>,
) {
  const [width, setWidth] = createSignal(0);
  const tail = () => props.tail ?? "";
  const full = () => props.text + tail();
  // Measured in terminal columns, so wide (CJK) characters and emoji scroll and cut correctly.
  const overflow = () => (props.active && width() > 0 ? Math.max(0, cellWidth(full()) - width()) : 0);
  const offset = useBannerScroll(overflow);
  /** The visible name and tail. A tail is dropped rather than shown as a stub of a few columns. */
  const parts = (): [string, string] => {
    const w = width();
    if (w <= 0) return [props.text, tail()];
    const nameWidth = cellWidth(props.text);
    if (overflow() > 0) {
      const start = offset();
      const head = start < nameWidth ? sliceCells(props.text, start, Math.min(w, nameWidth - start)) : "";
      return [head, sliceCells(tail(), Math.max(0, start - nameWidth), w - cellWidth(head))];
    }
    if (nameWidth >= w) return [truncateCells(props.text, w), ""];
    const room = w - nameWidth;
    return [props.text, room >= MIN_TAIL_WIDTH || cellWidth(tail()) <= room ? truncateCells(tail(), room) : ""];
  };
  // The text is positioned absolutely so only the flex layout sizes the box: measuring a box that the text
  // itself stretches would feed back into the visible width.
  return (
    // `grow={false}` keeps the label at its text's width so something can follow it: it grows (strongly, so a spacer
    // after it only gets what the label leaves) up to that width. A plain flexShrink does not shrink it in opentui.
    <box
      flexGrow={props.grow === false ? 1000 : 1}
      flexShrink={1}
      flexBasis={0}
      maxWidth={props.grow === false ? cellWidth(full()) : undefined}
      minWidth={0}
      height={1}
      overflow="hidden"
      onSizeChange={function (this: BoxRenderable) {
        setWidth(this.width);
      }}
    >
      <text
        position="absolute"
        left={0}
        top={0}
        width={Math.max(1, width())}
        selectable={props.selectable}
        wrapMode="none"
        fg={props.fg}
      >
        {parts()[0]}
        <Show when={parts()[1]}>{visible => <span style={{ fg: props.tailFg ?? props.fg }}>{visible()}</span>}</Show>
      </text>
    </box>
  );
}
