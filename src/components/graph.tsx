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
  computeSingleViewportOffset,
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
    /** Set of column indices that should stay bright on this row (passthrough ancestry
     *  lanes). Undefined = ancestry inactive or this row has no passthrough lanes. */
    brightColumns: () => Set<number> | undefined;
    /** Per-fan-out-row horizontal bright columns. Map from fan-out row index to the set
     *  of column indices where ─, corners, and tees should stay bright. Only the specific
     *  fan-out row connecting an ancestry child to this parent gets brightened.
     *  Crossings (┼) are excluded — they stay dimmed. */
    brightFanOutHorizontals: () => Map<number, Set<number>> | undefined;
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

  // Ancestry dimming: true when ancestry highlighting is active AND this row is
  // NOT in the first-parent chain of the anchor commit (i.e. it should visually recede).
  // Used by effectiveTextColor and secondaryColumnColor for text column dimming.
  const isDimmedByAncestry = () => {
    const aSet = state.ancestrySet();
    if (!aSet) return false;
    return !aSet.has(commit().hash);
  };

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

  /**
   * Unified dimming for all graph chars.
   *
   * @param chars   The rendered GraphChar[] for this row.
   * @param hBright Optional set of column indices where horizontal glyphs (─, corners,
   *                tees) stay bright. Used for per-fan-out-row horizontal brightening.
   *                When omitted, no horizontal brightening is applied (commit rows).
   *
   * Rules:
   *   - uncommitted node        → full dim always
   *   - ancestry inactive       → no dim (pass through)
   *   - bright set present      → char-position tracking: colIdx = floor(pos/2) where pos
   *                               accumulates char.length.
   *                               Vertical-bright cols keep │ and █ vivid.
   *                               Horizontal-bright cols (from hBright) keep ─, corners,
   *                               and tees vivid (but NOT ┼ crossings or ─ after ┼).
   *   - no bright set           → full dim
   *
   * NOTE: array index ≠ column index for renderGraphRow/renderFanOutRow because a single
   * column can be split into two 1-char entries. Char-position tracking is the only
   * correct mapping: column c occupies char positions [c*2, c*2+2).
   */
  const dimChars = (chars: GraphChar[], hBright?: Set<number>): GraphChar[] => {
    const mutedColor = t().foregroundMuted;
    if (isUncommitted()) return chars.map(c => ({ ...c, color: mutedColor, bold: false }));
    const aSet = state.ancestrySet();
    if (aSet === null) return chars;
    const bright = props.brightColumns();
    const hasBright = (bright && bright.size > 0) || (hBright && hBright.size > 0);
    if (hasBright) {
      let pos = 0;
      let prevWasCrossing = false;
      return chars.map(c => {
        const colIdx = Math.floor(pos / 2);
        pos += c.char.length;
        const ch = c.char[0];

        // Vertical passthrough │ and node █ stay bright at vertical-bright columns.
        const isVerticalBright = bright?.has(colIdx) && (ch === "│" || ch === "█");

        // Horizontal glyphs stay bright at horizontal-bright columns,
        // EXCEPT crossings (┼ and the ─ immediately after ┼): those stay dimmed
        // to avoid confusion about which lane the crossing belongs to.
        const isCrossing = ch === "┼";
        const isDashAfterCrossing = prevWasCrossing && ch === "─";
        prevWasCrossing = isCrossing;
        const isHorizontalBright = hBright?.has(colIdx) && !isCrossing && !isDashAfterCrossing && ch !== "│";

        const isBright = isVerticalBright || isHorizontalBright;
        return isBright ? c : { ...c, color: mutedColor, bold: false };
      });
    }
    return chars.map(c => ({ ...c, color: mutedColor, bold: false }));
  };

  // Full-width renders — memoized, depend on row data + renderOpts, NOT viewportOffset.
  // Commit and connector rows use only vertical bright sets (no horizontal brightening).
  // Fan-out rows get per-row horizontal bright sets via the hBright parameter.
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
    return foRows.map((foConnectors, idx) =>
      dimChars(renderFanOutRow(foConnectors, renderOpts(), props.row.nodeColumn), foHBrightMap?.get(idx)),
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
    if (isUncommitted() || isDimmedByAncestry()) return t().foregroundMuted;
    if (props.active) return t().accent;
    return t().foreground;
  };

  // Secondary column color (author, date, hash).
  // Active → accent (bold applied separately). Otherwise, muted.
  // Uncommitted-changes row always uses muted.
  // Non-ancestor rows (when ancestry highlighting is active) use muted.
  const secondaryColumnColor = () => {
    if (isUncommitted() || isDimmedByAncestry()) return t().foregroundMuted;
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
                {ri => <RefBadge info={ri} laneColor={laneColor} ancestryDimmed={isDimmedByAncestry} />}
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

  // For each row (ancestry and non-ancestry), compute which column indices
  // should stay bright when ancestry highlighting is active:
  //   - vertical: columns where │ passthroughs and █ nodes stay bright.
  //   - fanOutHorizontal: per-fan-out-row sets of columns where ─, corners,
  //     and tees stay bright (the arm connecting an ancestry child to its
  //     parent's nodeColumn). Only the specific fan-out row that reaches the
  //     ancestry child gets brightened — other fan-out rows stay dimmed.
  //     Commit-row merge/branch connectors are never brightened.
  //
  // Algorithm:
  //   1. Walk graphRows() top-to-bottom, collecting ancestry row indices.
  //   2. For each ancestry row: add its nodeColumn to vertical.
  //   3. For each consecutive pair (child @ i, parent @ j):
  //      Intermediate rows r in (i, j): add childCol if active, else parentCol
  //      to vertical.
  //   4. When childCol ≠ parentCol, find the specific fan-out row on the parent
  //      that reaches childCol, and store its index + column span.
  //   5. Returns { vertical, fanOutHorizontal } | null (null when ancestry inactive).
  const brightColumnsByHash = createMemo(
    (): {
      vertical: Map<string, Set<number>>;
      fanOutHorizontal: Map<string, Map<number, Set<number>>>;
    } | null => {
      const aSet = state.ancestrySet();
      if (aSet === null) return null;
      const rows = state.graphRows();
      const vertical = new Map<string, Set<number>>();
      // Map<parentHash, Map<fanOutRowIndex, Set<columnIndex>>>
      const fanOutHorizontal = new Map<string, Map<number, Set<number>>>();

      const addCol = (hash: string, col: number) => {
        let set = vertical.get(hash);
        if (!set) {
          set = new Set<number>();
          vertical.set(hash, set);
        }
        set.add(col);
      };

      const addFoHCol = (hash: string, foIdx: number, col: number) => {
        let byRow = fanOutHorizontal.get(hash);
        if (!byRow) {
          byRow = new Map<number, Set<number>>();
          fanOutHorizontal.set(hash, byRow);
        }
        let set = byRow.get(foIdx);
        if (!set) {
          set = new Set<number>();
          byRow.set(foIdx, set);
        }
        set.add(col);
      };

      // Gather ancestry row indices and seed each with its nodeColumn
      const ancestryIndices: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (aSet.has(rows[i].commit.hash)) {
          ancestryIndices.push(i);
          addCol(rows[i].commit.hash, rows[i].nodeColumn);
        }
      }

      // For each consecutive pair of ancestry rows, compute passthrough columns
      // and per-fan-out-row horizontal bright sets.
      for (let p = 0; p + 1 < ancestryIndices.length; p++) {
        const childIdx = ancestryIndices[p];
        const parentIdx = ancestryIndices[p + 1];
        const childRow = rows[childIdx];
        const parentRow = rows[parentIdx];
        const childCol = childRow.nodeColumn;
        const parentCol = parentRow.nodeColumn;

        // Intermediate rows: brighten childCol if active, else try parentCol.
        // The glyph filter in dimChars ensures only │ passthrough glyphs actually
        // stay bright — ┼ crossings at the same column remain dimmed.
        for (let r = childIdx + 1; r < parentIdx; r++) {
          const row = rows[r];
          if (row.columns[childCol]?.active) {
            addCol(row.commit.hash, childCol);
          } else if (childCol !== parentCol && row.columns[parentCol]?.active) {
            addCol(row.commit.hash, parentCol);
          }
        }

        // When two consecutive ancestry nodes are in different lanes, the horizontal
        // connector arm on the parent's fan-out row should stay bright. We find the
        // specific fan-out row that reaches the ancestry child's column and mark only
        // that row's columns as bright. Commit-row merge/branch connectors are NOT
        // brightened — only fan-out rows carry the ancestry connection visual.
        if (childCol !== parentCol) {
          const lo = Math.min(childCol, parentCol);
          const hi = Math.max(childCol, parentCol);
          const parentHash = parentRow.commit.hash;

          const foRows = parentRow.fanOutRows;
          if (foRows) {
            for (let fi = 0; fi < foRows.length; fi++) {
              const reachesChild = foRows[fi].some(
                c => c.column === childCol && (c.type === "corner-bottom-right" || c.type === "corner-bottom-left"),
              );
              if (reachesChild) {
                for (let c = lo; c <= hi; c++) addFoHCol(parentHash, fi, c);
                break;
              }
            }
          }
        }
      }
      return { vertical, fanOutHorizontal };
    },
  );

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
                    brightColumns={() => brightColumnsByHash()?.vertical.get(row.commit.hash)}
                    brightFanOutHorizontals={() => brightColumnsByHash()?.fanOutHorizontal.get(row.commit.hash)}
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
