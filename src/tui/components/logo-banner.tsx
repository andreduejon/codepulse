import { For } from "solid-js";
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

/** Height of the logo in rows. */
export const LOGO_HEIGHT = LOGO_ROWS.length;

/** Width of the logo in characters (used to align content below it). */
export const LOGO_WIDTH = 63;

/**
 * Shared codepulse logo banner — renders the block-art logo centered,
 * with the version string at the bottom-right.
 *
 * Used by: ErrorScreen, SetupScreen, ProjectSelector, "too small" fallback.
 */
export default function LogoBanner() {
  const t = useT();

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

  return (
    <box flexDirection="column" alignItems="center" height={LOGO_HEIGHT} flexShrink={0} overflow="hidden">
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
    </box>
  );
}
