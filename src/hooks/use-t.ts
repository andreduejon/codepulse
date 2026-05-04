import type { Accessor } from "solid-js";
import type { Theme } from "../context/theme";
import { useTheme } from "../context/theme";

/**
 * Convenience hook: returns a reactive accessor for the current theme object.
 *
 * The theme returned here may have its `accent` field overridden when a CI
 * provider view is active — this override is applied at the ThemeContext level
 * in app.tsx, so all callers of `t().accent` automatically pick up the
 * provider color without any per-component changes.
 *
 * Usage:
 *   const t = useT();
 *   // then: t().foreground, t().accent, etc.
 */
export function useT(): Accessor<Theme> {
  const { theme } = useTheme();
  return theme;
}
