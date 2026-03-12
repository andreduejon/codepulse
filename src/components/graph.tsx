import { For, Show } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import { renderGraphRow } from "../git/graph";
import type { GraphRow } from "../git/types";

function GraphLine(props: { row: GraphRow; index: number; selected: boolean }) {
  const { theme } = useTheme();

  const graphChars = () => renderGraphRow(props.row);
  const commit = () => props.row.commit;
  const refs = () => commit().refs;
  const t = () => theme();

  return (
    <box
      flexDirection="row"
      width="100%"
      backgroundColor={props.selected ? t().backgroundElement : undefined}
      paddingLeft={1}
    >
      {/* Graph part */}
      <text flexShrink={0} wrapMode="none" truncate>
        <For each={graphChars()}>
          {(gc) => <span fg={gc.color}>{gc.char}</span>}
        </For>
      </text>

      {/* Short hash */}
      <text
        flexShrink={0}
        fg={props.selected ? t().primary : t().foregroundMuted}
        wrapMode="none"
        truncate
      >
        {commit().shortHash}
      </text>

      {/* Refs (branch names, tags) */}
      <Show when={refs().length > 0}>
        <text flexShrink={0} wrapMode="none" truncate>
          {" "}
          <For each={refs()}>
            {(ref, i) => (
              <>
                <span
                  fg={
                    ref.type === "tag"
                      ? t().warning
                      : ref.type === "head"
                        ? t().accent
                        : ref.isCurrent
                          ? t().success
                          : ref.type === "remote"
                            ? t().foregroundMuted
                            : t().primary
                  }
                >
                  {ref.type === "tag" ? `[${ref.name}]` : `(${ref.name})`}
                </span>
                <Show when={i() < refs().length - 1}>
                  <span fg={t().foregroundMuted}> </span>
                </Show>
              </>
            )}
          </For>
        </text>
      </Show>

      {/* Commit message */}
      <text flexGrow={1} flexShrink={1} fg={t().foreground} wrapMode="none" truncate>
        {" "}
        {commit().subject}
      </text>

      {/* Author and date */}
      <text
        flexShrink={0}
        fg={t().foregroundMuted}
        wrapMode="none"
        truncate
        paddingRight={1}
      >
        {" "}
        {commit().author} {formatRelativeDate(commit().authorDate)}
      </text>
    </box>
  );
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
}

export default function GraphView() {
  const { state } = useAppState();

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
            />
          )}
        </For>
      </Show>
    </box>
  );
}
