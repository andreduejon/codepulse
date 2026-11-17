/**
 * The registry of the providers the open repository uses: each registers itself, the app reads what is available
 * and what each is doing. The providers' model (views, badges) is in core/provider-model.ts.
 */

import { createSignal } from "solid-js";
import { PROVIDER_ORDER, type ProviderView } from "../core/provider-model";

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
  register: (p: ProviderRegistration) => void;
  unregister: (id: ProviderView) => void;
  getVersion: () => number;
  getEnabledViews: () => ProviderView[];
  /** The Dashboard tab shows while it is turned on (Menu → Providers → Dashboard). */
  setDashboardEnabled: (enabled: boolean) => void;
  nextView: (current: ProviderView) => ProviderView;
  get: (id: ProviderView) => ProviderRegistration | undefined;
}

/** Per-app registry. Do not share across AppState instances. */
export function createProviderRegistry(): ProviderRegistry {
  const entries: ProviderRegistration[] = [];
  const [version, setVersion] = createSignal(0);
  const [dashboardEnabled, setDashboardEnabled] = createSignal(true);

  const getEnabledViews = (): ProviderView[] => {
    const registered = new Set(entries.map(p => p.id));
    return PROVIDER_ORDER.filter(
      view => (view === "dashboard" && dashboardEnabled()) || view === "git" || registered.has(view),
    );
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
    setDashboardEnabled,
    nextView(current) {
      const views = getEnabledViews();
      if (views.length <= 1) return "git";
      const idx = views.indexOf(current);
      return views[(idx + 1) % views.length];
    },
    get: id => entries.find(p => p.id === id),
  };
}
