import { createMemo, For } from "solid-js";
import { UNCOMMITTED_PLACEHOLDER } from "../../constants";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import type { GraphStatusCounts } from "../provider";
import { statusColor } from "./status";

/** One coloured count block in a provider graph column, rendered as ` text `. */
export interface StatusChip {
  text: string;
  fg: string;
  bg: string;
}

type ChipKind = "fail" | "running" | "neutral" | "pass";

/** Non-zero counts in display order: fail, running, neutral (cancelled, skipped, unknown), pass. */
function countEntries(counts: GraphStatusCounts | undefined): { kind: ChipKind; count: number }[] {
  if (!counts) return [];
  return [
    { kind: "fail" as const, count: counts.failCount },
    { kind: "running" as const, count: counts.runningCount },
    { kind: "neutral" as const, count: counts.unknownCount },
    { kind: "pass" as const, count: counts.passCount },
  ].filter(entry => entry.count > 0);
}

/** Status-count chips for CI runs and runtime resources, in the shared status colours. */
export function statusCountChips(theme: Theme, counts: GraphStatusCounts | undefined): StatusChip[] {
  return countEntries(counts).map(({ kind, count }) => ({
    text: String(count),
    fg: kind === "neutral" ? theme.foreground : theme.background,
    bg: kind === "neutral" ? theme.backgroundElementActive : statusColor(theme, kind),
  }));
}

/** Columns the chips take: ` text ` each, one column between chips. */
export function chipsWidth(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + text.length + 2, 0) + Math.max(0, texts.length - 1);
}

/** Width of the chips `statusCountChips` would draw for these counts (theme-independent). */
export function statusCountChipsWidth(counts: GraphStatusCounts | undefined): number {
  return chipsWidth(countEntries(counts).map(entry => String(entry.count)));
}

/**
 * A provider graph column of count chips. Dimmed rows (search, path, ancestry, uncommitted) mute the chips like the
 * Git columns; the selected row draws them bold. No chips shows the placeholder.
 */
export function StatusChips(
  props: Readonly<{
    chips: StatusChip[];
    width: number;
    paddingRight?: number;
    active: boolean;
    dimmed: boolean;
    placeholder?: string;
  }>,
) {
  const t = useT();
  // Full chips (` 12 `) when they fit; otherwise compact (`12`); otherwise as many as fit and a muted `…`, so a
  // tight column never drops a count without saying so.
  const layout = createMemo(() => {
    const available = props.width - (props.paddingRight ?? 0);
    const texts = props.chips.map(chip => chip.text);
    const total = (padding: number) =>
      texts.reduce((sum, text) => sum + text.length + padding, 0) + Math.max(0, texts.length - 1);
    if (total(2) <= available) return { padded: true, count: texts.length };
    if (total(0) <= available) return { padded: false, count: texts.length };
    let used = 2; // " …"
    let count = 0;
    for (const text of texts) {
      const next = text.length + (count > 0 ? 1 : 0);
      if (used + next > available) break;
      used += next;
      count++;
    }
    return { padded: false, count };
  });
  return (
    <box
      flexShrink={0}
      width={props.width}
      paddingRight={props.paddingRight ?? 0}
      overflow="hidden"
      flexDirection="row"
      gap={1}
    >
      {props.chips.length === 0 ? (
        <text fg={t().foregroundMuted} wrapMode="none">
          {props.placeholder ?? UNCOMMITTED_PLACEHOLDER}
        </text>
      ) : (
        <>
          <For each={props.chips.slice(0, layout().count)}>
            {chip => {
              const fg = () => (props.dimmed ? t().foregroundMuted : chip.fg);
              const bg = () => (props.dimmed ? t().backgroundElementActive : chip.bg);
              const label = () => (layout().padded ? ` ${chip.text} ` : chip.text);
              return (
                <box flexShrink={0} height={1} backgroundColor={bg()}>
                  <text flexShrink={0} wrapMode="none" fg={fg()} bg={bg()}>
                    {props.active ? <strong>{label()}</strong> : label()}
                  </text>
                </box>
              );
            }}
          </For>
          {layout().count < props.chips.length ? (
            <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              …
            </text>
          ) : null}
        </>
      )}
    </box>
  );
}

/** Text colour for provider text columns (dates, scan times), matching the Git author/date columns. */
export function providerTextColor(theme: Theme, active: boolean, dimmed: boolean): string {
  if (dimmed) return theme.foregroundMuted;
  return active ? theme.accent : theme.foregroundMuted;
}
