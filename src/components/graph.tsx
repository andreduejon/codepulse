import {
  MouseButton,
  type MouseEvent,
  type Renderable,
  type ScrollBoxRenderable,
  type StyledText,
  type TextRenderable,
} from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSelector, createSignal, For, onCleanup, Show, untrack } from "solid-js";
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
  computeBrightColumns,
  computeSingleViewportOffset,
  dimGraphChars,
  edgeMarks,
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
import { useT } from "../hooks/use-t";
import {
  ActionsColumnHeaders,
  ActionsCountsColumn,
  ActionsDateColumn,
} from "../providers/github-actions/graph-columns";
import { type GraphColumnWidths, graphColumnWidths } from "../providers/graph-column-widths";
import {
  lookupOpenShiftBadge,
  OpenShiftColumnHeaders,
  OpenShiftCountsColumn,
} from "../providers/openshift/graph-columns";
import type { GraphBadge, ProviderView } from "../providers/provider";
import { ScrollingLabel } from "../providers/shared/detail-rows";
import { SnykColumnHeaders, SnykCountsColumn, SnykScanColumn } from "../providers/snyk/graph-columns";
import type { SnykScanResult } from "../providers/snyk/types";
import { formatRelativeDate } from "../utils/date";
import { scheduleScrollIntoView, scrollElementIntoView } from "../utils/scroll";
import { cellWidth } from "../utils/terminal-text";
import Badge from "./badge";

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
 * Provider columns grow to fit their chips (`graphColumnWidths`), but only into room beyond the subject's minimum;
 * past that they keep their base widths (chips then clip) rather than squeezing the subject out.
 */
