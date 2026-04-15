import { getColorForColumn } from "../git/graph";
import { useT } from "../hooks/use-t";
import { truncateName } from "../utils/truncate";

/**
 * Unified colored badge component used across the app for branch names,
 * tag names, and other ref labels.
 *
 * Supports two truncation strategies (mutually exclusive):
 * - `maxLength`: static end-truncation via `truncateName()` — for graph ref
 *   badges and menu badges where the display is not interactive.
 * - `visibleWidth` + `bannerOffset`: sliding-window banner scroll — for detail
 *   panel badges where the cursored item can scroll long names.
 *
 * Color is resolved either from a graph column index (`colorIndex`) or from a
 * direct color string (`color`), allowing both graph-colored and fixed-color uses.
 */
export default function Badge(
  props: Readonly<{
    name: string;
    /** Graph column color index — used with `getColorForColumn`. Ignored if `color` is set. */
    colorIndex?: number;
    /** Direct resolved color string — skips `getColorForColumn` lookup (e.g. graph lane color). */
    color?: string;
    /** When true, renders with muted colors to visually recede. */
    dimmed?: boolean;
    /** Static end-truncation: cap name at N chars with `...` suffix. */
    maxLength?: number;
    /** Banner-scroll truncation: visible window width in chars. */
    visibleWidth?: number;
    /** Banner-scroll offset (chars from the start of name). */
    bannerOffset?: number;
    /** When true, the badge refuses to shrink (use in flex rows). */
    noShrink?: boolean;
  }>,
) {
  const t = useT();

  const bgColor = () => {
    if (props.dimmed) return t().backgroundElementActive;
    if (props.color) return props.color;
    return getColorForColumn(props.colorIndex ?? 0, t().graphColors);
  };

  const fgColor = () => (props.dimmed ? t().foregroundMuted : t().background);

  const displayName = () => {
    const name = props.name;
    // Banner scroll takes priority over static truncation
    const w = props.visibleWidth;
    if (w != null) {
      if (name.length <= w) return name;
      const off = props.bannerOffset ?? 0;
      return name.substring(off, off + w);
    }
    // Static end-truncation
    if (props.maxLength != null) return truncateName(name, props.maxLength);
    return name;
  };

  return (
    <text flexShrink={props.noShrink ? 0 : undefined} wrapMode="none" fg={fgColor()} bg={bgColor()}>
      {` ${displayName()} `}
    </text>
  );
}
