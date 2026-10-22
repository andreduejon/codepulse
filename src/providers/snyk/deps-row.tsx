import type { Renderable } from "@opentui/core";
import { type JSX, Show } from "solid-js";
import { useT } from "../../hooks/use-t";
import type { DependencyTreeRow } from "./deps-tree";
import { type SnykRows, severityColor } from "./tab-shared";

/** Headers without anything to open (no matches, failed/skipped) are not cursor stops, like empty severities. */
export const isEmptyHeader = (row: DependencyTreeRow) => row.kind !== "dependency" && !row.expandable;

/** Right-aligned muted markers; nesting and these words replace arrow markers that read like errors. */
const markers = (row: DependencyTreeRow) =>
  [row.direct ? "direct" : "", row.reference ? "repeated" : "", row.cycle ? "circular" : ""]
    .filter(Boolean)
    .map(word => ` ${word}`)
    .join("");
const matchesText = (row: DependencyTreeRow) => (row.matches === undefined ? "" : ` ${row.matches}`);
/** Leaves have no arrow: one space after the connector, like Vulnerabilities' detail rows. */
const markerWidth = (row: DependencyTreeRow) => (row.kind === "dependency" && !row.expandable ? 0 : 2);

/** Sibling groups (same parent) with any triangle reserve its column on every row, so `dev`/`repeated` line up. */
export const parentKey = (row: DependencyTreeRow) => row.key.slice(0, row.key.lastIndexOf("/"));

/** Layout of one row: `gap` reserves the triangle column for a row without one. */
export interface DependencyRowLayout {
  width: number;
  gap: boolean;
}

const suffixWidth = (row: DependencyTreeRow, layout: DependencyRowLayout) =>
  markers(row).length +
  (row.scope === "dev" ? 4 : 0) +
  matchesText(row).length +
  (row.vulnerability || layout.gap ? 2 : 0);

/** Connector, cut from the left so deep rows keep room for their label. */
export function dependencyRowPrefix(row: DependencyTreeRow, layout: DependencyRowLayout): string {
  const budget = Math.max(0, layout.width - 1 - suffixWidth(row, layout));
  const connector = row.prefix.slice(Math.max(0, row.prefix.length - Math.max(0, budget - 11)));
  return connector.slice(0, Math.max(0, budget - 2));
}

/** Columns left for the label; the cursor row banner-scrolls its full name within them. */
export function dependencyLabelWidth(row: DependencyTreeRow, layout: DependencyRowLayout): number {
  return Math.max(
    1,
    layout.width - dependencyRowPrefix(row, layout).length - markerWidth(row) - suffixWidth(row, layout),
  );
}

export function DependencyRow(props: {
  row: DependencyTreeRow;
  /** Cursor position; -1 for headers that are not cursor stops. */
  index: () => number;
  rows: SnykRows;
  layout: DependencyRowLayout;
  /** The label as shown: bold header, highlighted name, or the scrolled full name on the cursor. */
  label: JSX.Element;
  copied: boolean;
  filtering: boolean;
  mouseEnabled?: boolean;
  rowRef: (element: Renderable) => void;
}) {
  const t = useT();
  const row = props.row;
  const header = row.kind !== "dependency";
  const empty = isEmptyHeader(row);
  const cursored = () => props.rows.cursored(props.index());
  const prefix = () => dependencyRowPrefix(row, props.layout);
  const muted = (text: string) => (
    <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().foregroundMuted} wrapMode="none">
      {text}
    </text>
  );
  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      <box
        {...(empty ? {} : props.rows.mouseRow(row.key, props.index))}
        ref={(element: Renderable) => {
          if (!empty) props.rowRef(element);
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={empty ? undefined : props.rows.background(row.key, props.index())}
      >
        {/* Empty text still takes a column; headers have no connector. */}
        <Show when={prefix()}>
          <text selectable={!props.mouseEnabled} flexShrink={0} fg={t().border} wrapMode="none">
            {prefix()}
          </text>
        </Show>
        <Show when={markerWidth(row) > 0}>
          <text
            selectable={!props.mouseEnabled}
            flexShrink={0}
            fg={cursored() ? t().accent : t().foregroundMuted}
            wrapMode="none"
          >
            {row.expandable ? (row.expanded ? "▾ " : "▸ ") : "· "}
          </text>
        </Show>
        <text
          selectable={!props.mouseEnabled}
          flexGrow={1}
          flexShrink={1}
          fg={cursored() ? t().accent : empty ? t().foregroundMuted : t().foreground}
          wrapMode="none"
          truncate
        >
          {props.label}
        </text>
        <Show when={markers(row)}>{muted(markers(row))}</Show>
        <Show when={row.scope === "dev"}>{muted(" dev")}</Show>
        {/* Closed rows while filtering: matches below, like header counts. */}
        <Show when={matchesText(row)}>{muted(matchesText(row))}</Show>
        <Show when={props.layout.gap}>
          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none">
            {"  "}
          </text>
        </Show>
        {/* Vulnerable package: a triangle in its worst severity colour; `v` opens its findings. */}
        <Show when={row.vulnerability}>
          {severity => (
            <text selectable={!props.mouseEnabled} flexShrink={0} fg={severityColor(t(), severity())} wrapMode="none">
              {" ▲"}
            </text>
          )}
        </Show>
        <Show when={props.copied}>
          <text selectable={!props.mouseEnabled} flexShrink={0} bg={t().primary} fg={t().background} wrapMode="none">
            {" ✓ copied "}
          </text>
        </Show>
        {/* Headers count packages like severity headers count findings: N, or N/M while filtering. */}
        <Show when={header && row.total !== undefined}>
          {muted(` ${row.count ?? 0}${props.filtering && (row.total ?? 0) > 0 ? `/${row.total}` : ""}`)}
        </Show>
      </box>
    </box>
  );
}