function budgetedColumnWidths(
  view: ProviderView,
  badges: ReadonlyMap<string, GraphBadge>,
  terminalWidth: number,
  graphWidth: number,
): GraphColumnWidths {
  const wanted = graphColumnWidths(view, badges);
  const base = graphColumnWidths(view, NO_BADGES);
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
  const isProviderView = () => state.activeProviderView() !== "git";
  const dimensions = useTerminalDimensions();

  const { graphWidth } = useGraphDimensions(() => state.maxGraphColumns());
  const columnWidths = () =>
    budgetedColumnWidths(state.activeProviderView(), state.graphBadges(), dimensions().width, graphWidth());

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
        {isProviderView() ? (
          state.activeProviderView() === "openshift" ? (
            <OpenShiftColumnHeaders {...columnWidths()} />
          ) : state.activeProviderView() === "snyk" ? (
            <SnykColumnHeaders {...columnWidths()} />
          ) : (
            <ActionsColumnHeaders {...columnWidths()} />
          )
        ) : (
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
        )}
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
    rowRef?: (el: Renderable) => void;
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
    snykGetCommitData?: (sha: string) => SnykScanResult | null;
    snykIsScanning?: (sha: string) => boolean;
  }>,
) {
  const t = useT();
  const { state } = useAppState();

  const [hovered, setHovered] = createSignal(false);
  /** Provider columns grow to fit their widest chips (within budget); header, row and subject width share these. */
  const columnWidths = () =>
    budgetedColumnWidths(state.activeProviderView(), state.graphBadges(), props.terminalWidth(), graphWidth());

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

  // Ref sort order: tag=0, branch=1, remote=2, head=3 (hoisted to module scope). In the OpenShift view the
  // namespaces running this commit follow the refs, in the OpenShift colour.
  const visibleRefs = createMemo((): RowBadge[] => {
    const allRefs = commit().refs;
    const refs: RowBadge[] = [...allRefs].sort((a, b) => (REF_SORT_ORDER[a.type] ?? 9) - (REF_SORT_ORDER[b.type] ?? 9));
    if (state.activeProviderView() !== "openshift") return refs;
    const markers = lookupOpenShiftBadge(state.graphBadges(), commit().hash)?.namespaces ?? [];
    return [
      ...refs,
      // By name only: whether it is ready, rolling out or failing shows in the Live counts and the details.
      ...markers.map(marker => ({ name: marker.namespace, isCurrent: false, namespace: true })),
    ];
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
      ref={(el: Renderable) => props.rowRef?.(el)}
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

        {/* Author / Date — replaced by CI columns when in CI view */}
        {state.activeProviderView() === "openshift" ? (
          <>
            <OpenShiftCountsColumn
              badge={lookupOpenShiftBadge(state.graphBadges(), commit().hash)}
              lane="live"
              active={props.active}
              dimmed={isDimmed()}
              width={columnWidths().first}
            />
            <OpenShiftCountsColumn
              badge={lookupOpenShiftBadge(state.graphBadges(), commit().hash)}
              lane="cache"
              active={props.active}
              dimmed={isDimmed()}
              width={columnWidths().second}
            />
          </>
        ) : state.activeProviderView() === "snyk" ? (
          <>
            <SnykCountsColumn
              scan={props.snykGetCommitData?.(commit().hash) ?? null}
              active={props.active}
              dimmed={isDimmed()}
              width={columnWidths().first}
            />
            <SnykScanColumn
              scan={props.snykGetCommitData?.(commit().hash) ?? null}
              scanning={!isUncommitted() && (props.snykIsScanning?.(commit().hash) ?? false)}
              active={props.active}
              dimmed={isDimmed()}
              width={columnWidths().second}
            />
          </>
        ) : state.activeProviderView() !== "git" ? (
          <>
            <ActionsCountsColumn
              badge={state.graphBadges().get(commit().hash)}
              active={props.active}
              dimmed={isDimmed()}
              width={columnWidths().first}
            />
            <ActionsDateColumn
              badge={state.graphBadges().get(commit().hash)}
              active={props.active}
              dimmed={isDimmed()}
              width={columnWidths().second}
            />
          </>
        ) : (
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
        )}
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
    snykGetCommitData?: (sha: string) => SnykScanResult | null;
    snykIsScanning?: (sha: string) => boolean;
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

  // Refs for programmatic scroll-into-view
  let scrollboxRef: ScrollBoxRenderable | undefined;
  const rowRefs: Renderable[] = [];
  const scrollSchedule: { scrollTimer?: ReturnType<typeof setTimeout> } = {};
  let lastScrollIndex = -1;

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

  /** Scroll a row at `idx` into view within the scrollbox. */
  const scrollRowIntoView = (idx: number) => {
    const direction: -1 | 0 | 1 = idx > lastScrollIndex ? 1 : idx < lastScrollIndex ? -1 : 0;
    lastScrollIndex = idx;
    scheduleScrollIntoView(scrollSchedule, () => {
      const sb = scrollboxRef;
      const rowEl = rowRefs[idx];
      if (!sb || !rowEl) return false;
      return scrollElementIntoView(sb, rowEl, 1, direction);
    });
  };

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
      const rows = state.graphRows();
      const idx = rows.findIndex(r => r.commit.hash === hash);
      if (idx < 0) {
        actions.setPendingScrollHash(null);
        return;
      }
      const rowEl = rowRefs[idx];
      if (rowEl && rowEl.getComputedLayout().height > 0) {
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

  /**
   * OpenShift: namespaces that run a commit the graph does not show (older than the loaded history, or filtered out),
   * named at the end of the graph since they have no row to carry the badge.
   */
  const unseenDeployments = createMemo(() => {
    if (state.activeProviderView() !== "openshift") return null;
    const shown = new Set(state.commits().map(commit => commit.hash.toLowerCase()));
    const parts: string[] = [];
    for (const [sha, badge] of state.graphBadges()) {
      if (!badge.namespaces || shown.has(sha.toLowerCase())) continue;
      for (const marker of badge.namespaces) parts.push(`${marker.namespace} runs ${sha.slice(0, 7)}`);
    }
    return parts.length > 0 ? `Not in the graph: ${parts.join(", ")}` : null;
  });

  return (
    <scrollbox
      ref={el => {
        scrollboxRef = el;
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
          <For each={state.graphRows()}>
            {(row, index) => {
              // Capture the element ref so we can reactively update rowRefs
              // when <For> reindexes this element (e.g. after data reload).
              // Ref callbacks only fire on creation; this effect re-runs
              // whenever index() changes, keeping rowRefs in sync.
              let elRef: Renderable | undefined;
              createEffect(() => {
                if (elRef) rowRefs[index()] = elRef;
              });
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
                  snykGetCommitData={props.snykGetCommitData}
                  snykIsScanning={props.snykIsScanning}
                  rowRef={el => {
                    elRef = el;
                    rowRefs[index()] = el;
                  }}
                />
              );
            }}
          </For>
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
