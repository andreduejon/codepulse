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

export interface ProviderRegistry {
  register: (p: ProviderRegistration) => void;
  unregister: (id: ProviderView) => void;
  getVersion: () => number;
  getEnabledViews: () => ProviderView[];
  nextView: (current: ProviderView) => ProviderView;
  get: (id: ProviderView) => ProviderRegistration | undefined;
}

/** Per-app registry. Do not share across AppState instances. */
export function createProviderRegistry(): ProviderRegistry {
  const entries: ProviderRegistration[] = [];
  const [version, setVersion] = createSignal(0);

  const getEnabledViews = (): ProviderView[] => {
    const registered = new Set(entries.map(p => p.id));
    return PROVIDER_ORDER.filter(view => view === "git" || registered.has(view));
  };

  return {
    register(p) {
      if (!entries.find(r => r.id === p.id)) {
        entries.push(p);
        setVersion(v => v + 1);
      }
    },
    unregister(id) {
      const idx = entries.findIndex(r => r.id === id);
      if (idx !== -1) {
        entries.splice(idx, 1);
        setVersion(v => v + 1);
      }
    },
    getVersion: () => version(),
    getEnabledViews,
    nextView(current) {
      const views = getEnabledViews();
      if (views.length <= 1) return "git";
      const idx = views.indexOf(current);
      return views[(idx + 1) % views.length];
    },
    get: id => entries.find(p => p.id === id),
  };
}

export function providerDisplayName(view: ProviderView): string {
  return PROVIDER_METADATA[view]?.displayName ?? view;
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
