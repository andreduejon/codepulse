import { useT } from "../hooks/use-t";

interface TotalLinesChangedRowProps {
  totalAdd: number;
  totalDel: number;
}

/**
 * A single summary row showing total added/removed lines for a diff.
 * Renders a muted label on the left and colored +/- counts on the right.
 */
export function TotalLinesChangedRow(props: Readonly<TotalLinesChangedRowProps>) {
  const t = useT();
  return (
    <box flexDirection="row">
      <box flexGrow={1}>
        <text fg={t().foregroundMuted} wrapMode="none">
          total lines changed
        </text>
      </box>
      <box flexShrink={0} width={2} />
      <box flexShrink={0} paddingLeft={1}>
        <text fg={t().diffAdded} wrapMode="none">
          +{props.totalAdd}
        </text>
      </box>
      <box flexShrink={0} paddingLeft={1}>
        <text fg={t().diffRemoved} wrapMode="none">
          -{props.totalDel}
        </text>
      </box>
    </box>
  );
}
