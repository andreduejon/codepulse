import { For, Show } from "solid-js";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH, UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import { useT } from "../../hooks/use-t";
import type { GraphBadge } from "../provider";

interface OpenShiftGraphColumnProps {
  badge: GraphBadge | undefined;
  active: boolean;
}

function NumberBadge(props: Readonly<{ count: number; bg: string; fg: string }>) {
  return (
    <text flexShrink={0} wrapMode="none" fg={props.fg} bg={props.bg}>
      {` ${props.count} `}
    </text>
  );
}

export function OpenShiftResourcesColumn(props: Readonly<OpenShiftGraphColumnProps>) {
  const count = () => {
    const badge = props.badge;
    if (!badge) return 0;
    return badge.resourceCount ?? badge.passCount + badge.failCount + badge.runningCount + (badge.unknownCount ?? 0);
  };
  return (
    <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2} overflow="hidden" flexDirection="row">
      <ShowResource count={count()} active={props.active} />
    </box>
  );
}

function ShowResource(props: Readonly<{ count: number; active: boolean }>) {
  const t = useT();
  if (props.count <= 0) {
    return (
      <text fg={t().foregroundMuted} wrapMode="none">
        {UNCOMMITTED_PLACEHOLDER}
      </text>
    );
  }
  return (
    <text fg={props.active ? t().accent : t().foregroundMuted} wrapMode="none">
      {props.count}
    </text>
  );
}

export function OpenShiftHealthColumn(props: Readonly<OpenShiftGraphColumnProps>) {
  const t = useT();
  const blocks = () => {
    const b = props.badge;
    if (!b) return [];
    const knownCount = b.passCount + b.failCount + b.runningCount;
    const unknownCount = b.unknownCount ?? Math.max(0, (b.resourceCount ?? knownCount) - knownCount);
    return [
      { count: b.passCount, fg: t().background, bg: t().success },
      { count: b.failCount, fg: t().background, bg: t().error },
      { count: b.runningCount, fg: t().background, bg: t().accent },
      { count: unknownCount, fg: t().foreground, bg: t().backgroundElementActive },
    ].filter(block => block.count > 0);
  };

  return (
    <box flexShrink={0} width={DATE_COL_WIDTH} overflow="hidden" flexDirection="row" gap={1}>
      <Show
        when={blocks().length > 0}
        fallback={
          <text fg={t().foregroundMuted} wrapMode="none" truncate>
            {UNCOMMITTED_PLACEHOLDER}
          </text>
        }
      >
        <For each={blocks()}>{block => <NumberBadge count={block.count} fg={block.fg} bg={block.bg} />}</For>
      </Show>
    </box>
  );
}

export function OpenShiftColumnHeaders() {
  const { state } = useAppState();
  const t = useT();
  const leftPanelFocused = () => !state.detailFocused();
  const color = () => (leftPanelFocused() ? t().accent : t().foregroundMuted);

  return (
    <>
      <box flexShrink={0} width={AUTHOR_COL_WIDTH} paddingRight={2}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Resources</strong>
        </text>
      </box>
      <box flexShrink={0} width={DATE_COL_WIDTH}>
        <text wrapMode="none" truncate fg={color()}>
          <strong>Health</strong>
        </text>
      </box>
    </>
  );
}
