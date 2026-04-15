/**
 * Shared provider foundation.
 *
 * Defines the minimal types and registry shared across all CI providers.
 * Each provider (GitHub Actions, Jenkins, GitLab CI, …) lives in its own
 * subdirectory and owns its full vertical slice: types, API client, data
 * hook, UI components.  Only the primitives below are truly universal.
 */

/** Provider view identifiers — Tab cycles through these. */
export type ProviderView = "git" | "github-actions";
// Future: | "gitlab-ci" | "jenkins"

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
  /** Total fail count (failure + cancelled + timed_out) across all runs. */
  failCount: number;
  /** Total in-progress / queued count across all runs. */
  runningCount: number;
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
}

/** Mutable provider registry — populated at runtime as providers are initialised. */
export const providerRegistry: ProviderRegistration[] = [];

/** Register a provider.  Called once per provider during hook setup. */
export function registerProvider(p: ProviderRegistration): void {
  // Avoid duplicate registrations (e.g. HMR / strict-mode double-invocation)
  if (!providerRegistry.find(r => r.id === p.id)) {
    providerRegistry.push(p);
  }
}

/**
 * Returns the ordered list of ProviderView values available for Tab cycling:
 * always starts with "git", then all registered providers (regardless of
 * availability).  Registration is the gating mechanism — a disabled provider
 * is never registered, so it never appears here.
 *
 * An unavailable-but-registered provider shows a setup guidance screen when
 * the user tabs to it, instead of being silently excluded from Tab cycling.
 */
export function getEnabledProviderViews(): ProviderView[] {
  const views: ProviderView[] = ["git"];
  for (const p of providerRegistry) {
    views.push(p.id);
  }
  return views;
}

/**
 * Cycle to the next provider view.
 * If no providers are available beyond "git", returns "git".
 */
export function nextProviderView(current: ProviderView): ProviderView {
  const views = getEnabledProviderViews();
  if (views.length <= 1) return "git";
  const idx = views.indexOf(current);
  return views[(idx + 1) % views.length];
}

/** Look up a registered provider by ID.  Returns undefined if not found. */
export function getProvider(id: ProviderView): ProviderRegistration | undefined {
  return providerRegistry.find(p => p.id === id);
}
