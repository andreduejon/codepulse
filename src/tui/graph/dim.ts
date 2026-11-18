/** Ancestry and search dimming applied to the rendered graph's characters (the bright columns are core's). */
import type { GraphChar } from "./render";

export interface DimOptions {
  /** Whether this row is the synthetic uncommitted-changes node. */
  isUncommitted: boolean;
  /** Whether ancestry highlighting is currently active. */
  ancestryActive: boolean;
  /** Column indices where │ passthroughs and █ nodes stay bright. */
  brightColumns?: Set<number>;
  /** Column indices where ─, corners, and tees stay bright (fan-out rows). */
  brightHorizontal?: Set<number>;
  /** Whether a non-ancestry highlight mode (search/path) is currently active.
   *  When true, graph chars are dimmed even on matching rows (only the commit
   *  node stays bright). */
  highlightActive: boolean;
  /** Whether this specific row is dimmed by the active highlight (not in match set).
   *  Only meaningful when highlightActive is true. When true, ALL graph chars are
   *  dimmed including the node. When false, all graph chars except the commit node
   *  at `nodeColumn` are dimmed. */
  highlightDimmed: boolean;
  /** The column index of this row's commit node (█ symbol). Used to keep the
   *  node bright on matching rows in search/path mode. */
  nodeColumn: number;
}

/**
 * Apply ancestry dimming to a rendered GraphChar[] array.
 *
 * Rules:
 *   - uncommitted node        → full dim always
 *   - ancestry inactive       → no dim (pass through)
 *   - bright set present      → char-position tracking: colIdx = floor(pos/2)
 *                               where pos accumulates char.length.
 *                               Vertical-bright cols keep │ and █ vivid.
 *                               Junction glyphs (┼, ├, ┤, ┬, ┴) on
 *                               vertical-bright columns are replaced with
 *                               │. The ─ that follows (always a separate
 *                               entry) is dimmed normally by the standard
 *                               bright-check logic.
 *                               Junctions on horizontal-bright (but NOT
 *                               vertical-bright) columns are replaced with
 *                               ─ (the vertical arm is removed).
 *                               Horizontal-bright cols keep ─ and corners
 *                               vivid.
 *   - no bright set           → full dim
 *
 * NOTE: array index ≠ column index because a single column can be split into
 * two 1-char entries. Char-position tracking is the only correct mapping:
 * column c occupies char positions [c*2, c*2+2).
 */
export function dimGraphChars(chars: GraphChar[], mutedColor: string, opts: DimOptions): GraphChar[] {
  if (opts.isUncommitted) return chars.map(c => ({ ...c, color: mutedColor, bold: false }));

  // Search/path highlight mode: dim graph chars uniformly (no per-column brightness).
  // Non-matching rows: dim everything including the node.
  // Matching rows: dim all graph chars EXCEPT the commit node at nodeColumn.
  if (opts.highlightActive) {
    if (opts.highlightDimmed) {
      // Non-matching row — dim everything
      return chars.map(c => ({ ...c, color: mutedColor, bold: false }));
    }
    // Matching row — dim all graph chars except the commit node (█) at nodeColumn
    let pos = 0;
    return chars.map(c => {
      const colIdx = Math.floor(pos / 2);
      pos += c.char.length;
      const isNode = colIdx === opts.nodeColumn && c.char[0] === "█";
      return isNode ? c : { ...c, color: mutedColor, bold: false };
    });
  }

  if (!opts.ancestryActive) return chars;

  const bright = opts.brightColumns;
  const hBright = opts.brightHorizontal;
  const hasBright = (bright && bright.size > 0) || (hBright && hBright.size > 0);

  if (hasBright) {
    let pos = 0;
    return chars.map((c, i) => {
      const colIdx = Math.floor(pos / 2);
      pos += c.char.length;
      const ch = c.char[0];

      // Vertical passthrough │ and node █ stay bright at vertical-bright columns.
      const isVerticalBright = bright?.has(colIdx) && (ch === "│" || ch === "█");

      // Junction glyphs (┼, ├, ┤, ┬, ┴) on vertical-bright columns are
      // replaced with │ — the horizontal arm through them is removed so the
      // ancestry line appears as a clean uninterrupted vertical line.
      // On horizontal-bright columns (but NOT vertical-bright), junctions are
      // replaced with ─ — the vertical arm is removed so the ancestry
      // horizontal connection appears as a clean line.
      const isJunction = ch === "┼" || ch === "├" || ch === "┤" || ch === "┬" || ch === "┴";
      const isJunctionOnVerticalAncestry = isJunction && bright?.has(colIdx);
      const isJunctionOnHorizontalAncestry = isJunction && !isJunctionOnVerticalAncestry && hBright?.has(colIdx);

      if (isJunctionOnVerticalAncestry) {
        // Replace junction glyph with │. All junctions are 1-char entries
        // (├ is always split from ─ in the renderer), so the separate ─
        // entry that follows will be dimmed normally by the rest of the logic.
        // ┤ renders as "┤ " (2-char with space) — slice(1) keeps the space.
        const replacement = `│${c.char.slice(1)}`;
        return { ...c, char: replacement, bold: true };
      }

      if (isJunctionOnHorizontalAncestry) {
        // Replace junction glyph with ─ (keep the horizontal arm, remove
        // the vertical). 2-char entries like "┤ " → "─ ".
        // The junction's original color is the vertical lane's color, which
        // is wrong for the replacement ─. Pick up the horizontal color from
        // the adjacent ─ entry (the next char in the array).
        const replacement = `─${c.char.slice(1)}`;
        const hColor = chars[i + 1]?.color ?? c.color;
        return { ...c, char: replacement, color: hColor };
      }

      // Horizontal glyphs (─, corners) stay bright at horizontal-bright columns.
      // Junctions not on the ancestry lane and │/█ are excluded.
      const isHorizontalBright = hBright?.has(colIdx) && !isJunction && ch !== "│" && ch !== "█";

      const isBright = isVerticalBright || isHorizontalBright;

      return isBright ? c : { ...c, color: mutedColor, bold: false };
    });
  }

  return chars.map(c => ({ ...c, color: mutedColor, bold: false }));
}
