/**
 * GitHub Actions provider — unified status model.
 *
 * Single source of truth for mapping GitHub API status/conclusion pairs to a
 * simplified category, and for deriving icons and theme colours from that
 * category.  Consumed by both the graph-column badges and the detail-tab UI so
 * that the two views are always consistent.
 */

import type { Theme } from "../../context/theme";

// ── Status category ───────────────────────────────────────────────────────

/**
 * Simplified status category derived from a GitHub `status` + `conclusion`
 * pair.  Used uniformly across badge aggregation and detail-tab rendering.
 *
 * - `pass`      — completed with success conclusion
 * - `fail`      — completed with failure / timed_out / startup_failure
 * - `cancelled` — completed with cancelled conclusion (not a build failure)
 * - `skipped`   — completed with skipped / neutral conclusion
 * - `running`   — not yet completed (in_progress, queued, waiting, …)
 * - `unknown`   — any other completed conclusion
 */
export type StatusCategory = "pass" | "fail" | "cancelled" | "skipped" | "running" | "unknown";

/**
 * Map a GitHub `status` + `conclusion` pair to a `StatusCategory`.
 *
 * Previously `cancelled` was mapped to `"fail"` which inflated fail counts.
 * The corrected mapping treats cancellations as a neutral outcome.
 */
export function categorize(status: string, conclusion: string | null): StatusCategory {
  if (status !== "completed") return "running";
  switch (conclusion) {
    case "success":
      return "pass";
    case "failure":
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

// ── Icon ──────────────────────────────────────────────────────────────────

/** Return the single-character status icon for a category. */
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

// ── Colour ────────────────────────────────────────────────────────────────

/** Return the theme colour string for a category. */
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
