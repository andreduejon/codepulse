/**
 * GitHub Actions provider — unified status model.
 *
 * Single source of truth for mapping GitHub API status/conclusion pairs to a
 * simplified category, and for deriving icons and theme colours from that
 * category.  Consumed by both the graph-column badges and the detail-tab UI so
 * that the two views are always consistent.
 */

export { categorize, type StatusCategory, statusColor, statusIcon } from "../shared/status";

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
