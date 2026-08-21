import { Show } from "solid-js";
import { AUTHOR_COL_WIDTH, DATE_COL_WIDTH, UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { useAppState } from "../../context/state";
import { useT } from "../../hooks/use-t";
import type { GraphBadge } from "../provider";

interface OpenShiftGraphColumnProps {
  badge: GraphBadge | undefined;
  active: boolean;
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

export function OpenShiftStatusColumn(props: Readonly<OpenShiftGraphColumnProps>) {
  const t = useT();
  const status = () => {
    switch (props.badge?.badge) {
      case "pass":
        return { label: "PASS", fg: t().background, bg: t().success };
      case "fail":
        return { label: "FAIL", fg: t().background, bg: t().error };
      case "running":
        return { label: "RUN", fg: t().background, bg: t().accent };
      case "unknown":
        return { label: "?", fg: t().foreground, bg: t().backgroundElementActive };
      default:
        return null;
    }
  };

  return (
    <box flexShrink={0} width={DATE_COL_WIDTH} overflow="hidden" flexDirection="row">
      <Show
        when={status()}
        fallback={
          <text fg={t().foregroundMuted} wrapMode="none" truncate>
            {UNCOMMITTED_PLACEHOLDER}
          </text>
        }
      >
        {value => (
          <text flexShrink={0} wrapMode="none" fg={value().fg} bg={value().bg}>
            {` ${value().label} `}
          </text>
        )}
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
          <strong>Status</strong>
        </text>
      </box>
    </>
  );
}
