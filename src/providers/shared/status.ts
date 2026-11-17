import type { Theme } from "../../context/theme";
import type { StatusCategory } from "../../core/status";

export function statusColor(t: Theme, category: StatusCategory): string {
  switch (category) {
    case "pass":
      return t.success;
    case "fail":
      return t.error;
    case "running":
      return t.info;
    default:
      return t.foregroundMuted;
  }
}
