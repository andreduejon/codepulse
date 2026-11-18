import {
  MouseButton,
  type MouseEvent,
  type ScrollBoxRenderable,
  type StyledText,
  type TextRenderable,
} from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSelector, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { computeBrightColumns, computeSingleViewportOffset } from "../../core/git/graph";
import type { GraphRow, RefInfo } from "../../core/git/types";
import type { GraphBadge } from "../../core/provider-model";
import {
  AUTHOR_COL_WIDTH,
  COMPACT_THRESHOLD_WIDTH,
  DATE_COL_WIDTH,
  DETAIL_PANEL_WIDTH_FRACTION,
  HASH_COL_WIDTH,
  UNCOMMITTED_PLACEHOLDER,
} from "../constants";
import { useAppState } from "../context/state";
import { dimGraphChars } from "../graph/dim";
import {
  type GraphChar,
  getColorForColumn,
  renderConnectorRow,
  renderFanOutRow,
  renderGraphRow,
} from "../graph/render";
import { edgeMarks, MAX_GRAPH_COLUMNS, sliceGraphToViewport } from "../graph/viewport";
import { useScrollWindow } from "../hooks/use-scroll-window";
import { useT } from "../hooks/use-t";
import { GIT_WIDTHS, type GraphColumnWidths } from "../providers/graph-column-widths";
import { badgeOf, useGraphColumns } from "../providers/graph-columns-context";
import type { ProviderGraphColumns } from "../providers/module";
import { ScrollingLabel } from "../providers/shared/detail-rows";
import { formatRelativeDate } from "../utils/date";
import { scheduleScrollIntoView } from "../utils/scroll";
import { cellWidth } from "../utils/terminal-text";
import Badge from "./badge";
import { graphCharsToContent } from "./graph-text";

/** Shared graph dimension computations used by ColumnHeader and GraphLine. */
function useGraphDimensions(maxGraphColumns: () => number) {
  const effectiveGraphColumns = () => Math.min(maxGraphColumns(), MAX_GRAPH_COLUMNS);
  const viewportActive = () => maxGraphColumns() > MAX_GRAPH_COLUMNS;
  // While scrolling sideways, a 2-character mark column on each side (see `edgeMarks`).
  const graphWidth = () => Math.max(effectiveGraphColumns() * 2 + 1 + (viewportActive() ? 4 : 0), 6);
  return { effectiveGraphColumns, viewportActive, graphWidth };
}

/** The subject keeps at least this many columns before provider columns or ref badges take more. */
const MIN_SUBJECT_WIDTH = 20;
/** Provider columns also leave room for one shortened ref badge and a `+N` badge (8 + 3 and `+N` + 3). */
const MIN_REFS_WIDTH = 16;
const NO_BADGES = new Map<string, GraphBadge>();

/** Columns the graph panel gets: the terminal minus the sidebar (wide layout) and the panel's own padding. */
function graphPanelWidth(terminalWidth: number): number {
  // Detail panel box width = 25% of W (minWidth=60). Its paddingX=2 is internal, so it does NOT reduce the left
  // panel's allocated width. 4 = left panel paddingX=2 each side.
  const detailPanelWidth =
    terminalWidth >= COMPACT_THRESHOLD_WIDTH
      ? Math.max(Math.floor(terminalWidth * DETAIL_PANEL_WIDTH_FRACTION), 60)
      : 0;
  return terminalWidth - detailPanelWidth - 4;
}

/** Room for a row's refs, subject and the two right columns: after the graph, hash and description padding. */
function rowTextRoom(terminalWidth: number, graphWidth: number): number {
  return graphPanelWidth(terminalWidth) - graphWidth - HASH_COL_WIDTH - 3;
}

/**
 * Provider columns grow to fit their chips (their `widths`), but only into room beyond the subject's minimum;
 * past that they keep their base widths (chips then clip) rather than squeezing the subject out.
 */
