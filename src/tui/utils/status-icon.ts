import type { StatusCategory } from "../../core/status";

/** The character the terminal draws for a status: ✓ passed, ✗ failed, ● running, ○ cancelled, – skipped. */
export function statusIcon(category: StatusCategory): string {
  switch (category) {
    case "pass":
      return "✓";
    case "fail":
      return "✗";
    case "running":
      return "●";
    case "cancelled":
      return "○";
    case "skipped":
      return "–";
    default:
      return "?";
  }
}
