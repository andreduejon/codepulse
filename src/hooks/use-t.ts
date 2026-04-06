import type { Accessor } from "solid-js";
import type { Theme } from "../context/theme";
import { useTheme } from "../context/theme";

/**
 * Convenience hook: returns a reactive accessor for the current theme object.
 *
 * Replaces the two-line boilerplate:
 *   const { theme } = useTheme();
 *   const t = () => theme();
 *
 * Usage:
 *   const t = useT();
 *   // then: t().foreground, t().accent, etc.
 */
export function useT(): Accessor<Theme> {
  const { theme } = useTheme();
  return theme;
}
