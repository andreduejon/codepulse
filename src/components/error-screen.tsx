import { useKeyboard, useRenderer } from "@opentui/solid";
import { For } from "solid-js";
import { useTheme } from "../context/theme";

/**
 * Each logo segment: [text, colorType]
 *   "code"   → theme.foregroundMuted  (dimmed CODE letters: c, o, d, e)
 *   "pulse"  → theme.foreground       (bright PULSE letters: p, u, l, s, e)
 *   "shadow" → theme.border           (half-block edge shadows: ▌ ▀ ▛)
 *   "trans"  → theme.foreground       (CODE→PULSE transition blocks ████ in first 'e')
 *   "space"  → transparent spacer
 */
type ColorType = "code" | "pulse" | "shadow" | "trans" | "space";
type Seg = [string, ColorType];
type LogoRow = Seg[];

/**
 * CODEPULSE logo — lowercase, dual-tone with half-block shadows.
 *
 * Rows transcribed directly from user's design:
 *
 * row0:                  ▒▒▌
 * row1: ▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▌ ▒▒▌▒▒▌    ▒▒▒▒▒▒▌▒▒▒▒▒▒▌
 * row2: ▒▒▌    ▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌    ▒▒▌    ▒▒▌ ▒▒▌
 * row3: ▒▒▌    ▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▛▀▀▀ ▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌    ▀▀▀▀▒▒▌▒▒▀▀▀▀
 * row4: ▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒████▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌
 * row5:                                 ▒▒
 *
 * Letter widths (from row1): c=7, o=7, d=7, e=7, p=7, u=5+gap, l=5+gap, s=7+gap, e=7
 * Split point: CODE = first 4 letters (c,o,d,e), PULSE = last 5 (p,u,l,s,e)
 */

// Each row is expressed as literal string slices with their color type.
// We split at the CODE/PULSE boundary character-by-character to apply colors.

// Row 0: 'd' ascender only — 'd' starts at char 14 in row1 (c=7+o=7 = 14)
// row1 chars 0-6=c, 7-13=o, 14-20=d, 21-27=e — so 'd' ascender is at offset 14
const ROW0: LogoRow = [
  ["              ", "space"], // 14 spaces to align under 'd' start
  ["▒▒", "code"],
  ["▌", "shadow"],
];

// Row 1: top bars — no spaces between letters
// c(7) o(7) d(7) e(7) | p(7) u(5) gap(1) l(3) gap(4) s(7) e(7)
// From user: ▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▌ ▒▒▌▒▒▌    ▒▒▒▒▒▒▌▒▒▒▒▒▒▌
const ROW1: LogoRow = [
  // CODE: c o d e
  ["▒▒▒▒▒▒", "code"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "code"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "code"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "code"],
  ["▌", "shadow"],
  // PULSE: p u (gap) l (gap) s e
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
];

// Row 2: side verts
// From user: ▒▒▌    ▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌    ▒▒▌    ▒▒▌ ▒▒▌
const ROW2: LogoRow = [
  // c: left vert + 4 spaces
  ["▒▒", "code"],
  ["▌", "shadow"],
  ["    ", "space"],
  // o: left vert + space + right vert
  ["▒▒", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "code"],
  ["▌", "shadow"],
  // d: left vert + space + right vert
  ["▒▒", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "code"],
  ["▌", "shadow"],
  // e: left vert + space + right vert (counter open)
  ["▒▒", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "code"],
  ["▌", "shadow"],
  // p: left vert + space + right vert
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  // u: left vert + space + right vert
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  // l: left vert + 4 spaces
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  // s: left vert only + 4 spaces
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  // e: left vert + space + right vert
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
];

