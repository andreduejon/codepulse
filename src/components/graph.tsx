import type { Renderable, ScrollBoxRenderable, StyledText, TextRenderable } from "@opentui/core";
import { createEffect, createMemo, createSelector, createSignal, For, Show } from "solid-js";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH, HASH_COL_WIDTH } from "../constants";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import {
  buildEdgeIndicator,
  computeSingleViewportOffset,
  type GraphChar,
  getColorForColumn,
  graphCharsToContent,
  MAX_GRAPH_COLUMNS,
  renderConnectorRow,
  renderFanOutRow,
  renderGraphRow,
  sliceGraphToViewport,
} from "../git/graph";
import type { GraphRow, RefInfo } from "../git/types";
import { formatRelativeDate } from "../utils/date";

function RefBadge(
  props: Readonly<{
    info: RefInfo;
    laneColor: () => string;
  }>,
) {
  const { theme } = useTheme();
  const t = () => theme();

  const _isStash = () => props.info.type === "stash";
  const isDimmed = () => props.info.type === "stash" || props.info.type === "uncommitted";

  const bgColor = () => (isDimmed() ? t().backgroundElementActive : props.laneColor());

  // Dimmed badges (stash, uncommitted) use normal foreground on muted background;
  // regular badges use dark background color for contrast against bright lane colors.
  const fgColor = () => (isDimmed() ? t().foreground : t().background);

  return (
    <text flexShrink={0} wrapMode="none" fg={fgColor()} bg={bgColor()}>
      {` ${props.info.name} `}
    </text>
  );
}

/** Shared graph dimension computations used by ColumnHeader and GraphLine. */
function useGraphDimensions(maxGraphColumns: () => number) {
  const effectiveGraphColumns = () => Math.min(maxGraphColumns(), MAX_GRAPH_COLUMNS);
  const viewportActive = () => maxGraphColumns() > MAX_GRAPH_COLUMNS;
  const graphWidth = () => Math.max(effectiveGraphColumns() * 2 + 1 + (viewportActive() ? 2 : 0), 6);
  return { effectiveGraphColumns, viewportActive, graphWidth };
}

export function ColumnHeader() {
  const { theme } = useTheme();
  const { state } = useAppState();
  const t = () => theme();

  const { graphWidth } = useGraphDimensions(() => state.maxGraphColumns());

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      <box
        flexDirection="row"
        width="100%"
        border={["top"]}
        borderStyle="single"
        borderColor={state.detailFocused() ? t().border : t().accent}
      >
        {/* Graph header */}
        <text flexShrink={0} width={graphWidth()} wrapMode="none" paddingLeft={1}>
          <strong>
            <span fg={!state.detailFocused() ? t().foreground : t().foregroundMuted}>{"Graph "}</span>
          </strong>
        </text>

        {/* Commit hash */}
        <box flexShrink={0} width={HASH_COL_WIDTH} paddingLeft={1}>
          <text wrapMode="none" truncate>
            <strong>
              <span fg={!state.detailFocused() ? t().foreground : t().foregroundMuted}>Commit</span>
            </strong>
          </text>
        </box>

        {/* Description (commit message + refs) — box wrapper matches data row structure */}
        <box flexDirection="row" flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={2}>
          <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
            <strong>
              <span fg={!state.detailFocused() ? t().foreground : t().foregroundMuted}>Description</span>
            </strong>
          </text>
        </box>

        {/* Author */}
        <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2}>
          <text wrapMode="none" truncate>
            <strong>
              <span fg={!state.detailFocused() ? t().foreground : t().foregroundMuted}>Author</span>
            </strong>
          </text>
        </box>

        {/* Date */}
        <box flexShrink={0} width={DATE_COL_WIDTH}>
          <text wrapMode="none" truncate>
            <strong>
              <span fg={!state.detailFocused() ? t().foreground : t().foregroundMuted}>Date</span>
            </strong>
          </text>
        </box>
      </box>
      {/* Muted separator below headers */}
      <box width="100%" border={["top"]} borderStyle="single" borderColor={t().border} />
    </box>
  );
}

/**
 * Connector row component. Uses its own ref + createEffect to ensure
 * the StyledText content is set after the element is mounted.
 */
function ConnectorRow(props: Readonly<{ content: () => StyledText; width?: number }>) {
  let textRef: TextRenderable | undefined;

  createEffect(() => {
    if (textRef) textRef.content = props.content();
  });

  return (
    <box flexDirection="row" width="100%">
      <text ref={textRef} flexShrink={0} wrapMode="none" truncate paddingLeft={1} width={props.width} />
    </box>
  );
}

