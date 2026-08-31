/**
 * GitHub Actions graph columns.
 *
 * When `activeProviderView === "github-actions"` these two components replace
 * the Author and Date columns in the graph row / column header:
 *
 *   Column 1 (AUTHOR_COL_WIDTH = 15 chars): CI run count blocks
 *     Fail count with error bg, running with info bg, pass with success bg.
 *     Zero counts are skipped.
 *
 *   Column 2 (DATE_COL_WIDTH = 15 chars): Latest run relative time / status
 *     Coloured by latestStatus (error / info / success / muted).
 */

import { For } from "solid-js";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH, UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import { useT } from "../../hooks/use-t";
import { formatRelativeDate } from "../../utils/date";
import type { GraphBadge } from "../provider";
import { statusColor } from "../shared/status";

interface ActionsCountsProps {
  badge: GraphBadge | undefined;
  active: boolean;
}

/** Render coloured run-count blocks in the author column. */
export function ActionsCountsColumn(props: Readonly<ActionsCountsProps>) {
  const t = useT();

  return (
    <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2} overflow="hidden" flexDirection="row" gap={1}>
      {(() => {
        const b = props.badge;
        if (!b) {
          return (
            <text fg={t().foregroundMuted} wrapMode="none">
              {UNCOMMITTED_PLACEHOLDER}
            </text>
          );
        }

        const blocks: { count: number; fg: string; bg: string }[] = [];
        if (b.failCount > 0) blocks.push({ count: b.failCount, fg: t().background, bg: statusColor(t(), "fail") });
        if (b.runningCount > 0)
          blocks.push({ count: b.runningCount, fg: t().background, bg: statusColor(t(), "running") });
        if (b.passCount > 0) blocks.push({ count: b.passCount, fg: t().background, bg: statusColor(t(), "pass") });

        if (blocks.length === 0) {
          return (
            <text fg={t().foregroundMuted} wrapMode="none">
              {UNCOMMITTED_PLACEHOLDER}
            </text>
          );
        }

        return (
          <For each={blocks}>
            {block => (
              <text flexShrink={0} wrapMode="none" fg={block.fg} bg={block.bg}>
                {` ${block.count} `}
              </text>
            )}
          </For>
        );
      })()}
    </box>
  );
}

interface ActionsDateProps {
  badge: GraphBadge | undefined;
  active: boolean;
}

/** Render the latest-run date in the date column, in muted color. */
export function ActionsDateColumn(props: Readonly<ActionsDateProps>) {
  const t = useT();

  return (
    <box flexShrink={0} width={DATE_COL_WIDTH} overflow="hidden">
      {(() => {
        const b = props.badge;
        if (!b?.latestRunAt) {
          return (
            <text fg={t().foregroundMuted} wrapMode="none" truncate>
              {UNCOMMITTED_PLACEHOLDER}
            </text>
          );
        }
        const label = b.latestStatus === "running" ? "running" : formatRelativeDate(b.latestRunAt);
        const fg = statusColor(t(), b.latestStatus);
        if (props.active) {
          return (
            <text fg={fg} wrapMode="none" truncate>
              <strong>{label}</strong>
            </text>
          );
        }
        return (
          <text fg={fg} wrapMode="none" truncate>
            {label}
          </text>
        );
      })()}
    </box>
  );
}

/** Column headers for provider mode (replaces Author / Date headers). */
export function ActionsColumnHeaders() {
  const { state } = useAppState();
  const t = useT();
  const leftPanelFocused = () => !state.detailFocused();
  const color = () => (leftPanelFocused() ? t().accent : t().foregroundMuted);

  return (
    <>
      <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Status</strong>
        </text>
      </box>
      <box flexShrink={0} width={DATE_COL_WIDTH}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Last Run</strong>
        </text>
      </box>
    </>
  );
}
