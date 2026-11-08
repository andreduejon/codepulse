// CSI (colors, cursor moves), OSC (title, hyperlinks, clipboard), other ESC sequences, and C0 controls except tab/newline.
const TERMINAL_CONTROLS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose.
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]?|[\x00-\x08\x0b-\x1f\x7f]/g;

/** Remove terminal escape/control sequences from remote text (CI and pod logs) before display. */
export function stripTerminalControls(text: string): string {
  return text.replace(TERMINAL_CONTROLS, "");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Terminal columns `text` takes (wide CJK characters take two, combining marks none). */
export function cellWidth(text: string): number {
  return Bun.stringWidth(text);
}

/** The part of `text` that starts `start` columns in and fits in `width` columns, cut at whole characters. */
export function sliceCells(text: string, start: number, width: number): string {
  let column = 0;
  let out = "";
  for (const { segment } of graphemes.segment(text)) {
    const w = Bun.stringWidth(segment);
    if (column >= start && column + w <= start + width) out += segment;
    column += w;
    if (column >= start + width) break;
  }
  return out;
}

/** `text` cut to `width` columns, ending in `…` when anything was cut. */
export function truncateCells(text: string, width: number): string {
  if (width <= 0) return "";
  if (cellWidth(text) <= width) return text;
  return `${sliceCells(text, 0, width - 1)}…`;
}
