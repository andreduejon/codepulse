import { For, Show, createEffect } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import { renderGraphRow, renderConnectorRow, graphCharsToContent, getColorForColumn } from "../git/graph";
import type { GraphRow, RefInfo } from "../git/types";
import type { TextRenderable, StyledText } from "@opentui/core";

function RefBadge(props: { info: RefInfo; laneColor: () => string }) {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <text flexShrink={0} wrapMode="none" fg={t().background} bg={props.laneColor()}>
      {` ${props.info.name} `}
    </text>
  );
}

function ColumnHeader() {
  const { theme } = useTheme();
  const { state } = useAppState();
  const t = () => theme();

  // Graph column width: each graph column is 2 chars + 1 paddingLeft
  const graphWidth = () => Math.max(state.maxGraphColumns() * 2 + 1, 6);

  return (
    <box
      flexDirection="row"
      width="100%"
      border={["bottom"]}
      borderColor={t().border}
      borderStyle="single"
    >
      {/* Graph header */}
      <text
        flexShrink={0}
        width={graphWidth()}
        wrapMode="none"
        fg={t().foregroundMuted}
        paddingLeft={1}
      >
        Graph
      </text>

      {/* Description (commit message + refs) */}
      <text flexGrow={1} flexShrink={1} fg={t().foregroundMuted} wrapMode="none" truncate>
        Description
      </text>

      {/* Commit hash */}
      <text
        flexShrink={0}
        fg={t().foregroundMuted}
        wrapMode="none"
        paddingLeft={1}
      >
        Commit
      </text>

      {/* Author */}
      <text
        flexShrink={0}
        fg={t().foregroundMuted}
        wrapMode="none"
        paddingLeft={2}
        width={18}
      >
        Author
      </text>

      {/* Date */}
      <text
        flexShrink={0}
        fg={t().foregroundMuted}
        wrapMode="none"
        paddingRight={1}
        width={16}
      >
        Date
      </text>
    </box>
  );
}

/**
 * Connector row component. Uses its own ref + createEffect to ensure
 * the StyledText content is set after the element is mounted.
 */
function ConnectorRow(props: { content: () => StyledText }) {
  let textRef: TextRenderable | undefined;

  createEffect(() => {
    if (textRef) textRef.content = props.content();
  });

  return (
    <box flexDirection="row" width="100%">
      <text ref={textRef} flexShrink={0} wrapMode="none" truncate paddingLeft={1} />
    </box>
  );
}

