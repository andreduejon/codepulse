/**
 * The registry of the providers the open repository uses: each registers itself, the app reads what is available
 * and what each is doing. The providers' model (views, badges) is in core/provider-model.ts.
 */

import { createSignal } from "solid-js";
import {
  PROVIDER_ORDER,
  type ProviderRegistration,
  type ProviderRegistry,
  type ProviderView,
} from "../core/provider-model";

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
