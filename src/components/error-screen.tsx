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
 * Design (from user):
 *   ▒▒▒▒▒▒▌ = 6 body blocks + ▌ shadow = 7 chars per letter
 *   'd' has ascender row (row 0), 'p' has descender row (row 5)
 *   First 'e' bottom bar: ▒▒████▌ bridges CODE→PULSE
 *   's' mid-row: ▀▀▀▀▒▒▌ flips S-curve from top-left to bottom-right
 */
const LOGO_ROWS: LogoRow[] = [
  // Row 0: only 'd' ascender (3rd letter, offset by c+o = 2 × 8 chars)
  [
    ["                ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
  ],
  // Row 1: top bars — c o d e | p u l s e
  [
    ["▒▒▒▒▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
  ],
  // Row 2: side verts — c open, o closed, d closed, e closed | p closed, u open-top, l vert, s left-only, e closed
  [
    ["▒▒", "code"],
    ["▌", "shadow"],
    ["     ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    ["     ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    ["     ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
  ],
  // Row 3: mid — 'e' opens counter with ▛▀▀▀, 's' flips with ▀▀▀▀
  [
    ["▒▒", "code"],
    ["▌", "shadow"],
    ["     ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["▛▀▀▀", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    ["     ", "space"],
    ["▀▀▀▀", "shadow"],
    ["▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "pulse"],
    ["▀▀▀▀", "shadow"],
  ],
  // Row 4: bottom bars — c o d e(trans) | p u l s e
  [
    ["▒▒▒▒▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "code"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒", "code"],
    ["████", "trans"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
    [" ", "space"],
    ["▒▒▒▒▒▒", "pulse"],
    ["▌", "shadow"],
  ],
  // Row 5: only 'p' descender (5th letter: c o d e + space = 4×8 = 32 chars offset)
  [
    ["                                ", "space"],
    ["▒▒", "pulse"],
  ],
];

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
        return theme().background;
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
      backgroundColor={theme().background}
    >
      {/* Logo */}
      <box flexDirection="column" alignItems="flex-start">
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
