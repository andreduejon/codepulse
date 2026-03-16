import { For, Show, createEffect } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import { renderGraphRow, renderConnectorRow, renderFanOutRow, graphCharsToContent, getColorForColumn } from "../git/graph";
import type { GraphRow, RefInfo } from "../git/types";
import type { TextRenderable, StyledText } from "@opentui/core";

function RefBadge(props: {
  info: RefInfo;
  laneColor: () => string;
  dimColor: () => string;
  remoteOnlyBranches: Set<string>;
}) {
  const { theme } = useTheme();
  const { state } = useAppState();
  const t = () => theme();

  // Remote-only branches (no local counterpart) use dimmed color,
  // but only when dim remote-only setting is enabled.
  // Locally-tracked remotes (e.g. origin/main when main exists) and
  // origin/HEAD use the same lane color as local branches — no border,
  // no accent, completely identical styling.
  const isRemoteOnly = () => {
    if (!state.dimRemoteOnly()) return false;
    if (props.info.type !== "remote") return false;
    // origin/HEAD is never remote-only (it tracks whatever local branch exists)
    if (props.info.name.endsWith("/HEAD")) return false;
    return props.remoteOnlyBranches.has(props.info.name);
  };

  const bgColor = () => isRemoteOnly() ? props.dimColor() : props.laneColor();

  // When the badge bg is a dim/muted color, use foreground for readable label text.
  // When badge has a vivid lane color bg, use the dark background color for contrast.
  // Check both badge-level dimming (isRemoteOnly) and row-level dimming (laneColor = dimColor).
  const isDimBadge = () => isRemoteOnly() || props.laneColor() === props.dimColor();
  const fgColor = () => isDimBadge() ? t().foreground : t().background;

  return (
    <text flexShrink={0} wrapMode="none" fg={fgColor()} bg={bgColor()}>
      {` ${props.info.name} `}
    </text>
  );
}