function GraphLine(props: { row: GraphRow; index: number; selected: boolean; isLast: boolean }) {
  const { theme } = useTheme();
  const { state } = useAppState();

  const commit = () => props.row.commit;
  const padCols = () => state.maxGraphColumns();

  // Focus mode: compute render options with dim colors for non-current-branch lanes.
  // The current branch's lane lines (│) stay colored on ALL rows so you can
  // visually trace the branch path through the graph, even when non-current-branch
  // commits appear in between. Only the node dot is dimmed via isNodeFocused.
  // All focused-branch elements use a single consistent color (the tip column's color).
  const focusBranchColor = () =>
    getColorForColumn(props.row.currentBranchTipColumn, theme().graphColors);

  const renderOpts = () => {
    const base = {
      themeColors: theme().graphColors,
      padToColumns: padCols(),
    };
    if (state.focusCurrentBranch()) {
      return {
        ...base,
        focusMode: true,
        dimColor: theme().foregroundMuted,
        focusBranchColor: focusBranchColor(),
        isNodeFocused: props.row.isOnCurrentBranch,
      };
    }
    return base;
  };

  const graphChars = () => renderGraphRow(props.row, renderOpts());
  const connectorChars = () => renderConnectorRow(props.row, renderOpts());

  const graphContent = () => graphCharsToContent(graphChars());
  const connectorContent = () => graphCharsToContent(connectorChars());

  // Use refs to set StyledText content directly on TextRenderable,
  // bypassing the Solid reconciler which stringifies the content prop.
  let graphTextRef: TextRenderable | undefined;

  createEffect(() => {
    if (graphTextRef) graphTextRef.content = graphContent();
  });

  // Sort order: tag=0, branch=1, remote=2, head=3
  const REF_ORDER: Record<string, number> = { tag: 0, branch: 1, remote: 2, head: 3 };

  const visibleRefs = () => {
    const allRefs = commit().refs;
    const filtered = state.showTags() ? allRefs : allRefs.filter((r) => r.type !== "tag");
    return [...filtered].sort((a, b) => (REF_ORDER[a.type] ?? 9) - (REF_ORDER[b.type] ?? 9));
  };
  const laneColor = () => getColorForColumn(props.row.nodeColumn, theme().graphColors);
  const t = () => theme();

  // Is this commit on the current branch? (for focus mode dimming)
  const isOnCurrentBranch = () => props.row.isOnCurrentBranch;

  // Effective lane color for ref badges: single focus color if on current branch, dimmed otherwise
  const effectiveLaneColor = () => {
    if (state.focusCurrentBranch() && !isOnCurrentBranch()) {
      return t().foregroundMuted;
    }
    if (state.focusCurrentBranch() && isOnCurrentBranch()) {
      return focusBranchColor();
    }
    return laneColor();
  };

  // Effective text color: dimmed if focus mode is on and commit not on current branch
  const effectiveTextColor = () => {
    if (state.focusCurrentBranch() && !isOnCurrentBranch()) {
      return t().foregroundMuted;
    }
    return t().foreground;
  };

  return (
    <box flexDirection="column" width="100%">
      {/* Commit row */}
      <box
        flexDirection="row"
        width="100%"
        backgroundColor={props.selected ? t().backgroundElement : undefined}
      >
        {/* Graph part: styled via ref + StyledText to bypass reconciler stringification */}
        <text ref={graphTextRef} flexShrink={0} wrapMode="none" truncate paddingLeft={1} />

        {/* Description: refs + commit message share one flex area */}
        <box flexDirection="row" flexGrow={1} flexShrink={1}>
          <Show when={visibleRefs().length > 0}>
            <box flexDirection="row" flexShrink={0} gap={1}>
              <For each={visibleRefs()}>
                {(ri) => <RefBadge info={ri} laneColor={effectiveLaneColor} />}
              </For>
            </box>
          </Show>
          <text flexGrow={1} flexShrink={1} fg={effectiveTextColor()} wrapMode="none" truncate>
            {" "}
            {commit().subject}
          </text>
        </box>

        {/* Short hash */}
        <text
          flexShrink={0}
          fg={props.selected ? t().primary : t().foregroundMuted}
          wrapMode="none"
          truncate
          paddingLeft={1}
        >
          {commit().shortHash}
        </text>

        {/* Author */}
        <text
          flexShrink={0}
          fg={t().foregroundMuted}
          wrapMode="none"
          truncate
          paddingLeft={2}
          width={18}
        >
          {commit().author}
        </text>

        {/* Branch (debug) */}
        <text
          flexShrink={0}
          fg={effectiveTextColor()}
          wrapMode="none"
          truncate
          paddingLeft={1}
          width={20}
        >
          {props.row.branchName}
        </text>

        {/* Date */}
        <text
          flexShrink={0}
          fg={t().foregroundMuted}
          wrapMode="none"
          truncate
          paddingRight={1}
          width={16}
        >
          {formatRelativeDate(commit().authorDate)}
        </text>
      </box>

      {/* Connector row: vertical lines only, providing visual continuity */}
      <Show when={!props.isLast}>
        <ConnectorRow content={connectorContent} />
      </Show>
    </box>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffHours < 1) return `${diffMins}m ago`;
  if (diffDays < 1) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${day}. ${month} ${year}`;
}

export default function GraphView() {
  const { state } = useAppState();

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Column headers */}
      <ColumnHeader />

      <Show
        when={!state.loading()}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg="#89b4fa">Loading commits...</text>
          </box>
        }
      >
        <For each={state.filteredRows()}>
          {(row, index) => (
            <GraphLine
              row={row}
              index={index()}
              selected={index() === state.selectedIndex()}
              isLast={index() === state.filteredRows().length - 1}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
