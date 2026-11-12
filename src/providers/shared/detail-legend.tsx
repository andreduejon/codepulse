import { For, Show } from "solid-js";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { statusColor, statusIcon } from "./status";

/** One legend entry: its markers, each in its own colour, then a muted label. */
export type LegendItem = [markers: [string, (theme: Theme) => string][], label: string];

/** The marks of a CI tree (GitHub runs, Jenkins builds). Each names a cancelled run its own way. */
export function runLegend(cancelled: "cancelled" | "aborted"): LegendItem[] {
  return (
    [
      ["pass", "passed"],
      ["running", "running"],
      ["fail", "failed"],
      ["skipped", "skipped"],
      ["cancelled", cancelled],
    ] as const
  ).map(([category, label]) => [[[statusIcon(category), theme => statusColor(theme, category)]], label]);
}

/** Tab legend; DetailPanel renders it sticky below the scroll area. Items wrap whole in narrow panels. */
export function DetailLegend(props: { items: readonly LegendItem[] }) {
  const t = useT();
  return (
    <box flexDirection="row" flexWrap="wrap" width="100%" flexShrink={0} justifyContent="flex-end">
      <For each={props.items}>
        {([markers, label], index) => (
          <box flexDirection="row" flexShrink={0}>
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
          </box>
        )}
      </For>
    </box>
  );
}
