import type { Theme } from "../../context/theme";

export type StatusCategory = "pass" | "fail" | "cancelled" | "skipped" | "running" | "unknown";

export function categorize(status: string, conclusion: string | null): StatusCategory {
  if (status !== "completed") return "running";
  switch (conclusion) {
    case "success":
      return "pass";
    case "failure":
    case "failed":
    case "unstable":
    case "timed_out":
    case "startup_failure":
      return "fail";
    case "cancelled":
      return "cancelled";
    case "skipped":
    case "neutral":
      return "skipped";
    default:
      return "unknown";
  }
}

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

export function statusColor(t: Theme, category: StatusCategory): string {
  switch (category) {
    case "pass":
      return t.success;
    case "fail":
      return t.error;
    case "running":
      return t.accent;
    default:
      return t.foregroundMuted;
  }
}