// Row 3: mid row — 'e' opens with ▛▀▀▀, 's' flips with ▀▀▀▀
// From user: ▒▒▌    ▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▛▀▀▀ ▒▒▌ ▒▒▌▒▒▌ ▒▒▌▒▒▌    ▀▀▀▀▒▒▌▒▒▀▀▀▀
const ROW3: LogoRow = [
  // c: left vert + 4 spaces
  ["▒▒", "code"],
  ["▌", "shadow"],
  ["    ", "space"],
  // o: left vert + space + right vert
  ["▒▒", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "code"],
  ["▌", "shadow"],
  // d: left vert + space + right vert
  ["▒▒", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "code"],
  ["▌", "shadow"],
  // e: left vert + ▛▀▀▀ (counter opens — no right vert)
  ["▒▒", "code"],
  ["▛▀▀▀", "shadow"],
  // p: space + left vert + space + right vert
  [" ", "space"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  // u: left vert + space + right vert
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  // l: left vert + 4 spaces
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  // s: ▀▀▀▀ flip + right vert
  ["▀▀▀▀", "shadow"],
  ["▒▒", "pulse"],
  ["▌", "shadow"],
  // e: left vert + ▀▀▀▀ (counter closes at top) + trailing space to match row width
  ["▒▒", "pulse"],
  ["▀▀▀▀", "shadow"],
  [" ", "space"],
];

// Row 4: bottom bars — no spaces between letters
// From user: ▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒████▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌▒▒▒▒▒▒▌
const ROW4: LogoRow = [
  // CODE: c o d
  ["▒▒▒▒▒▒", "code"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "code"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "code"],
  ["▌", "shadow"],
  // e: ▒▒ CODE + ████ PULSE transition
  ["▒▒", "code"],
  ["████", "trans"],
  ["▌", "shadow"],
  // PULSE: p u l s e
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
  ["▒▒▒▒▒▒", "pulse"],
  ["▌", "shadow"],
];

// Row 5: 'p' descender only — 'p' starts at char 28 in row4 (c+o+d+e = 4×7 = 28)
const ROW5: LogoRow = [
  ["                            ", "space"], // 28 spaces
  ["▒▒", "pulse"],
];

const LOGO_ROWS: LogoRow[] = [ROW0, ROW1, ROW2, ROW3, ROW4, ROW5];

interface ErrorScreenProps {
  error: string;
}

export default function ErrorScreen(props: Readonly<ErrorScreenProps>) {
  const { theme } = useTheme();
  const renderer = useRenderer();

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (e.name === "q") {
      renderer.destroy();
    }
  });

  const fgFor = (type: ColorType): string => {
    switch (type) {
      case "code":
        return theme().foregroundMuted;
      case "pulse":
        return theme().foreground;
      case "shadow":
        return theme().border;
      case "trans":
        return theme().foreground;
      case "space":
        return theme().backgroundPanel;
    }
  };

  const errorLines = () => props.error.split("\n");

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      backgroundColor={theme().backgroundPanel}
    >
      {/* Logo */}
      <box flexDirection="column" alignItems="flex-start" backgroundColor={theme().backgroundPanel}>
        <For each={LOGO_ROWS}>
          {(row: LogoRow) => (
            <box flexDirection="row">
              <For each={row}>
                {(seg: Seg) => (
                  <text wrapMode="none" fg={fgFor(seg[1])}>
                    {seg[0]}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </box>

      {/* Spacer */}
      <box height={2} />

      {/* Error section — same style as search section, width matches logo (~63 chars) */}
      <box
        width={63}
        flexDirection="column"
        backgroundColor={theme().background}
        paddingX={2}
        paddingY={1}
        border={["left"]}
        borderStyle="single"
        borderColor={theme().error}
      >
        <For each={errorLines()}>
          {(line: string, i: () => number) => (
            <text wrapMode="none" fg={i() === 0 ? theme().foreground : theme().foregroundMuted}>
              {line}
            </text>
          )}
        </For>
      </box>

      {/* Spacer */}
      <box height={2} />

      {/* Footer hint */}
      <text wrapMode="none" fg={theme().foregroundMuted}>
        q quit
      </text>
    </box>
  );
}
