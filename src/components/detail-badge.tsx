import { useTheme } from "../context/theme";
import { getColorForColumn } from "../git/graph";

/** Colored badge for branch/tag labels in the detail view */
export default function DetailBadge(props: Readonly<{
  name: string;
  colorIndex: number;
  dimmed?: boolean;
  /** When set, applies banner scroll: substring of name at [bannerOffset, bannerOffset+visibleWidth). */
  visibleWidth?: number;
  bannerOffset?: number;
}>) {
  const { theme } = useTheme();
  const t = () => theme();

  const bgColor = () => {
    if (props.dimmed) return t().backgroundElementActive;
    return getColorForColumn(props.colorIndex, t().graphColors);
  };

  const fgColor = () => {
    if (props.dimmed) return t().foreground;
    return t().background;
  };

  const displayName = () => {
    const w = props.visibleWidth;
    if (w == null || props.name.length <= w) return props.name;
    const off = props.bannerOffset ?? 0;
    return props.name.substring(off, off + w);
  };

  return (
    <text bg={bgColor()} fg={fgColor()} wrapMode="none">
      {` ${displayName()} `}
    </text>
  );
}