function budgetedColumnWidths(
  columns: ProviderGraphColumns | null,
  badges: ReadonlyMap<string, GraphBadge>,
  terminalWidth: number,
  graphWidth: number,
): GraphColumnWidths {
  if (!columns) return GIT_WIDTHS;
  const wanted = columns.widths(badges);
  const base = columns.widths(NO_BADGES);
  const room = Math.max(
    base.first + base.second,
    rowTextRoom(terminalWidth, graphWidth) - MIN_SUBJECT_WIDTH - MIN_REFS_WIDTH,
  );
  let excess = wanted.first + wanted.second - room;
  if (excess <= 0) return wanted;
  const first = Math.max(base.first, wanted.first - excess);
  excess -= wanted.first - first;
  return { first, second: Math.max(base.second, wanted.second - excess) };
}

export function ColumnHeader() {
  const t = useT();
  const { state } = useAppState();
  const leftPanelFocused = () => !state.detailFocused();
  const providerColumns = useGraphColumns();
  const dimensions = useTerminalDimensions();

  const { graphWidth } = useGraphDimensions(() => state.maxGraphColumns());
  const columnWidths = () =>
    budgetedColumnWidths(providerColumns(), state.graphBadges(), dimensions().width, graphWidth());

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

        {/* Author / Date columns — swapped for provider headers when in provider view */}
        <Show
          when={providerColumns()}
          keyed
          fallback={
            <>
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
            </>
          }
        >
          {columns => <columns.Headers {...columnWidths()} />}
        </Show>
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
    terminalWidth: () => number;
    onMouseDown: (event: MouseEvent) => void;
    mouseEnabled?: () => boolean;
    viewportOffset: () => number;
    /** Whether ancestry highlighting is currently active (any commit selected).
     *  Derived from brightColumnsByHash in the parent — avoids a second signal read. */
    ancestryActive: () => boolean;
    /** Whether this specific row should be dimmed by ancestry highlighting.
     *  True when ancestry is active AND this row is NOT in the first-parent chain. */
    isDimmedByAncestry: () => boolean;
    /** Whether this row is dimmed by search/path highlighting (non-ancestry).
     *  When true, the entire row (graph + text) is dimmed except the commit node. */
    isDimmedByHighlight: () => boolean;
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

  const [hovered, setHovered] = createSignal(false);
  /** The shown provider's two columns, in place of Author and Date; none in Git. */
  const providerColumns = useGraphColumns();
  /** Provider columns grow to fit their widest chips (within budget); header, row and subject width share these. */
  const columnWidths = () =>
    budgetedColumnWidths(providerColumns(), state.graphBadges(), props.terminalWidth(), graphWidth());

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

  // Combined dimming: true when the row is dimmed by any highlight mode or is uncommitted
  const isDimmed = () => isUncommitted() || props.isDimmedByAncestry() || props.isDimmedByHighlight();

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

    // For search/path highlighting: dim all graph chars uniformly (no per-column brightness).
    // Only the commit node stays bright on matching rows (handled separately below).
    const highlightDimmed = props.isDimmedByHighlight();
    const mode = state.highlightMode();
    const highlightActive = mode === "search" || mode === "path";

    return dimGraphChars(chars, t().foregroundMuted, {
      isUncommitted: isUncommitted(),
      ancestryActive: props.ancestryActive(),
      brightColumns: vBright,
      brightHorizontal: hBright,
      highlightActive,
      highlightDimmed,
      nodeColumn: props.row.nodeColumn,
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

  // While the graph scrolls sideways, each row is sliced to the viewport and gets a mark column on both sides:
  // a dashed end where a line runs past an edge, a triangle in the commit's color on the side of a commit whose
  // block is off-screen. Slicing is cheap; the full-width renders above stay memoized while only viewportOffset
  // changes.
  const edgeColor = () => t().foregroundMuted;
  /** A full-width row fitted to the viewport with its edge marks; `nodeColumn` is null for non-commit rows. */
  const frameRow = (full: GraphChar[], nodeColumn: number | null): GraphChar[] => {
    if (!viewportActive()) return full;
    const offset = props.viewportOffset();
    const marks = edgeMarks(full, offset, MAX_GRAPH_COLUMNS, state.maxGraphColumns(), nodeColumn, edgeColor());
    return [
      ...marks.left,
      ...sliceGraphToViewport(full, offset, MAX_GRAPH_COLUMNS, props.row, renderOpts()),
      ...marks.right,
    ];
  };

  const graphContent = () => graphCharsToContent(frameRow(fullGraphChars(), props.row.nodeColumn));
  const connectorContent = () => graphCharsToContent(frameRow(fullConnectorChars(), null));

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
    // The last row stands in for the commit's own row when the commit has no connections: only it draws the block.
    const lastIsCommitRow = canMergeFanOut();
    return foRows.map((foConnectors, idx) =>
      dimChars(
        renderFanOutRow(foConnectors, renderOpts(), props.row.nodeColumn, lastIsCommitRow && idx === foRows.length - 1),
        foHBrightMap?.get(idx),
        foVBright,
      ),
    );
  });

  // Derive fan-out display: rows above the commit + the commit row's graph content.
  // frameRow is passed as a callback to keep buildFanOutDisplay pure.
  const fanOutDisplay = () =>
    buildFanOutDisplay(fullFanOutChars(), canMergeFanOut(), graphContent(), (chars, isCommitRow) =>
      frameRow(chars, isCommitRow ? props.row.nodeColumn : null),
    );

  const fanOutAboveContents = () => fanOutDisplay().fanOutAboveContents;
  const commitRowGraphContent = () => fanOutDisplay().commitRowGraphContent;

  // Use refs to set StyledText content directly on TextRenderable,
  // bypassing the Solid reconciler which stringifies the content prop.
  let graphTextRef: TextRenderable | undefined;

  createEffect(() => {
    if (graphTextRef) graphTextRef.content = commitRowGraphContent();
  });

  // Ref sort order: tag=0, branch=1, remote=2, head=3 (hoisted to module scope). A provider's names follow the refs
  // in its colour (OpenShift: the namespaces running this commit).
  const visibleRefs = createMemo((): RowBadge[] => {
    const allRefs = commit().refs;
    const refs: RowBadge[] = [...allRefs].sort((a, b) => (REF_SORT_ORDER[a.type] ?? 9) - (REF_SORT_ORDER[b.type] ?? 9));
    const names = providerColumns()?.refs?.(badgeOf(state.graphBadges(), commit().hash)) ?? [];
    return [...refs, ...names.map(name => ({ name, isCurrent: false, namespace: true }))];
  });

  // Effective text color for the commit subject (primary column).
  // Active row uses accent color with bold. Inactive rows use foreground.
  // Dimmed rows (uncommitted, non-highlighted, non-ancestry) use muted color.
  const effectiveTextColor = () => {
    if (isDimmed()) return t().foregroundMuted;
    if (props.active) return t().accent;
    return t().foreground;
  };

  // Secondary column color (author, date, hash).
  // Active → accent (bold applied separately). Otherwise, muted.
  // Dimmed rows always use muted.
  const secondaryColumnColor = () => {
    if (isDimmed()) return t().foregroundMuted;
    if (props.active) return t().accent;
    return t().foregroundMuted;
  };

  // --- Banner scroll for the active commit's subject text ---

  // Width of the ref badges area for this row (variable per row).
  // Each badge renders as " name " (name + 2 spaces), with a gap of 1 between badges
  // and 1 paddingRight after the badge box. Returns 0 when no refs are visible.
  // Ref badge names are capped at 30 characters, and shorter when the row is tight, so the subject keeps
  // MIN_SUBJECT_WIDTH (each badge takes name + 2, one gap between badges and one after them).
  // When even 8-character badges do not fit, the refs that do not fit collapse into one muted `+N` badge; when not
  // even one fits beside it, `+N` stands for all of them.
  const refLayout = createMemo(() => {
    const refs = visibleRefs();
    if (refs.length === 0) return { shown: refs, hidden: 0, maxLength: 30 };
    const room =
      rowTextRoom(props.terminalWidth(), graphWidth()) -
      columnWidths().first -
      columnWidths().second -
      MIN_SUBJECT_WIDTH;
    // The checked-out branch (or a detached HEAD) keeps its badge first, then the namespaces (what the OpenShift view
    // is about), then the others in display order. Kept badges still render in display order.
    const rank = (badge: RowBadge) => (badge.isCurrent ? 0 : badge.namespace ? 1 : 2);
    const byPriority = [...refs].sort((a, b) => rank(a) - rank(b));
    const keep = (count: number) => {
      const kept = new Set(byPriority.slice(0, count));
      return refs.filter(ref => kept.has(ref));
    };
    for (let shown = refs.length; shown >= 1; shown--) {
      const hidden = refs.length - shown;
      // `+N` badge: its text + 2, plus one gap.
      const overflow = hidden > 0 ? `+${hidden}`.length + 3 : 0;
      const kept = keep(shown);
      // Each shown badge: its name (cut at `cap`) + 2, one gap between badges and one after them. Short names
      // (`dev`) take only their own width, so they are not folded into `+N` for the room a long name would need.
      const needed = (cap: number) =>
        kept.reduce((sum, ref) => sum + Math.min(cellWidth(ref.name), cap) + 3, 0) + overflow;
      for (let cap = 30; cap >= 8; cap--) {
        if (needed(cap) <= room) return { shown: kept, hidden, maxLength: cap };
      }
    }
    // Not even one shortened badge fits beside `+N`: all refs collapse into it, so the subject keeps its room.
    return { shown: [], hidden: refs.length, maxLength: 8 };
  });
  const refMaxLength = () => refLayout().maxLength;

  const subjectText = () => (isUncommitted() ? "Staged and unstaged changes in working tree" : commit().subject);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI block uses existing keyboard graph navigation, not DOM roles.
    // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard selection already highlights the active commit block.
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={
        props.active || (hovered() && props.mouseEnabled?.() !== false) ? t().backgroundElement : undefined
      }
      onMouseDown={props.onMouseDown}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
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
                <span>{commit().shortHash}</span>
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
              <For each={refLayout().shown}>
                {ri => (
                  <Badge
                    name={ri.name}
                    color={ri.namespace ? t().openShiftBg : laneColor()}
                    dimmed={ri.type === "stash" || ri.type === "uncommitted" || isDimmed()}
                    maxLength={refMaxLength()}
                    noShrink
                  />
                )}
              </For>
              <Show when={refLayout().hidden > 0}>
                <Badge name={`+${refLayout().hidden}`} dimmed noShrink />
              </Show>
            </box>
          </Show>
          {/* Measured like the detail rows: cut with … in terminal columns, and the active subject scrolls. */}
          <ScrollingLabel
            text={subjectText()}
            active={!!props.active}
            bold={!!props.active}
            fg={effectiveTextColor()}
          />
        </box>

        {/* Author / Date — replaced by the provider's columns in its view */}
        <Show
          when={providerColumns()}
          keyed
          fallback={
            <>
              {/* Author */}
              <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2} overflow="hidden">
                <text fg={secondaryColumnColor()} wrapMode="none" truncate>
                  {(() => {
                    const v = isUncommitted() ? UNCOMMITTED_PLACEHOLDER : commit().author;
                    return props.active ? (
                      <strong>
                        <span>{v}</span>
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
                        <span>{v}</span>
                      </strong>
                    ) : (
                      v
                    );
                  })()}
                </text>
              </box>
            </>
          }
        >
          {columns => (
            <columns.Cells
              sha={commit().hash}
              badge={badgeOf(state.graphBadges(), commit().hash)}
              uncommitted={isUncommitted()}
              active={props.active}
              dimmed={isDimmed()}
              widths={columnWidths()}
            />
          )}
        </Show>
      </box>

      {/* Connector row: vertical lines between commits. */}
      <Show when={!props.isLast}>
        <ConnectorRow content={connectorContent} width={graphWidth()} />
      </Show>
    </box>
  );
}

