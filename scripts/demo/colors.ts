/**
 * `--colors`: shots that name each color, so a play can check colors as well as text. A run of text in another
 * color than the theme's `foreground`, or on another background than the screen's (the one most cells have) or the
 * theme's `background`, is marked
 * `«fg/bg:text»` with the theme keys of those colors (`«severityHigh:3 high»`, `«/backgroundElement:  »`). One
 * color can be several keys, joined by `|` (the first three, then `+N`); a color no key has is its hex.
 */
import type { CapturedFrame, RGBA } from "@opentui/core";
import type { Theme } from "../../src/tui/context/theme";

const hex = (color: RGBA) =>
  `#${color
    .toInts()
    .slice(0, 3)
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")}`;

/** Color hex to the theme keys that have it, in the theme's order. */
function namesByHex(theme: Theme): Map<string, string[]> {
  const names = new Map<string, string[]>();
  const add = (color: string, name: string) => {
    const key = color.toLowerCase();
    names.set(key, [...(names.get(key) ?? []), name]);
  };
  for (const [key, value] of Object.entries(theme)) {
    if (key === "name") continue;
    if (Array.isArray(value)) {
      for (const [index, color] of value.entries()) add(color, `${key}[${index}]`);
    } else if (typeof value === "string") add(value, key);
  }
  return names;
}

export function colorLines(frame: CapturedFrame, theme: Theme): string[] {
  const names = namesByHex(theme);
  // A graph lane's color is named only when nothing else has it: lanes reuse the theme's other colors.
  const name = (color: RGBA) => {
    const all = names.get(hex(color)) ?? [hex(color)];
    const named = all.filter(key => !key.startsWith("graphColors["));
    const keys = named.length > 0 ? named : all;
    // Several provider colors are the background: three names and a count are enough to tell.
    return keys.length > 3 ? `${keys.slice(0, 3).join("|")}|+${keys.length - 3}` : keys.join("|");
  };
  const plainFg = theme.foreground.toLowerCase();
  // The screen's own background (the app draws on backgroundPanel): the one most cells have.
  const cells = new Map<string, number>();
  for (const line of frame.lines)
    for (const span of line.spans) cells.set(hex(span.bg), (cells.get(hex(span.bg)) ?? 0) + span.width);
  // The theme's background is plain too: the command bar and footer sit on it.
  const plainBgs = new Set([
    theme.background.toLowerCase(),
    ...[...cells]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1)
      .map(([color]) => color),
  ]);
  return frame.lines.map(line => {
    // Neighboring spans with the same colors are one run.
    const runs: { mark: string; text: string }[] = [];
    for (const span of line.spans) {
      const fg = span.text.trim() !== "" && hex(span.fg) !== plainFg ? name(span.fg) : "";
      const bg = span.bg.toInts()[3] > 0 && !plainBgs.has(hex(span.bg)) ? name(span.bg) : "";
      const mark = fg || bg ? `${fg}${bg ? `/${bg}` : ""}` : "";
      const last = runs.at(-1);
      if (last?.mark === mark) last.text += span.text;
      else runs.push({ mark, text: span.text });
    }
    return runs
      .map(run => (run.mark ? `«${run.mark}:${run.text}»` : run.text))
      .join("")
      .trimEnd();
  });
}
