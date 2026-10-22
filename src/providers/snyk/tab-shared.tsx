import { MouseButton, type MouseEvent, type Renderable } from "@opentui/core";
import { createSignal, For, Show } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import type { SnykScanResult, SnykSeverity } from "./types";
import type { SnykViewMemory } from "./view-memory";

export interface SnykDetailTabProps {
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  scan: SnykScanResult | null;
  onScan: () => void | Promise<void>;
  contentWidth?: number;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  /** Vulnerabilities: a filter handed over by the Dependencies jump, read once when the tab opens. */
  takePendingFilter?: () => string | null;
  /** Survives tab switches; each tab restores its state from it for the same scan. */
  memory?: SnykViewMemory;
  /** False once another tab is selected, so its cursor reset is not recorded. */
  active?: () => boolean;
}

/** `sha:scannedAt`: a rescan of the same commit is another scan. */
export const snykScanIdentity = (scan: SnykScanResult | null) => (scan ? `${scan.sha}:${scan.scannedAt}` : "");

export function severityColor(theme: Theme, severity: SnykSeverity): string {
  switch (severity) {
    case "critical":
      return theme.severityCritical;
    case "high":
      return theme.severityHigh;
    case "medium":
      return theme.severityMedium;
    case "low":
      return theme.severityLow;
  }
}

/** Coloured markers (space-separated), then a muted label. */
export type SnykLegendItem = [markers: [string, (theme: Theme) => string][], label: string];

/** Tab legend; DetailPanel renders it sticky below the scroll area. */
export function SnykLegend(props: { items: readonly SnykLegendItem[] }) {
  const t = useT();
  return (
    <box flexDirection="row" width="100%" flexShrink={0} justifyContent="flex-end">
      <For each={props.items}>
        {([markers, label], index) => (
          <>
            <Show when={index() > 0}>
              <text selectable={false} flexShrink={0} wrapMode="none">
                {"  "}
              </text>
            </Show>
            <For each={markers}>
              {([marker, color]) => (
                <text selectable={false} flexShrink={0} wrapMode="none" fg={color(t())}>
                  {`${marker} `}
                </text>
              )}
            </For>
            <text selectable={false} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {label}
            </text>
          </>
        )}
      </For>
    </box>
  );
}

/**
 * Cursor, hover and left-click handling shared by the rows of both tabs. A click selects the row and activates it;
 * rows outside the cursor order (index < 0) are inert and never highlighted, and Scan ignores clicks while loading.
 */
export function useSnykRows(props: Readonly<SnykDetailTabProps>, activate: () => unknown) {
  const t = useT();
  const [hoveredKey, setHoveredKey] = createSignal<string | null>(null);
  const cursored = (index: number) => index >= 0 && props.detailFocused() && props.detailCursorIndex() === index;
  const mouseRow = (key: string, index: () => number) => ({
    onMouseOver: () => setHoveredKey(key),
    onMouseOut: () => setHoveredKey(null),
    onMouseDown: (event: MouseEvent) => {
      if (!props.mouseEnabled || event.button !== MouseButton.LEFT || index() < 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "scan" && props.loading) return;
      props.onMouseFocus?.();
      props.setDetailCursorIndex(index());
      activate();
    },
  });
  const background = (key: string, index: number) =>
    cursored(index)
      ? t().backgroundElementActive
      : index >= 0 && props.mouseEnabled && hoveredKey() === key && (key !== "scan" || !props.loading)
        ? t().backgroundElement
        : undefined;
  return { cursored, mouseRow, background, clearHover: () => setHoveredKey(null) };
}

export type SnykRows = ReturnType<typeof useSnykRows>;

/** One-line control: Scan/Rescan, Copy as JSON, or a `[value]` switch such as Group by. */
export function SnykControlRow(props: {
  rows: SnykRows;
  id: string;
  index: number;
  label: string;
  /** Switches: the current option, shown as `[value]`. */
  value?: string;
  /** Muted status after the label, e.g. `scanning...`. */
  status?: string;
  copied?: boolean;
  mouseEnabled?: boolean;
  rowRef: (element: Renderable) => void;
}) {
  const t = useT();
  return (
    <box
      {...props.rows.mouseRow(props.id, () => props.index)}
      ref={props.rowRef}
      flexDirection="row"
      width="100%"
      backgroundColor={props.rows.background(props.id, props.index)}
    >
      <text
        selectable={!props.mouseEnabled}
        flexGrow={1}
        flexShrink={1}
        fg={props.rows.cursored(props.index) ? t().accent : t().foreground}
        wrapMode="none"
        truncate
      >
        {props.label}
      </text>
      <Show when={props.status}>
        <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
          {props.status}
        </text>
      </Show>
      <Show when={props.value !== undefined}>
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foreground}>
          {`[${props.value}]`}
        </text>
      </Show>
      <Show when={props.copied}>
        <text selectable={!props.mouseEnabled} flexShrink={0} bg={t().primary} fg={t().background} wrapMode="none">
          {" ✓ copied "}
        </text>
      </Show>
    </box>
  );
}
