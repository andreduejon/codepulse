/** The providers the app knows, in their order, and what each commit's badge says. */

/**
 * Canonical provider order used everywhere providers are cycled or displayed.
 * Mental model: the dashboard over every provider, then source → CI → runtime → scan/quality.
 * Future providers should extend this order as:
 * Dashboard → Git → GitHub → Jenkins → OpenShift → Snyk → SonarQube.
 */
export const PROVIDER_ORDER = ["dashboard", "git", "github-actions", "jenkins", "openshift", "snyk"] as const;

/** Provider view identifiers — Tab cycles through these. */
export type ProviderView = (typeof PROVIDER_ORDER)[number];

/** The views that show a provider's events on the dashboard: every view but the dashboard itself. */
export type EventSource = Exclude<ProviderView, "dashboard">;

export type ProviderDetailView = Exclude<ProviderView, "git" | "dashboard">;

export interface ProviderMetadata {
  displayName: string;
  /** Label for detail panel tab. Defaults to displayName. */
  detailLabel?: string;
  category: "overview" | "source" | "ci" | "runtime" | "scan-quality";
}

export const PROVIDER_METADATA: Record<ProviderView, ProviderMetadata> = {
  dashboard: { displayName: "Dashboard", category: "overview" },
  git: { displayName: "Git", category: "source" },
  "github-actions": { displayName: "GitHub", detailLabel: "Actions", category: "ci" },
  jenkins: { displayName: "Jenkins", detailLabel: "Builds", category: "ci" },
  openshift: { displayName: "OpenShift", detailLabel: "Resources", category: "runtime" },
  snyk: { displayName: "Snyk", detailLabel: "Vulnerabilities", category: "scan-quality" },
};

export interface GraphStatusCounts {
  passCount: number;
  failCount: number;
  runningCount: number;
  unknownCount: number;
}

/** A namespace that runs a commit now: ready (`live`), rolling out, or failing to. */
export interface NamespaceMarker {
  namespace: string;
  state: "live" | "rolling" | "fail";
}

/**
 * Minimal badge for a single commit in the graph view.
 *
 * Every CI system can express pass / fail / running / unknown.
 * Nothing more specific lives here — provider-specific detail is in
 * the per-provider types.
 */
export interface GraphBadge {
  sha: string;
  /** Aggregated status across all runs for this SHA (worst-status wins). */
  badge: "pass" | "fail" | "running" | "unknown";
  /** Total pass count across all runs for this SHA. */
  passCount: number;
  /** Total fail count (failure, timed_out, startup_failure, unstable) across all runs. */
  failCount: number;
  /** Total in-progress / queued count across all runs. */
  runningCount: number;
  /** Total neutral count: cancelled, skipped and unknown runs (CI) or unknown resources (runtime). */
  unknownCount?: number;
  /** Total matched resources. Used by runtime providers. */
  resourceCount?: number;
  /** Named status-count lanes (e.g. OpenShift `live` / `cache`). */
  lanes?: Record<string, GraphStatusCounts>;
  /** OpenShift: the namespaces whose workloads run this commit now, shown with the refs in the graph. */
  namespaces?: NamespaceMarker[];
  /** Severity counts used by scan/quality providers. */
  severityCounts?: { critical: number; high: number; medium: number; low: number };
  /** Relative time string for the most recently updated run (e.g. "2h ago"). */
  latestRunAt: string;
  /** Status of the most recently updated run — used to colour latestRunAt. */
  latestStatus: "pass" | "fail" | "running" | "unknown";
}

export function providerDisplayName(view: ProviderView): string {
  return PROVIDER_METADATA[view]?.displayName ?? view;
}

export function isProviderView(view: string): view is ProviderView {
  return PROVIDER_ORDER.includes(view as ProviderView);
}

export function isProviderDetailView(view: string): view is ProviderDetailView {
  return isProviderView(view) && view !== "git" && view !== "dashboard";
}

export function providerDetailTab(view: ProviderView): { id: ProviderDetailView; label: string } | null {
  if (!isProviderDetailView(view)) return null;
  const metadata = PROVIDER_METADATA[view];
  return { id: view, label: metadata.detailLabel ?? metadata.displayName };
}
