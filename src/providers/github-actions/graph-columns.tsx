/**
 * GitHub Actions graph columns.
 *
 * When `activeProviderView === "github-actions"` these two components replace
 * the Author and Date columns in the graph row / column header:
 *
 *   Column 1 (AUTHOR_COL_WIDTH = 15 chars): CI run count blocks
 *     Fail count with red bg, running with accent bg, pass with green bg.
 *     Zero counts are skipped. E.g. " 2 " red bg · " 1 " accent bg · " 3 " green bg.
 *
 *   Column 2 (DATE_COL_WIDTH = 15 chars): Latest run relative time / status
 *     Coloured by the latest run status (error/accent/success/muted).
 */

import { For } from "solid-js";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH, UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import { useT } from "../../hooks/use-t";
import type { GraphBadge } from "../provider";

interface CICountsProps {
  badge: GraphBadge | undefined;
  active: boolean;
}

/** Render coloured run-count blocks in the author column. */
export function CICountsColumn(props: Readonly<CICountsProps>) {
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
        if (b.failCount > 0) blocks.push({ count: b.failCount, fg: t().background, bg: t().error });
        if (b.runningCount > 0) blocks.push({ count: b.runningCount, fg: t().background, bg: t().accent });
        if (b.passCount > 0) blocks.push({ count: b.passCount, fg: t().background, bg: t().success });

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

interface CIDateProps {
  badge: GraphBadge | undefined;
  active: boolean;
}

/** Render the latest-run relative time in the date column, coloured by status. */
export function CIDateColumn(props: Readonly<CIDateProps>) {
  const t = useT();

  const statusColor = (status: GraphBadge["latestStatus"]): string => {
    switch (status) {
      case "pass":
        return t().success;
      case "fail":
        return t().error;
      case "running":
        return t().accent;
      default:
        return t().foregroundMuted;
    }
  };

  return (
    <box flexShrink={0} width={DATE_COL_WIDTH} overflow="hidden">
      {(() => {
        const b = props.badge;
        if (!b) {
          return (
            <text fg={t().foregroundMuted} wrapMode="none" truncate>
              {UNCOMMITTED_PLACEHOLDER}
            </text>
          );
        }
        const color = statusColor(b.latestStatus);
        const label = b.latestStatus === "running" ? "running" : b.latestRunAt;
        if (props.active) {
          return (
            <text fg={color} wrapMode="none" truncate>
              <strong>
                <span fg={color}>{label}</span>
              </strong>
            </text>
          );
        }
        return (
          <text fg={color} wrapMode="none" truncate>
            {label}
          </text>
        );
      })()}
    </box>
  );
}

/** Column headers for CI mode (replaces Author / Date headers). */
export function CIColumnHeaders() {
  const { state } = useAppState();
  const t = useT();
  const leftPanelFocused = () => !state.detailFocused();
  const color = () => (leftPanelFocused() ? t().accent : t().foregroundMuted);

  return (
    <>
      <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>CI Runs</strong>
        </text>
      </box>
      <box flexShrink={0} width={DATE_COL_WIDTH}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>CI Status</strong>
        </text>
      </box>
    </>
  );
}
