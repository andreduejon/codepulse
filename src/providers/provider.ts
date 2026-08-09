/**
 * Shared provider foundation.
 *
 * Defines the minimal types and registry shared across all CI providers.
 * Each provider (GitHub Actions, Jenkins, GitLab CI, …) lives in its own
 * subdirectory and owns its full vertical slice: types, API client, data
 * hook, UI components.  Only the primitives below are truly universal.
 */

import { createSignal } from "solid-js";

/**
 * Canonical provider order used everywhere providers are cycled or displayed.
 * Mental model: source → CI → runtime → scan/quality.
 * Future providers should extend this order as:
 * Git → GitHub Actions → Jenkins → OpenShift → Snyk → SonarQube.
 */
export const PROVIDER_ORDER = ["git", "github-actions", "jenkins", "openshift"] as const;

/** Provider view identifiers — Tab cycles through these. */
export type ProviderView = (typeof PROVIDER_ORDER)[number];
export type ProviderDetailView = Exclude<ProviderView, "git">;

export interface ProviderMetadata {
  displayName: string;
  /** Short label for detail panel tab. Defaults to displayName. */
  detailLabel?: string;
  category: "source" | "ci" | "runtime" | "scan-quality";
}

export const PROVIDER_METADATA: Record<ProviderView, ProviderMetadata> = {
  git: { displayName: "Git", category: "source" },
  "github-actions": { displayName: "GitHub Actions", detailLabel: "Actions", category: "ci" },
  jenkins: { displayName: "Jenkins", category: "ci" },
  openshift: { displayName: "OpenShift", category: "runtime" },
};

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
  /** Total unknown resources/statuses. Used by runtime providers. */
  unknownCount?: number;
  /** Total matched resources. Used by runtime providers. */
  resourceCount?: number;
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
const [providerRegistryVersion, setProviderRegistryVersion] = createSignal(0);

/** Register a provider. Called once per provider during hook setup. */
export function registerProvider(p: ProviderRegistration): void {
  // Avoid duplicate registrations (e.g. HMR / strict-mode double-invocation)
  if (!providerRegistry.find(r => r.id === p.id)) {
    providerRegistry.push(p);
    setProviderRegistryVersion(v => v + 1);
  }
}

/** Unregister a provider by ID. Called when the provider is disabled at runtime. */
export function unregisterProvider(id: ProviderView): void {
  const idx = providerRegistry.findIndex(r => r.id === id);
  if (idx !== -1) {
    providerRegistry.splice(idx, 1);
    setProviderRegistryVersion(v => v + 1);
  }
}

/** Reactive version counter for consumers that need to re-read registry-derived UI. */
export function getProviderRegistryVersion(): number {
  return providerRegistryVersion();
}

/**
 * Returns the ordered list of ProviderView values available for Tab cycling:
 * always starts with "git", then all registered providers (regardless of
 * availability). Registration is the gating mechanism — a disabled provider
 * is never registered, so it never appears here.
 *
 * An unavailable-but-registered provider shows a setup guidance screen when
 * the user tabs to it, instead of being silently excluded from Tab cycling.
 */
export function getEnabledProviderViews(): ProviderView[] {
  const registered = new Set(providerRegistry.map(p => p.id));
  return PROVIDER_ORDER.filter(view => view === "git" || registered.has(view));
}

/**
 * Cycle to the next provider view. If no furthe providers are available, returns "git".
 */
export function nextProviderView(current: ProviderView): ProviderView {
  const views = getEnabledProviderViews();
  if (views.length <= 1) return "git";
  const idx = views.indexOf(current);
  return views[(idx + 1) % views.length];
}

/** Look up a registered provider by ID. Returns undefined if not found. */
export function getProvider(id: ProviderView): ProviderRegistration | undefined {
  return providerRegistry.find(p => p.id === id);
}

/** Returns the display name of the provider. */
export function providerDisplayName(view: ProviderView): string {
  return PROVIDER_METADATA[view]?.displayName ?? getProvider(view)?.displayName ?? view;
}

export function isProviderView(view: string): view is ProviderView {
  return PROVIDER_ORDER.includes(view as ProviderView);
}

export function isProviderDetailView(view: string): view is ProviderDetailView {
  return isProviderView(view) && view !== "git";
}

export function providerDetailTab(view: ProviderView): { id: ProviderDetailView; label: string } | null {
  if (!isProviderDetailView(view)) return null;
  const metadata = PROVIDER_METADATA[view];
  return { id: view, label: metadata.detailLabel ?? metadata.displayName };
}
