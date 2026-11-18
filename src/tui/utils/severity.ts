/** A finding's severity in the theme's colors. */
import type { Severity } from "../../core/severity";
import type { Theme } from "../context/theme";

export function severityColor(theme: Theme, severity: Severity): string {
  switch (severity) {
    case "critical":
      return theme.severityCritical;
    case "high":
      return theme.severityHigh;
    case "medium":
      return theme.severityMedium;
    case "low":
      return theme.severityLow;
  }
}