export function ColumnHeader() {
  const { theme } = useTheme();
  const { state } = useAppState();
  const t = () => theme();

  // Graph column width: each graph column is 2 chars + 1 paddingLeft
  const graphWidth = () => Math.max(state.maxGraphColumns() * 2 + 1, 6);

  return (
    <box
      flexDirection="row"
      width="100%"
      paddingBottom={1}
    >
      {/* Graph header */}
      <text
        flexShrink={0}
        width={graphWidth()}
        wrapMode="none"
        fg={t().foregroundMuted}
        paddingLeft={1}
      >
        {"Graph "}
      </text>

      {/* Description (commit message + refs) — box wrapper matches data row structure */}
      <box flexDirection="row" flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={2}>
        <text flexGrow={1} flexShrink={1} fg={t().foregroundMuted} wrapMode="none" truncate>
          Description
        </text>
      </box>

      {/* Author */}
      <Show when={state.showAuthorColumn()}>
        <box flexShrink={0} width={15} paddingRight={2}>
          <text fg={t().foregroundMuted} wrapMode="none" truncate>
            Author
          </text>
        </box>
      </Show>

      {/* Date */}
      <Show when={state.showDateColumn()}>
        <box flexShrink={0} width={15} paddingRight={2}>
          <text fg={t().foregroundMuted} wrapMode="none" truncate>
            Date
          </text>
        </box>
      </Show>

      {/* Commit hash */}
      <Show when={state.showHashColumn()}>
        <text flexShrink={0} width={8} fg={t().foregroundMuted} wrapMode="none" truncate>
          Commit
        </text>
      </Show>
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

function GraphLine(props: { row: GraphRow; index: number; selected: boolean; isLast: boolean; onSelect: (index: number) => void }) {
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
      remoteOnlyDimColor: state.dimRemoteOnly() ? theme().foregroundMuted : undefined,
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

  // Check if the commit row has merge/branch connectors (horizontals, corners, tees).
  // If so, the commit row carries connection info and can't be replaced by a fan-out row.
  const commitRowHasConnections = () =>
    props.row.connectors.some(c =>
      c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
      c.type === "corner-top-right" || c.type === "corner-top-left" ||
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
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

  // Fan-out rows ABOVE the commit row
  const fanOutAboveContents = () => {
    const foRows = props.row.fanOutRows;
    if (!foRows || foRows.length === 0) return [];
    // If merging last fan-out into commit row, show all except the last
    if (canMergeFanOut()) {
      if (foRows.length <= 1) return [];
      return foRows.slice(0, -1).map((foConnectors) =>
        graphCharsToContent(renderFanOutRow(foConnectors, renderOpts()))
      );
    }
    // Otherwise show all fan-out rows separately
    return foRows.map((foConnectors) =>
      graphCharsToContent(renderFanOutRow(foConnectors, renderOpts()))
    );
  };

  // The commit row graph: if we can merge, use the last fan-out row's graph;
  // otherwise use the normal commit row graph.
  const commitRowGraphContent = () => {
    if (canMergeFanOut()) {
      const foRows = props.row.fanOutRows!;
      return graphCharsToContent(renderFanOutRow(foRows[foRows.length - 1], renderOpts()));
    }
    return graphContent();
  };

  // Use refs to set StyledText content directly on TextRenderable,
  // bypassing the Solid reconciler which stringifies the content prop.
  let graphTextRef: TextRenderable | undefined;

  createEffect(() => {
    if (graphTextRef) graphTextRef.content = commitRowGraphContent();
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
    if (props.row.isRemoteOnly && state.dimRemoteOnly()) {
      return t().foregroundMuted;
    }
    return laneColor();
  };

  // Effective text color: dimmed if focus mode is on and commit not on current branch,
  // or if the commit is on a remote-only branch. Selected rows use foreground (bold applied separately).
  const effectiveTextColor = () => {
    if (props.selected) return t().foreground;
    if (state.focusCurrentBranch() && !isOnCurrentBranch()) {
      return t().foregroundMuted;
    }
    if (props.row.isRemoteOnly && state.dimRemoteOnly()) {
      return t().foregroundMuted;
    }
    return t().foreground;
  };

  return (
    <box flexDirection="column" width="100%">
      {/* Fan-out rows above the commit (all except the last, which merges
          into the commit row to avoid a redundant █ block). */}
      <For each={fanOutAboveContents()}>
        {(foContent) => <ConnectorRow content={() => foContent} />}
      </For>

      {/* Commit row */}
      <box
        flexDirection="row"
        width="100%"
        backgroundColor={props.selected ? t().backgroundElement : undefined}
        onMouseDown={() => props.onSelect(props.index)}
        onMouseMove={() => props.onSelect(props.index)}
      >
        {/* Graph part: styled via ref + StyledText to bypass reconciler stringification */}
        <text ref={graphTextRef} flexShrink={0} width={Math.max(padCols() * 2 + 1, 6)} wrapMode="none" truncate paddingLeft={1} />

        {/* Description: refs + commit message share one flex area */}
        <box flexDirection="row" flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={2}>
          <Show when={visibleRefs().length > 0}>
            <box flexDirection="row" flexShrink={0} gap={1} paddingRight={1}>
              <For each={visibleRefs()}>
                {(ri) => <RefBadge info={ri} laneColor={effectiveLaneColor} dimColor={() => t().foregroundMuted} remoteOnlyBranches={props.row.remoteOnlyBranches} />}
              </For>
            </box>
          </Show>
          <text flexGrow={1} flexShrink={1} fg={effectiveTextColor()} wrapMode="none" truncate>
            {props.selected ? <strong><span fg={effectiveTextColor()}>{commit().subject}</span></strong> : commit().subject}
          </text>
        </box>

        {/* Author */}
        <Show when={state.showAuthorColumn()}>
          <box flexShrink={0} width={15} paddingRight={2} overflow="hidden">
            <text fg={props.selected ? t().foreground : t().foregroundMuted} wrapMode="none" truncate>
              {props.selected ? <strong><span fg={t().foreground}>{commit().author}</span></strong> : commit().author}
            </text>
          </box>
        </Show>

        {/* Date */}
        <Show when={state.showDateColumn()}>
          <box flexShrink={0} width={15} paddingRight={2} overflow="hidden">
            <text fg={props.selected ? t().foreground : t().foregroundMuted} wrapMode="none" truncate>
              {props.selected ? <strong><span fg={t().foreground}>{formatRelativeDate(commit().authorDate)}</span></strong> : formatRelativeDate(commit().authorDate)}
            </text>
          </box>
        </Show>

        {/* Short hash */}
        <Show when={state.showHashColumn()}>
          <text flexShrink={0} width={8} fg={props.selected ? t().foreground : t().foregroundMuted} wrapMode="none" truncate>
            {props.selected ? <strong><span fg={t().foreground}>{commit().shortHash}</span></strong> : commit().shortHash}
          </text>
        </Show>
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

  const day = String(date.getDate()).padStart(2, "0");
  const month = MONTHS[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");

  // Same year → show time; different year → show year
  if (date.getFullYear() === now.getFullYear()) {
    return `${day}. ${month} ${hours}:${mins}`;
  }
  return `${day}. ${month} ${date.getFullYear()}`;
}

export default function GraphView() {
  const { state, actions } = useAppState();

  return (
    <box flexDirection="column" flexGrow={1}>
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
              onSelect={(i) => actions.setSelectedIndex(i)}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