function GraphLine(
  props: Readonly<{
    row: GraphRow;
    index: number;
    active: boolean;
    isLast: boolean;
    viewportOffset: () => number;
    rowRef?: (el: Renderable) => void;
  }>,
) {
  const { theme } = useTheme();
  const { state } = useAppState();

  const commit = () => props.row.commit;
  const padCols = () => state.maxGraphColumns();

  const { viewportActive, graphWidth } = useGraphDimensions(() => state.maxGraphColumns());

  const renderOpts = () => {
    return {
      themeColors: theme().graphColors,
      padToColumns: padCols(),
      padColor: theme().foregroundMuted,
    };
  };

  // Uncommitted-changes node renders in dimmed/muted style.
  // IMPORTANT: Must be defined BEFORE fullGraphChars (createMemo evaluates eagerly).
  const isUncommitted = () => commit().refs.some(r => r.type === "uncommitted");

  // Edge indicator helper — single 2-char column appended to the right
  const edgeColor = () => theme().foregroundMuted;
  const blankEdge = (): GraphChar => ({ char: "  ", color: edgeColor() });

  // Append edge indicator column to the right of the graph chars.
  // Uses push on a shallow copy to avoid the spread operator's overhead
  // of iterating the entire source array through the iterator protocol.
  const withEdgeIndicator = (chars: GraphChar[], isCommitRow: boolean): GraphChar[] => {
    if (!viewportActive()) return chars;
    const out = chars.slice();
    if (isCommitRow) {
      out.push(
        buildEdgeIndicator(
          props.row.nodeColumn,
          props.viewportOffset(),
          MAX_GRAPH_COLUMNS,
          state.maxGraphColumns(),
          edgeColor(),
          true,
        ),
      );
    } else {
      out.push(blankEdge());
    }
    return out;
  };

  // --- Performance optimization: split full-width render (expensive) from
  // viewport slicing (cheap). When only viewportOffset changes, the memoized
  // full-width renders are reused and only the cheap slice re-runs. ---

  // Dim ALL graph chars for the uncommitted-changes row — including the █ node —
  // so the entire row visually recedes. Uses foregroundMuted for a uniformly muted look.
  const dimChars = (chars: GraphChar[]): GraphChar[] => {
    if (!isUncommitted()) return chars;
    const mutedColor = theme().foregroundMuted;
    for (const c of chars) {
      c.color = mutedColor;
      c.bold = false;
    }
    return chars;
  };

  // Full-width renders — memoized, depend on row data + renderOpts, NOT viewportOffset
  const fullGraphChars = createMemo(() => dimChars(renderGraphRow(props.row, renderOpts())));
  const fullConnectorChars = createMemo(() => dimChars(renderConnectorRow(props.row, renderOpts())));

  // Viewport-sliced renders — depend on memoized full-width + viewportOffset (cheap)
  const graphChars = () => {
    const chars = fullGraphChars();
    if (!viewportActive()) return chars;
    return sliceGraphToViewport(chars, props.viewportOffset(), MAX_GRAPH_COLUMNS, props.row, renderOpts());
  };
  const connectorChars = () => {
    const chars = fullConnectorChars();
    if (!viewportActive()) return chars;
    return sliceGraphToViewport(chars, props.viewportOffset(), MAX_GRAPH_COLUMNS, props.row, renderOpts());
  };

  const graphContent = () => graphCharsToContent(withEdgeIndicator(graphChars(), true));
  const connectorContent = () => graphCharsToContent(withEdgeIndicator(connectorChars(), false));

  // Check if the commit row has merge/branch connectors (horizontals, corners, tees).
  // If so, the commit row carries connection info and can't be replaced by a fan-out row.
  const commitRowHasConnections = () =>
    props.row.connectors.some(
      c =>
        c.type === "horizontal" ||
        c.type === "tee-left" ||
        c.type === "tee-right" ||
        c.type === "corner-top-right" ||
        c.type === "corner-top-left" ||
        c.type === "corner-bottom-right" ||
        c.type === "corner-bottom-left",
    );

  // Fan-out rows: extra connector rows showing branch-off corners.
  // When fan-out rows exist AND the commit row is "simple" (no merge/branch
  // connectors), the LAST fan-out row is used as the commit row's graph
  // (since its █ at the node column would be adjacent to a redundant commit █).
  // When the commit row HAS connections (e.g., a merge), all fan-out rows
  // render separately and the commit row keeps its own graph.
  const canMergeFanOut = () => {
    const foRows = props.row.fanOutRows;
    return foRows && foRows.length > 0 && !commitRowHasConnections();
  };

  // Full-width fan-out renders — memoized, NOT dependent on viewportOffset.
  // When the commit is the uncommitted-changes node, dim all fan-out chars.
  const fullFanOutChars = createMemo(() => {
    const foRows = props.row.fanOutRows;
    if (!foRows || foRows.length === 0) return [];
    const dimAll = isUncommitted();
    return foRows.map(foConnectors => {
      const chars = renderFanOutRow(foConnectors, renderOpts(), props.row.nodeColumn);
      if (dimAll) {
        const mutedColor = theme().foregroundMuted;
        for (const c of chars) {
          c.color = mutedColor;
          c.bold = false;
        }
      }
      return chars;
    });
  });

  // Fan-out rows ABOVE the commit row
  const fanOutAboveContents = () => {
    const allFanOut = fullFanOutChars();
    if (allFanOut.length === 0) return [];
    const active = viewportActive();
    const applySlice = (chars: GraphChar[]) =>
      active ? sliceGraphToViewport(chars, props.viewportOffset(), MAX_GRAPH_COLUMNS, props.row, renderOpts()) : chars;
    // If merging last fan-out into commit row, show all except the last
    if (canMergeFanOut()) {
      if (allFanOut.length <= 1) return [];
      return allFanOut.slice(0, -1).map(chars => graphCharsToContent(withEdgeIndicator(applySlice(chars), false)));
    }
    // Otherwise show all fan-out rows separately
    return allFanOut.map(chars => graphCharsToContent(withEdgeIndicator(applySlice(chars), false)));
  };

  // The commit row graph: if we can merge, use the last fan-out row's graph;
  // otherwise use the normal commit row graph.
  const commitRowGraphContent = () => {
    if (canMergeFanOut()) {
      const allFanOut = fullFanOutChars();
      const chars = allFanOut.at(-1);
      const sliced = viewportActive()
        ? sliceGraphToViewport(chars, props.viewportOffset(), MAX_GRAPH_COLUMNS, props.row, renderOpts())
        : chars;
      // Merged fan-out row IS the commit row — use isCommitRow=true for edge indicators
      return graphCharsToContent(withEdgeIndicator(sliced, true));
    }
    // graphContent() already has viewport slicing and edge indicators applied
    return graphContent();
  };

  // Use refs to set StyledText content directly on TextRenderable,
  // bypassing the Solid reconciler which stringifies the content prop.
  let graphTextRef: TextRenderable | undefined;

  createEffect(() => {
    if (graphTextRef) graphTextRef.content = commitRowGraphContent();
  });

  // Ref sort order: tag=0, branch=1, remote=2, head=3 (hoisted to module scope)
  const visibleRefs = createMemo(() => {
    const allRefs = commit().refs;
    return [...allRefs].sort((a, b) => (REF_SORT_ORDER[a.type] ?? 9) - (REF_SORT_ORDER[b.type] ?? 9));
  });
  const laneColor = () => getColorForColumn(props.row.nodeColor, theme().graphColors);
  const t = () => theme();

  // Effective text color for the commit subject (primary column).
  // Active row uses accent color with bold. Inactive rows use foreground.
  // Uncommitted-changes row always uses muted color.
  const effectiveTextColor = () => {
    if (isUncommitted()) return t().foregroundMuted;
    if (props.active) return t().accent;
    return t().foreground;
  };

  // Secondary column color (author, date, hash).
  // Active → accent (bold applied separately). Otherwise, muted.
  // Uncommitted-changes row always uses muted.
  const secondaryColumnColor = () => {
    if (isUncommitted()) return t().foregroundMuted;
    if (props.active) return t().accent;
    return t().foregroundMuted;
  };

  return (
    <box
      ref={(el: Renderable) => props.rowRef?.(el)}
      flexDirection="column"
      width="100%"
      backgroundColor={props.active ? t().backgroundElement : undefined}
    >
      {/* Fan-out rows above the commit (all except the last, which merges
          into the commit row to avoid a redundant █ block). */}
      <For each={fanOutAboveContents()}>
        {foContent => <ConnectorRow content={() => foContent} width={graphWidth()} />}
      </For>

      {/* Commit row */}
      <box flexDirection="row" width="100%">
        {/* Graph part: styled via ref + StyledText to bypass reconciler stringification */}
        <text ref={graphTextRef} flexShrink={0} width={graphWidth()} wrapMode="none" truncate paddingLeft={1} />

        {/* Short hash */}
        <box flexShrink={0} width={HASH_COL_WIDTH} paddingLeft={1} overflow="hidden">
          <text fg={secondaryColumnColor()} wrapMode="none" truncate>
            {props.active ? (
              <strong>
                <span fg={secondaryColumnColor()}>{commit().shortHash}</span>
              </strong>
            ) : (
              commit().shortHash
            )}
          </text>
        </box>

        {/* Description: refs + commit message share one flex area */}
        <box flexDirection="row" flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={2}>
          <Show when={visibleRefs().length > 0}>
            <box flexDirection="row" flexShrink={0} gap={1} paddingRight={1}>
              <For each={visibleRefs()}>{ri => <RefBadge info={ri} laneColor={laneColor} />}</For>
            </box>
          </Show>
          <text flexGrow={1} flexShrink={1} fg={effectiveTextColor()} wrapMode="none" truncate>
            {(() => {
              const v = isUncommitted() ? "Staged and unstaged changes in working tree" : commit().subject;
              return props.active ? (
                <strong>
                  <span fg={effectiveTextColor()}>{v}</span>
                </strong>
              ) : (
                v
              );
            })()}
          </text>
        </box>

        {/* Author */}
        <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2} overflow="hidden">
          <text fg={secondaryColumnColor()} wrapMode="none" truncate>
            {(() => {
              const v = isUncommitted() ? "\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7" : commit().author;
              return props.active ? (
                <strong>
                  <span fg={secondaryColumnColor()}>{v}</span>
                </strong>
              ) : (
                v
              );
            })()}
          </text>
        </box>

        {/* Date */}
        <box flexShrink={0} width={DATE_COL_WIDTH} overflow="hidden">
          <text fg={secondaryColumnColor()} wrapMode="none" truncate>
            {(() => {
              const v = isUncommitted()
                ? "\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7"
                : formatRelativeDate(commit().authorDate);
              return props.active ? (
                <strong>
                  <span fg={secondaryColumnColor()}>{v}</span>
                </strong>
              ) : (
                v
              );
            })()}
          </text>
        </box>
      </box>

      {/* Connector row: vertical lines only, providing visual continuity */}
      <Show when={!props.isLast}>
        <ConnectorRow content={connectorContent} width={graphWidth()} />
      </Show>
    </box>
  );
}

