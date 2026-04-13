import type { Renderable, ScrollBoxRenderable, StyledText, TextRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSelector, createSignal, For, onCleanup, Show } from "solid-js";
import {
  AUTHOR_COL_WIDTH,
  COMPACT_THRESHOLD_WIDTH,
  DATE_COL_WIDTH,
  DETAIL_PANEL_WIDTH_FRACTION,
  HASH_COL_WIDTH,
  UNCOMMITTED_PLACEHOLDER,
} from "../constants";
import { useAppState } from "../context/state";
import {
  buildEdgeIndicator,
  computeBrightColumns,
  computeSingleViewportOffset,
  dimGraphChars,
  type GraphChar,
  getColorForColumn,
  graphCharsToContent,
  MAX_GRAPH_COLUMNS,
  renderConnectorRow,
  renderFanOutRow,
  renderGapRow,
  renderGraphRow,
  sliceGraphToViewport,
} from "../git/graph";
import type { GraphRow, RefInfo } from "../git/types";
import { useBannerScroll } from "../hooks/use-banner-scroll";
import { useT } from "../hooks/use-t";
import { formatRelativeDate } from "../utils/date";
import { scrollElementIntoView } from "../utils/scroll";

function RefBadge(
  props: Readonly<{
    info: RefInfo;
    laneColor: () => string;
    ancestryDimmed: () => boolean;
  }>,
) {
  const t = useT();

  const isDimmed = () => props.info.type === "stash" || props.info.type === "uncommitted" || props.ancestryDimmed();

  const bgColor = () => (isDimmed() ? t().backgroundElementActive : props.laneColor());

  // Dimmed badges (stash, uncommitted, non-ancestry) use muted foreground on muted background;
  // regular badges use dark background color for contrast against bright lane colors.
  const fgColor = () => (isDimmed() ? t().foregroundMuted : t().background);

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
  const t = useT();
  const { state } = useAppState();
  const leftPanelFocused = () => !state.detailFocused();

  const { graphWidth } = useGraphDimensions(() => state.maxGraphColumns());

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      <box
        flexDirection="row"
        width="100%"
        border={["top"]}
        borderStyle="single"
        borderColor={leftPanelFocused() ? t().accent : t().foregroundMuted}
      >
        {/* Graph header */}
        <text
          flexShrink={0}
          width={graphWidth()}
          wrapMode="none"
          paddingLeft={1}
          fg={leftPanelFocused() ? t().accent : t().foregroundMuted}
        >
          <strong>{"Graph "}</strong>
        </text>

        {/* Commit hash */}
        <box flexShrink={0} width={HASH_COL_WIDTH} paddingLeft={1}>
          <text wrapMode="none" truncate fg={leftPanelFocused() ? t().accent : t().foregroundMuted}>
            <strong>Commit</strong>
          </text>
        </box>

        {/* Description (commit message + refs) — box wrapper matches data row structure */}
        <box flexDirection="row" flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={2}>
          <text
            flexGrow={1}
            flexShrink={1}
            wrapMode="none"
            truncate
            fg={leftPanelFocused() ? t().accent : t().foregroundMuted}
          >
            <strong>Description</strong>
          </text>
        </box>

        {/* Author */}
        <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2}>
          <text wrapMode="none" truncate fg={leftPanelFocused() ? t().accent : t().foregroundMuted}>
            <strong>Author</strong>
          </text>
        </box>

        {/* Date */}
        <box flexShrink={0} width={DATE_COL_WIDTH}>
          <text wrapMode="none" truncate fg={leftPanelFocused() ? t().accent : t().foregroundMuted}>
            <strong>Date</strong>
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
    showGapBelow: boolean;
    viewportOffset: () => number;
    rowRef?: (el: Renderable) => void;
    /** Whether ancestry highlighting is currently active (any commit selected).
     *  Derived from brightColumnsByHash in the parent — avoids a second signal read. */
    ancestryActive: () => boolean;
    /** Whether this specific row should be dimmed by ancestry highlighting.
     *  True when ancestry is active AND this row is NOT in the first-parent chain. */
    isDimmedByAncestry: () => boolean;
    /** Set of column indices that should stay bright on this row (passthrough ancestry
     *  lanes). Undefined = ancestry inactive or this row has no passthrough lanes. */
    brightColumns: () => Set<number> | undefined;
    /** Per-fan-out-row horizontal bright columns. Map from fan-out row index to the set
     *  of column indices where ─, corners, and tees should stay bright. Only the specific
     *  fan-out row connecting an ancestry child to this parent gets brightened. */
    brightFanOutHorizontals: () => Map<number, Set<number>> | undefined;
    /** Extra vertical-bright columns that apply only to fan-out rows (not commit or
     *  connector rows). Used when the ancestry child's column passes through the
     *  parent's fan-out row as a ┼ crossing. */
    brightFanOutVerticals: () => Set<number> | undefined;
    /** Set of column indices where horizontal glyphs on the commit row itself should
     *  stay bright (ancestry connection via commit-row merge arms, not fan-out rows). */
    brightCommitHorizontals: () => Set<number> | undefined;
  }>,
) {
  const t = useT();
  const { state } = useAppState();
  const dimensions = useTerminalDimensions();

  const commit = () => props.row.commit;
  const padCols = () => state.maxGraphColumns();

  const { viewportActive, graphWidth } = useGraphDimensions(() => state.maxGraphColumns());

  const renderOpts = () => {
    return {
      themeColors: t().graphColors,
      padToColumns: padCols(),
      padColor: t().foregroundMuted,
    };
  };

  // Uncommitted-changes node renders in dimmed/muted style.
  // IMPORTANT: Must be defined BEFORE fullGraphChars (createMemo evaluates eagerly).
  const isUncommitted = () => commit().refs.some(r => r.type === "uncommitted");

  // Edge indicator helper — single 2-char column appended to the right
  const edgeColor = () => t().foregroundMuted;
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

  // Node lane color — used for selective ancestry dimming (must be before dimChars).
  const laneColor = () => getColorForColumn(props.row.nodeColor, t().graphColors);

  /** Thin wrapper around the pure `dimGraphChars` function, binding reactive closure values. */
  const dimChars = (chars: GraphChar[], hBright?: Set<number>, extraVertical?: Set<number>): GraphChar[] => {
    let vBright = props.brightColumns();
    // Merge extra vertical-bright columns (fan-out rows only) into the set.
    if (extraVertical && extraVertical.size > 0) {
      const merged = new Set(vBright);
      for (const col of extraVertical) merged.add(col);
      vBright = merged;
    }
    return dimGraphChars(chars, t().foregroundMuted, {
      isUncommitted: isUncommitted(),
      ancestryActive: props.ancestryActive(),
      brightColumns: vBright,
      brightHorizontal: hBright,
    });
  };

  // Full-width renders — memoized, depend on row data + renderOpts, NOT viewportOffset.
  // Commit rows get horizontal brightening via brightCommitHorizontals (when the
  // ancestry connection uses the commit row's own merge connectors).
  // Connector rows use only vertical bright sets (no horizontal brightening).
  // Fan-out rows get per-row horizontal bright sets via the hBright parameter.
  const fullGraphChars = createMemo(() =>
    dimChars(renderGraphRow(props.row, renderOpts()), props.brightCommitHorizontals()),
  );
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
  const canMergeFanOut = (): boolean => {
    const foRows = props.row.fanOutRows;
    return !!foRows && foRows.length > 0 && !rowHasConnections(props.row);
  };

  // Full-width fan-out renders — memoized, NOT dependent on viewportOffset.
  // Each fan-out row gets its own horizontal bright set (if any) from
  // brightFanOutHorizontals — only the fan-out row connecting an ancestry child
  // to this parent's nodeColumn gets horizontal brightening.
  const fullFanOutChars = createMemo(() => {
    const foRows = props.row.fanOutRows;
    if (!foRows || foRows.length === 0) return [];
    const foHBrightMap = props.brightFanOutHorizontals();
    const foVBright = props.brightFanOutVerticals();
    return foRows.map((foConnectors, idx) =>
      dimChars(renderFanOutRow(foConnectors, renderOpts(), props.row.nodeColumn), foHBrightMap?.get(idx), foVBright),
    );
  });

  // Derive fan-out display: rows above the commit + the commit row's graph content.
  // applyViewport and addEdge are passed as callbacks to keep buildFanOutDisplay pure.
  const fanOutDisplay = () => {
    const applyViewport = (chars: GraphChar[]) =>
      viewportActive()
        ? sliceGraphToViewport(chars, props.viewportOffset(), MAX_GRAPH_COLUMNS, props.row, renderOpts())
        : chars;
    return buildFanOutDisplay(fullFanOutChars(), canMergeFanOut(), graphContent(), applyViewport, withEdgeIndicator);
  };

  const fanOutAboveContents = () => fanOutDisplay().fanOutAboveContents;
  const commitRowGraphContent = () => fanOutDisplay().commitRowGraphContent;

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

  // Effective text color for the commit subject (primary column).
  // Active row uses accent color with bold. Inactive rows use foreground.
  // Uncommitted-changes row always uses muted color.
  // Non-ancestor rows (when ancestry highlighting is active) use muted color.
  const effectiveTextColor = () => {
    if (isUncommitted() || props.isDimmedByAncestry()) return t().foregroundMuted;
    if (props.active) return t().accent;
    return t().foreground;
  };

  // Secondary column color (author, date, hash).
  // Active → accent (bold applied separately). Otherwise, muted.
  // Uncommitted-changes row always uses muted.
  // Non-ancestor rows (when ancestry highlighting is active) use muted.
  const secondaryColumnColor = () => {
    if (isUncommitted() || props.isDimmedByAncestry()) return t().foregroundMuted;
    if (props.active) return t().accent;
    return t().foregroundMuted;
  };

  // Gap content: dimmed ┊ in active lane columns, used as connector row
  // replacement when search filtered out intermediate commits between rows.
  const gapContent = () => {
    const chars = renderGapRow(props.row, renderOpts());
    const sliced = viewportActive()
      ? sliceGraphToViewport(chars, props.viewportOffset(), MAX_GRAPH_COLUMNS, props.row, renderOpts())
      : chars;
    return graphCharsToContent(withEdgeIndicator(sliced, false));
  };

  // --- Banner scroll for the active commit's subject text ---

  // Width of the ref badges area for this row (variable per row).
  // Each badge renders as " name " (name + 2 spaces), with a gap of 1 between badges
  // and 1 paddingRight after the badge box. Returns 0 when no refs are visible.
  const refBadgesWidth = createMemo(() => {
    const refs = visibleRefs();
    if (refs.length === 0) return 0;
    // sum of (name + 2) for each badge + (refs.length - 1) gaps + 1 paddingRight
    return refs.reduce((acc, r) => acc + r.name.length + 2, 0) + (refs.length - 1) + 1;
  });

  // Approximate available width for the subject text in the graph panel.
  // Graph panel takes the remaining width after the detail panel (normal mode)
  // or the full width minus outer padding (compact mode).
  // Fixed consumed columns: graphWidth + 1 (hash paddingLeft) + HASH_COL_WIDTH
  //   + 1 (desc box paddingLeft) + 2 (desc box paddingRight)
  //   + refBadgesWidth + AUTHOR_COL_WIDTH + 2 (author paddingRight) + DATE_COL_WIDTH
  //   + 4 (left panel paddingX=2 each side)
  const subjectAvailableWidth = createMemo(() => {
    const W = dimensions().width;
    // Detail panel box width = 25% of W (minWidth=60). Its paddingX=2 is internal,
    // so it does NOT reduce the left panel's allocated width.
    const detailPanelWidth =
      W >= COMPACT_THRESHOLD_WIDTH ? Math.max(Math.floor(W * DETAIL_PANEL_WIDTH_FRACTION), 60) : 0;
    const graphPanelWidth = W - detailPanelWidth - 4; // 4 = left panel paddingX=2 each side
    // Hash box: width=HASH_COL_WIDTH (internal paddingLeft NOT added separately — it's inside the fixed width).
    // Author box: width=AUTHOR_COL_WIDTH (internal paddingRight NOT added separately — same reason).
    // Date box: width=DATE_COL_WIDTH (no internal padding).
    // Desc box: paddingLeft=1 + paddingRight=2 are layout padding on a flex-grow box (no fixed width), so they DO consume space.
    const fixedCols =
      graphWidth() +
      HASH_COL_WIDTH + // hash box (width=9, internal paddingLeft is inside that 9)
      1 + // desc box paddingLeft
      2 + // desc box paddingRight
      refBadgesWidth() +
      AUTHOR_COL_WIDTH + // author box (width=15, internal paddingRight is inside that 15)
      DATE_COL_WIDTH; // date box (width=15)
    return Math.max(0, graphPanelWidth - fixedCols);
  });

  const subjectText = () => (isUncommitted() ? "Staged and unstaged changes in working tree" : commit().subject);

  const bannerOverflow = () => {
    if (!props.active) return 0;
    return Math.max(0, subjectText().length - subjectAvailableWidth());
  };
  const bannerOffset = useBannerScroll(bannerOverflow);

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
              <For each={visibleRefs()}>
                {ri => <RefBadge info={ri} laneColor={laneColor} ancestryDimmed={props.isDimmedByAncestry} />}
              </For>
            </box>
          </Show>
          <text flexGrow={1} flexShrink={1} fg={effectiveTextColor()} wrapMode="none" truncate={bannerOverflow() === 0}>
            {(() => {
              const v = subjectText();
              if (props.active) {
                const off = bannerOffset();
                const ov = bannerOverflow();
                const rendered = ov > 0 ? v.substring(off, off + subjectAvailableWidth()) : v;
                return (
                  <strong>
                    <span fg={effectiveTextColor()}>{rendered}</span>
                  </strong>
                );
              }
              return v;
            })()}
          </text>
        </box>

        {/* Author */}
        <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2} overflow="hidden">
          <text fg={secondaryColumnColor()} wrapMode="none" truncate>
            {(() => {
              const v = isUncommitted() ? UNCOMMITTED_PLACEHOLDER : commit().author;
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
              const v = isUncommitted() ? UNCOMMITTED_PLACEHOLDER : formatRelativeDate(commit().authorDate);
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

      {/* Connector row: vertical lines between commits.
          When showGapBelow is true, renders dimmed ┊ instead of │
          to indicate filtered-out commits between this row and the next. */}
      <Show when={!props.isLast}>
        <ConnectorRow content={props.showGapBelow ? gapContent : connectorContent} width={graphWidth()} />
      </Show>
    </box>
  );
}

/** Sort order for ref badges: tags first, then branches, remotes, HEAD last. */
const REF_SORT_ORDER: Record<string, number> = { tag: 0, branch: 1, remote: 2, stash: 3, uncommitted: 4, head: 5 };

/**
 * Returns true when the commit row has merge/branch connectors (horizontals,
 * corners, tees). In that case the commit row carries connection info and
 * can't be replaced by a fan-out row.
 */
function rowHasConnections(row: GraphRow): boolean {
  return row.connectors.some(
    c =>
      c.type === "horizontal" ||
      c.type === "tee-left" ||
      c.type === "tee-right" ||
      c.type === "corner-top-right" ||
      c.type === "corner-top-left" ||
      c.type === "corner-bottom-right" ||
      c.type === "corner-bottom-left",
  );
}

interface FanOutDisplay {
  /** StyledText content for each fan-out row rendered above the commit row. */
  fanOutAboveContents: StyledText[];
  /** StyledText content for the commit row's graph cell. */
  commitRowGraphContent: StyledText;
}

/**
 * Derives the fan-out display data from pre-computed full-width chars.
 *
 * Fan-out rows: extra connector rows showing branch-off corners.
 * When fan-out rows exist AND the commit row is "simple" (no merge/branch
 * connectors), the LAST fan-out row is used as the commit row's graph
 * (since its █ at the node column would be adjacent to a redundant commit █).
 * When the commit row HAS connections (e.g., a merge), all fan-out rows
 * render separately and the commit row keeps its own graph.
 *
 * @param allFanOutChars  Full-width char arrays for each fan-out row (from createMemo).
 * @param canMerge        Whether the last fan-out row can replace the commit row graph.
 * @param normalGraphContent  The pre-computed commit-row graph content (used when !canMerge).
 * @param applyViewport   Callback that applies optional viewport slicing to a char array.
 * @param addEdge         Callback that appends the edge-indicator column.
 */
function buildFanOutDisplay(
  allFanOutChars: GraphChar[][],
  canMerge: boolean,
  normalGraphContent: StyledText,
  applyViewport: (chars: GraphChar[]) => GraphChar[],
  addEdge: (chars: GraphChar[], isCommitRow: boolean) => GraphChar[],
): FanOutDisplay {
  if (allFanOutChars.length === 0) {
    return { fanOutAboveContents: [], commitRowGraphContent: normalGraphContent };
  }

  const toContent = (chars: GraphChar[], isCommitRow: boolean): StyledText =>
    graphCharsToContent(addEdge(applyViewport(chars), isCommitRow));

  if (canMerge) {
    // Show all fan-out rows except the last (which merges into the commit row)
    const aboveContents = allFanOutChars.length <= 1 ? [] : allFanOutChars.slice(0, -1).map(c => toContent(c, false));
    // The last fan-out row IS the commit row graph
    const lastChars = allFanOutChars.at(-1) as GraphChar[];
    return { fanOutAboveContents: aboveContents, commitRowGraphContent: toContent(lastChars, true) };
  }

  // All fan-out rows render separately; commit row keeps its own graph
  return {
    fanOutAboveContents: allFanOutChars.map(c => toContent(c, false)),
    commitRowGraphContent: normalGraphContent,
  };
}

/** Horizontal divider line for the two-zone search context window. */
function SearchDivider() {
  const t = useT();
  return <box width="100%" border={["top"]} borderStyle="single" borderColor={t().border} />;
}

export default function GraphView(props: Readonly<{ onLoadMore?: () => void }>) {
  const { state, actions } = useAppState();

  // For each row, compute which columns stay bright when ancestry highlighting
  // is active. Delegates to the pure `computeBrightColumns` function.
  const brightColumnsByHash = createMemo(() => {
    const aSet = state.ancestrySet();
    if (aSet === null) return null;
    return computeBrightColumns(aSet, state.graphRows());
  });

  // Single viewport offset: reacts to the highlighted commit's node column.
  // All rows share the same offset, giving a horizontal "scroll" effect.
  const [viewportOffset, setViewportOffset] = createSignal(0);

  // Refs for programmatic scroll-into-view
  let scrollboxRef: ScrollBoxRenderable | undefined;
  const rowRefs: Renderable[] = [];

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

  /** Scroll a row at `idx` into view within the scrollbox. */
  const scrollRowIntoView = (idx: number) => {
    const sb = scrollboxRef;
    if (!sb) return;
    const rowEl = rowRefs[idx];
    if (!rowEl) return;
    scrollElementIntoView(sb, rowEl);
  };

  // Scroll the target row into view (triggered by keyboard nav / selection).
  createEffect(() => {
    const idx = state.scrollTargetIndex();
    if (idx < 0) return;
    scrollRowIntoView(idx);
  });

  // Deferred scroll-into-view after filter clear: polls until Yoga layout is ready.
  // When clearing a search filter, newly rendered rows don't have computed layout
  // yet because @opentui's requestAnimationFrame fires BEFORE the render pass.
  // We poll every 16ms until the target row has a valid layout, then scroll to it.
  let pendingScrollPollId: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(pendingScrollPollId));
  createEffect(() => {
    const hash = state.pendingScrollHash();
    clearTimeout(pendingScrollPollId);
    if (!hash) return;

    const MAX_ATTEMPTS = 30; // ~480ms max
    let attempts = 0;

    const poll = () => {
      attempts++;
      const rows = state.filteredRows();
      const idx = rows.findIndex(r => r.commit.hash === hash);
      if (idx < 0) {
        actions.setPendingScrollHash(null);
        return;
      }
      const rowEl = rowRefs[idx];
      if (rowEl && rowEl.getLayoutNode().getComputedLayout().height > 0) {
        scrollRowIntoView(idx);
        actions.setPendingScrollHash(null);
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        actions.setPendingScrollHash(null);
        return;
      }
      pendingScrollPollId = setTimeout(poll, 16);
    };

    pendingScrollPollId = setTimeout(poll, 16);
  });

  // Trigger pagination when cursor approaches the end of loaded rows.
  // Only fires when there are more commits to load and no load is in progress.
  const LOAD_MORE_THRESHOLD = 5;
  createEffect(() => {
    const idx = state.cursorIndex();
    const rows = state.filteredRows();
    const total = rows.length;
    if (total === 0) return;
    if (!state.hasMore()) return;
    if (state.fetching()) return;
    if (idx >= total - LOAD_MORE_THRESHOLD) {
      props.onLoadMore?.();
    }
  });

  // createSelector tracks which index is "selected" and only notifies the
  // previous and current rows when the cursor moves, reducing reactive
  // re-evaluations from N (every row) down to exactly 2.
  const isActive = createSelector(() => state.cursorIndex());

  // Hash → index lookup for the full (unfiltered) graph.
  // Used to detect whether consecutive filtered rows are truly adjacent
  // in the original graph, not just parent-child (which can skip many rows
  // for merge commits).
  const graphIndexMap = createMemo(() => {
    const map = new Map<string, number>();
    const rows = state.graphRows();
    for (let i = 0; i < rows.length; i++) {
      map.set(rows[i].commit.hash, i);
    }
    return map;
  });

  return (
    <scrollbox ref={scrollboxRef} flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
      <box flexDirection="column" flexGrow={1}>
        <Show when={!state.loading()}>
          <For each={state.filteredRows()}>
            {(row, index) => {
              const showDivider = () => state.searchShowDivider();

              const showGapBelow = () => {
                // Only show gap separators between non-adjacent filtered rows.
                // In Phase 1, suppress the gap below row 0 (the h-line handles it).
                if (!state.searchQuery()) return false;
                const rows = state.filteredRows();
                const i = index();
                if (i >= rows.length - 1) return false;
                // In Phase 1, the h-line after row 0 replaces the gap there
                if (showDivider() && i === 0) return false;
                const nextRow = rows[i + 1];
                // Check distance in the original unfiltered graph — adjacent
                // means their positions differ by exactly 1.
                const idxMap = graphIndexMap();
                const currentOrigIdx = idxMap.get(row.commit.hash) ?? -1;
                const nextOrigIdx = idxMap.get(nextRow.commit.hash) ?? -1;
                return nextOrigIdx - currentOrigIdx !== 1;
              };

              // Capture the element ref so we can reactively update rowRefs
              // when <For> reindexes this element (e.g. after filter clear).
              // Ref callbacks only fire on creation; this effect re-runs
              // whenever index() changes, keeping rowRefs in sync.
              let elRef: Renderable | undefined;
              createEffect(() => {
                if (elRef) rowRefs[index()] = elRef;
              });
              return (
                <>
                  <GraphLine
                    row={row}
                    index={index()}
                    active={isActive(index())}
                    isLast={index() === state.filteredRows().length - 1}
                    showGapBelow={showGapBelow()}
                    viewportOffset={viewportOffset}
                    ancestryActive={() => brightColumnsByHash() !== null}
                    isDimmedByAncestry={() => {
                      const aSet = state.ancestrySet();
                      return aSet !== null && !aSet.has(row.commit.hash);
                    }}
                    brightColumns={() => brightColumnsByHash()?.vertical.get(row.commit.hash)}
                    brightFanOutVerticals={() => brightColumnsByHash()?.fanOutVertical.get(row.commit.hash)}
                    brightFanOutHorizontals={() => brightColumnsByHash()?.fanOutHorizontal.get(row.commit.hash)}
                    brightCommitHorizontals={() => brightColumnsByHash()?.commitHorizontal.get(row.commit.hash)}
                    rowRef={el => {
                      elRef = el;
                      rowRefs[index()] = el;
                    }}
                  />
                  <Show when={showDivider() && index() === 0}>
                    <SearchDivider />
                  </Show>
                </>
              );
            }}
          </For>
        </Show>
      </box>
    </scrollbox>
  );
}
