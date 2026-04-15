import type { Accessor } from "solid-js";
import { createMemo } from "solid-js";
import { useAppState } from "../context/state";
import type { Theme } from "../context/theme";
import { useTheme } from "../context/theme";

/**
 * Convenience hook: returns a reactive accessor for the current theme object.
 *
 * When `activeProviderView` is `"github-actions"`, the returned theme has its
 * `accent` field overridden with `githubActionsFg` so that every component
 * using `t().accent` automatically picks up the provider color — no per-component
 * changes needed.
 *
 * Usage:
 *   const t = useT();
 *   // then: t().foreground, t().accent, etc.
 */
export function useT(): Accessor<Theme> {
  const { theme } = useTheme();
  const { state } = useAppState();

  // createMemo placed after all const declarations (AGENTS.md rule 1 — no TDZ)
  const derivedTheme = createMemo((): Theme => {
    const base = theme();
    if (state.activeProviderView() === "github-actions") {
      return { ...base, accent: base.githubActionsFg };
    }
    return base;
  });

  return derivedTheme;
}
