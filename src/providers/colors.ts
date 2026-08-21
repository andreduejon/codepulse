import type { Theme } from "../context/theme";
import type { DebugEventSource } from "../debug/events";
import type { ProviderView } from "./provider";

export interface ProviderColors {
  bg: string;
  fg: string;
}

export function providerColors(theme: Theme, view: ProviderView): ProviderColors {
  switch (view) {
    case "git":
      return { bg: theme.accent, fg: theme.background };
    case "github-actions":
      return { bg: theme.githubActionsBg, fg: theme.githubActionsFg };
    case "jenkins":
      return { bg: theme.jenkinsBg, fg: theme.jenkinsFg };
    case "openshift":
      return { bg: theme.openShiftBg, fg: theme.openShiftFg };
  }
}

export function providerAccent(theme: Theme, view: ProviderView): string {
  return providerColors(theme, view).bg;
}

export function debugSourceColor(theme: Theme, source: DebugEventSource, gitColor: string): string {
  switch (source) {
    case "Git":
      return gitColor;
    case "GitHub":
      return theme.githubActionsBg;
    case "Jenkins":
      return theme.jenkinsBg;
    case "OpenShift":
      return theme.openShiftBg;
    case "error":
      return theme.error;
  }
}
