import type { DebugEventSource } from "../../core/debug-events";
import type { ProviderView } from "../../core/provider-model";
import { moduleOf } from "../context/provider-modules";
import type { Theme } from "../context/theme";
import type { AnyProviderModule } from "./module";

export interface ProviderColors {
  bg: string;
  fg: string;
}

/** A view's badge colors: the Dashboard's and Git's from the theme, a provider's from its module. */
export function providerColors(
  theme: Theme,
  view: ProviderView,
  modules: readonly AnyProviderModule[],
): ProviderColors {
  if (view === "dashboard") return { bg: theme.dashboardBg, fg: theme.dashboardFg };
  if (view === "git") return { bg: theme.gitBg, fg: theme.background };
  // A provider the theme has no colors for shows in the accent.
  return moduleOf(modules, view)?.colors(theme) ?? { bg: theme.accent, fg: theme.background };
}

export function providerAccent(theme: Theme, view: ProviderView, modules: readonly AnyProviderModule[]): string {
  return providerColors(theme, view, modules).bg;
}

/** A Debug event's source in its provider's color (the source is a provider's display name). */
export function debugSourceColor(
  theme: Theme,
  source: DebugEventSource,
  gitColor: string,
  modules: readonly AnyProviderModule[],
): string {
  if (source === "Git") return gitColor;
  if (source === "error") return theme.error;
  return modules.find(module => module.definition.displayName === source)?.colors(theme).bg ?? theme.accent;
}
