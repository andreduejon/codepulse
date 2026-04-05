import { useKeyboard, useRenderer } from "@opentui/solid";
import { For } from "solid-js";
import packageJson from "../../package.json";
import { useTheme } from "../context/theme";

/**
 * codepulse logo — lowercase, dual-tone blocks with half-block shadows.
 *
 * each logo segment: [text, colorType]
 *   "code"   → theme.foregroundMuted
 *   "pulse"  → theme.accent
 *   "shadow" → theme.border
 *   "space"  → transparent spacer
 */
type ColorType = "code" | "pulse" | "shadow" | "space";
type Seg = [string, ColorType];
type LogoRow = Seg[];

/**
 *
 */
const ROW0: LogoRow = [
  ["                  ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
];

const ROW1: LogoRow = [
  ["██████", "code"],
  ["▌", "shadow"],
  ["██████", "code"],
  ["▌", "shadow"],
  ["██████", "code"],
  ["▌", "shadow"],
  ["██████", "code"],
  ["▌", "shadow"],
  ["██████", "pulse"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  ["██████", "pulse"],
  ["▌", "shadow"],
  ["██████", "pulse"],
  ["▌", "shadow"],
];

const ROW2: LogoRow = [
  ["██", "code"],
  ["▌", "shadow"],
  ["    ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
  ["██", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
  ["██", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
];

const ROW3: LogoRow = [
  ["██", "code"],
  ["▌", "shadow"],
  ["    ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
  ["██", "code"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "code"],
  ["▌", "shadow"],
  ["██", "code"],
  ["▀▀▀▀", "code"],
  ["▘", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  [" ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["    ", "space"],
  ["▀▀▀▀", "pulse"],
  ["██", "pulse"],
  ["▌", "shadow"],
  ["██", "pulse"],
  ["▀▀▀▀", "pulse"],
  ["▘", "shadow"],
];

const ROW4: LogoRow = [
  ["██████", "code"],
  ["▌", "shadow"],
  ["██████", "code"],
  ["▌", "shadow"],
  ["██████", "code"],
  ["▌", "shadow"],
  ["██", "code"],
  ["████", "code"],
  ["▌", "shadow"],
  ["██████", "pulse"],
  ["▌", "shadow"],
  ["██████", "pulse"],
  ["▌", "shadow"],
  ["██████", "pulse"],
  ["▌", "shadow"],
  ["██████", "pulse"],
  ["▌", "shadow"],
  ["██████", "pulse"],
  ["▌", "shadow"],
];

const ROW5: LogoRow = [
  ["                            ", "space"],
  ["██", "pulse"],
  ["▌", "shadow"],
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
        return theme().accent;
      case "shadow":
        return theme().border;
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

      {/* Error section — width matches logo (63 chars) */}
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
            <text wrapMode="word" fg={i() === 0 ? theme().foreground : theme().foregroundMuted}>
              {line}
            </text>
          )}
        </For>
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Footer hint — version left, q quit right; matches main footer style */}
      <box flexDirection="row" width={63} height={1}>
        <text flexShrink={0} wrapMode="none" fg={theme().foregroundMuted}>
          {`v${packageJson.version}`}
        </text>
        <box flexGrow={1} />
        <text flexShrink={0} wrapMode="none" fg={theme().foreground}>
          q
        </text>
        <text flexShrink={0} wrapMode="none" fg={theme().foregroundMuted}>
          {" quit"}
        </text>
      </box>
    </box>
  );
}