/** Sort order for ref badges: tags first, then branches, remotes, HEAD last. */
const REF_SORT_ORDER: Record<string, number> = { tag: 0, branch: 1, remote: 2, stash: 3, uncommitted: 4, head: 5 };

export default function GraphView() {
  const { state } = useAppState();

  // Single viewport offset: reacts to the highlighted commit's node column.
  // All rows share the same offset, giving a horizontal "scroll" effect.
  const [viewportOffset, setViewportOffset] = createSignal(0);

  // Refs for programmatic scroll-into-view
  let scrollboxRef: ScrollBoxRenderable | undefined;
  const rowRefs: Renderable[] = [];

  // Clean up stale rowRefs when filtered row count changes
  createEffect(() => {
    rowRefs.length = state.filteredRows().length;
  });

  createEffect(() => {
    const rows = state.filteredRows();
    const idx = state.cursorIndex();
    const maxCols = state.maxGraphColumns();

    if (maxCols <= MAX_GRAPH_COLUMNS || idx < 0 || idx >= rows.length) {
      setViewportOffset(0);
      return;
    }

    const nodeCol = rows[idx].nodeColumn;
    setViewportOffset(prev => computeSingleViewportOffset(prev, nodeCol, MAX_GRAPH_COLUMNS, maxCols));
  });

  // Scroll the target row into view (only triggered by keyboard nav / selection, not mouse hover)
  createEffect(() => {
    const idx = state.scrollTargetIndex();
    const sb = scrollboxRef;
    if (!sb || idx < 0) return;

    const rowEl = rowRefs[idx];
    if (!rowEl) return;

    // Get the row's position within the scrollbox content
    const layout = rowEl.getLayoutNode().getComputedLayout();
    const rowTop = layout.top;
    const rowHeight = layout.height;
    const rowBottom = rowTop + rowHeight;

    const viewportHeight = sb.viewport.height;
    const currentScroll = sb.scrollTop;
    const visibleTop = currentScroll;
    const visibleBottom = currentScroll + viewportHeight;

    const padding = 1; // keep at least 1 row of context visible above/below

    if (rowTop < visibleTop + padding) {
      sb.scrollTo(Math.max(0, rowTop - padding));
    } else if (rowBottom > visibleBottom - padding) {
      sb.scrollTo(rowBottom - viewportHeight + padding);
    }
  });

  // createSelector tracks which index is "selected" and only notifies the
  // previous and current rows when the cursor moves, reducing reactive
  // re-evaluations from N (every row) down to exactly 2.
  const isActive = createSelector(() => state.cursorIndex());

  return (
    <scrollbox ref={scrollboxRef} flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
      <box flexDirection="column" flexGrow={1}>
        <Show when={!state.loading()}>
          <For each={state.filteredRows()}>
            {(row, index) => (
              <GraphLine
                row={row}
                index={index()}
                active={isActive(index())}
                isLast={index() === state.filteredRows().length - 1}
                viewportOffset={viewportOffset}
                rowRef={el => {
                  rowRefs[index()] = el;
                }}
              />
            )}
          </For>
        </Show>
      </box>
    </scrollbox>
  );
}
