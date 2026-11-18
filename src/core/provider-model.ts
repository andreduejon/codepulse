import type { ProviderSet } from "./provider-set";

/**
 * The views and what each commit's badge says. Which providers there are, their names and order, is the app's provider
 * set (provider-set.ts), built from each provider's definition.
 */

/** A view Tab cycles through: the Dashboard, Git, or a provider's id. */
export type ProviderView = "dashboard" | "git" | (string & {});

/** Where a Dashboard event comes from: Git or a provider. */
export type EventSource = Exclude<ProviderView, "dashboard">;

/** A provider's view: not Git, not the Dashboard. */
export type ProviderDetailView = string;

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
  /** OpenShift: Kubernetes warned about its resources (`!` after the Live counts). */
  warnings?: boolean;
  /** OpenShift: the namespaces whose workloads run this commit now, shown with the refs in the graph. */
  namespaces?: NamespaceMarker[];
  /** Severity counts used by scan/quality providers. */
  severityCounts?: { critical: number; high: number; medium: number; low: number };
  /** Relative time string for the most recently updated run (e.g. "2h ago"). */
  latestRunAt: string;
  /** Status of the most recently updated run — used to colour latestRunAt. */
  latestStatus: "pass" | "fail" | "running" | "unknown";
}

/** Provider registration entry — each provider registers itself on init. */
export interface ProviderRegistration {
  id: ProviderView;
  /** Human-readable display name shown in the badge and menu. */
  displayName: string;
  /** Returns true when the provider can produce data (token + matching remote). */
  isAvailable: () => boolean;
  /**
   * Long-running work as a short verb (`scanning`), shown after the display name in the footer in every view,
   * instead of the generic `loading`. Set it only when it ends reliably: it can't get stuck after a view switch.
   */
  activity?: () => string | null;
}

export interface ProviderRegistry {
  /** The providers the app runs with: their names, tabs and order. */
  readonly set: ProviderSet;
  register: (p: ProviderRegistration) => void;
  unregister: (id: ProviderView) => void;
  getVersion: () => number;
  getEnabledViews: () => ProviderView[];
  /** The Dashboard tab shows while it is turned on (Menu → Providers → Dashboard). */
  setDashboardEnabled: (enabled: boolean) => void;
  nextView: (current: ProviderView) => ProviderView;
  get: (id: ProviderView) => ProviderRegistration | undefined;
}