/** Sort order for ref badges: tags first, then branches, remotes, HEAD last. */
/** A badge before the subject: a Git ref, or (OpenShift view) a namespace that runs the commit. */
type RowBadge = { name: string; type?: RefInfo["type"]; isCurrent: boolean; namespace?: boolean };

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

/**
 * How many lines a row takes: its fan-out rows above the commit (the last merges into the commit's line when the commit
 * has no connections of its own), the commit's line, and the connector below it unless it is the last row.
 */
export function graphRowHeight(row: GraphRow, isLast: boolean): number {
  const fanOut = row.fanOutRows?.length ?? 0;
  const above = fanOut > 0 && !rowHasConnections(row) ? fanOut - 1 : fanOut;
  return above + 1 + (isLast ? 0 : 1);
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
 * @param frame           Fits a full-width row to the viewport and adds its edge marks.
 */
function buildFanOutDisplay(
  allFanOutChars: GraphChar[][],
  canMerge: boolean,
  normalGraphContent: StyledText,
  frame: (chars: GraphChar[], isCommitRow: boolean) => GraphChar[],
): FanOutDisplay {
  if (allFanOutChars.length === 0) {
    return { fanOutAboveContents: [], commitRowGraphContent: normalGraphContent };
  }

  const toContent = (chars: GraphChar[], isCommitRow: boolean): StyledText =>
    graphCharsToContent(frame(chars, isCommitRow));

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

export default function GraphView(
  props: Readonly<{
    onLoadMore?: () => void;
    scrollboxRef?: (el: ScrollBoxRenderable) => void;
    suppressAutoScroll?: () => boolean;
    mouseEnabled?: () => boolean;
    onSelectRow?: (index: number) => void;
  }>,
) {
  const { state, actions } = useAppState();
  const t = useT();
  const dimensions = useTerminalDimensions();

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

  let scrollboxRef: ScrollBoxRenderable | undefined;
  /** Only the rows near the screen are mounted: the others take their height as empty space. */
  const rowWindow = useScrollWindow({
    heights: () => {
      const rows = state.graphRows();
      return rows.map((row, index) => graphRowHeight(row, index === rows.length - 1));
    },
    screenHeight: () => dimensions().height,
  });
  const shownRows = createMemo(() => {
    const { start, end } = rowWindow.range();
    return state.graphRows().slice(start, end);
  });
  const scrollSchedule: { scrollTimer?: ReturnType<typeof setTimeout> } = {};

  createEffect(() => {
    const rows = state.graphRows();
    const idx = state.cursorIndex();
    const maxCols = state.maxGraphColumns();

    if (maxCols <= MAX_GRAPH_COLUMNS || idx < 0 || idx >= rows.length) {
      setViewportOffset(0);
      return;
    }

    const nodeCol = rows[idx].nodeColumn;
    setViewportOffset(prev => computeSingleViewportOffset(prev, nodeCol, MAX_GRAPH_COLUMNS, maxCols));
  });

  /** Scroll the row at `idx` into view (again after the next layout when its lines aren't there yet). */
  const scrollRowIntoView = (idx: number) =>
    scheduleScrollIntoView(scrollSchedule, () => rowWindow.scrollIntoView(idx));

  // Scroll the target row into view (triggered by keyboard nav / selection).
  createEffect(() => {
    if (props.suppressAutoScroll?.()) return;
    const idx = state.scrollTargetIndex();
    if (idx < 0) return;
    scrollRowIntoView(idx);
  });
  onCleanup(() => {
    if (scrollSchedule.scrollTimer) clearTimeout(scrollSchedule.scrollTimer);
  });

  // Deferred scroll-into-view after filter clear: polls until Yoga layout is ready.
  // When clearing a search filter, the graph's new height isn't laid out yet
  // because @opentui's requestAnimationFrame fires BEFORE the render pass.
  // We poll every 16ms until the content reaches the target row, then scroll to it.
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
      const rows = state.graphRows();
      const idx = rows.findIndex(r => r.commit.hash === hash);
      if (idx < 0) {
        actions.setPendingScrollHash(null);
        return;
      }
      if (rowWindow.scrollIntoView(idx)) {
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
  /** Cursor position when a history page failed: no automatic retry until the cursor moves (or the wheel scrolls). */
  let failedAtCursor: number | null = null;
  createEffect(() => {
    if (state.historyError()) failedAtCursor = untrack(() => state.cursorIndex());
    else failedAtCursor = null;
  });
  createEffect(() => {
    const idx = state.cursorIndex();
    const rows = state.graphRows();
    const total = rows.length;
    if (total === 0) return;
    if (!state.hasMore()) return;
    if (state.fetching()) return;
    if (state.historyError() && idx === failedAtCursor) return;
    if (idx >= total - LOAD_MORE_THRESHOLD) {
      props.onLoadMore?.();
    }
  });

  // createSelector tracks which index is "selected" and only notifies the
  // previous and current rows when the cursor moves, reducing reactive
  // re-evaluations from N (every row) down to exactly 2.
  const isActive = createSelector(() => state.cursorIndex());

  /** What the shown provider holds for commits the graph doesn't show (OpenShift: namespaces running older ones). */
  const providerColumns = useGraphColumns();
  const unseenDeployments = createMemo(() => {
    const unseen = providerColumns()?.unseen;
    if (!unseen) return null;
    return unseen(new Set(state.commits().map(commit => commit.hash.toLowerCase())), state.graphBadges());
  });

  return (
    <scrollbox
      ref={el => {
        scrollboxRef = el;
        rowWindow.attach(el);
        props.scrollboxRef?.(el);
      }}
      flexGrow={1}
      scrollY
      scrollX={false}
      verticalScrollbarOptions={{ visible: false }}
      onSizeChange={() => {
        // A smaller terminal can leave the selected row below the screen: bring it back into view, once this layout
        // pass has given the rows and the viewport their new places.
        queueMicrotask(() => {
          const idx = state.scrollTargetIndex();
          if (scrollboxRef?.isDestroyed || idx < 0 || props.suppressAutoScroll?.()) return;
          scrollRowIntoView(idx);
        });
      }}
      onMouseScroll={event => {
        if (event.scroll?.direction !== "down" || props.mouseEnabled?.() === false) return;
        // OpenTUI applies wheel scrolling after this handler; inspect the updated viewport.
        queueMicrotask(() => {
          const sb = scrollboxRef;
          if (!sb || sb.isDestroyed || props.mouseEnabled?.() === false) return;
          if (state.loading() || state.fetching() || !state.hasMore() || state.graphRows().length === 0) return;
          if (sb.scrollHeight - sb.scrollTop - sb.viewport.height <= LOAD_MORE_THRESHOLD) {
            props.onLoadMore?.();
          }
        });
      }}
      viewportOptions={{
        onMouse: event => {
          if (props.mouseEnabled?.() === false) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
      }}
    >
      <box flexDirection="column" flexGrow={1}>
        <Show when={!state.loading()}>
          <box height={rowWindow.before()} flexShrink={0} />
          <For each={shownRows()}>
            {(row, shownIndex) => {
              const index = () => rowWindow.range().start + shownIndex();
              return (
                <GraphLine
                  row={row}
                  index={index()}
                  active={isActive(index())}
                  isLast={index() === state.graphRows().length - 1}
                  terminalWidth={() => dimensions().width}
                  mouseEnabled={props.mouseEnabled}
                  onMouseDown={event => {
                    if (event.button !== MouseButton.LEFT || props.mouseEnabled?.() === false) return;
                    event.preventDefault();
                    props.onSelectRow?.(index());
                  }}
                  viewportOffset={viewportOffset}
                  ancestryActive={() => brightColumnsByHash() !== null}
                  isDimmedByAncestry={() => {
                    const aSet = state.ancestrySet();
                    return aSet !== null && !aSet.has(row.commit.hash);
                  }}
                  isDimmedByHighlight={() => {
                    const mode = state.highlightMode();
                    if (mode === "ancestry" || mode === null) return false;
                    const hSet = state.highlightSet();
                    return hSet !== null && !hSet.has(row.commit.hash);
                  }}
                  brightColumns={() => brightColumnsByHash()?.vertical.get(row.commit.hash)}
                  brightFanOutVerticals={() => brightColumnsByHash()?.fanOutVertical.get(row.commit.hash)}
                  brightFanOutHorizontals={() => brightColumnsByHash()?.fanOutHorizontal.get(row.commit.hash)}
                  brightCommitHorizontals={() => brightColumnsByHash()?.commitHorizontal.get(row.commit.hash)}
                />
              );
            }}
          </For>
          <box height={rowWindow.after()} flexShrink={0} />
          <Show when={state.historyError()}>
            <box paddingLeft={2} height={1} flexShrink={0}>
              <text wrapMode="none" truncate fg={t().warning}>
                Could not load more history. Scroll to the end to retry.
              </text>
            </box>
          </Show>
          <Show when={unseenDeployments()}>
            {text => (
              <box paddingLeft={2} height={1} flexShrink={0}>
                <text wrapMode="none" truncate fg={t().foregroundMuted}>
                  {text()}
                </text>
              </box>
            )}
          </Show>
        </Show>
      </box>
    </scrollbox>
  );
}
