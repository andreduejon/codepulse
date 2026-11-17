import type { SnykSeverity } from "../../../core/snyk/types";
import type { Theme } from "../../context/theme";

export function severityColor(theme: Theme, severity: SnykSeverity): string {
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
