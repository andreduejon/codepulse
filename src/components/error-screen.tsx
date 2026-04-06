import { useKeyboard, useRenderer } from "@opentui/solid";
import { For } from "solid-js";
import packageJson from "../../package.json";
import { useT } from "../hooks/use-t";

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
  const t = useT();
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
        return t().foregroundMuted;
      case "pulse":
        return t().accent;
      case "shadow":
        return t().border;
      case "space":
        return t().backgroundPanel;
    }
  };

  const errorLines = () => props.error.split("\n");

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={t().backgroundPanel}>
      {/* Centered content area */}
      <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        {/* Logo */}
        <box flexDirection="column" alignItems="flex-start" backgroundColor={t().backgroundPanel}>
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
          backgroundColor={t().background}
          paddingX={2}
          paddingY={1}
          border={["left"]}
          borderStyle="single"
          borderColor={t().error}
        >
          <For each={errorLines()}>
            {(line: string, i: () => number) => (
              <text wrapMode="word" fg={i() === 0 ? t().foreground : t().foregroundMuted}>
                {line}
              </text>
            )}
          </For>
        </box>

        {/* Spacer */}
        <box height={1} />

        {/* Footer hint — q quit right-aligned */}
        <box flexDirection="row" width={63} height={1}>
          <box flexGrow={1} />
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            q
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" quit"}
          </text>
        </box>
      </box>

      {/* Version — absolute bottom-right, 1 row from bottom, 1 col from right */}
      <box flexDirection="row" width="100%" height={1} paddingRight={1}>
        <box flexGrow={1} />
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {`v${packageJson.version}`}
        </text>
      </box>
      <box height={1} />
    </box>
  );
}
