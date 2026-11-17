/** Snyk as a provider module: it scans branch tips on its own, so it has nothing to fetch again on Reload. */
import type { ProviderModule } from "../module";
import type { SnykDetailSource } from "./detail-entry";
import { useSnyk } from "./use-snyk";

export const snykModule = {
  id: "snyk",
  start: ({ state, actions, settings, suspended, adapters }) => {
    const snyk = useSnyk({ state, actions, config: settings.snyk, suspended, adapters: adapters.snyk });
    return {
      instance: snyk,
      getCommitData: snyk.getCommitData,
      invalidate: snyk.invalidate,
      detailSource: {
        getCommitData: snyk.getCommitData,
        isScanning: snyk.isScanning,
        scanCommit: snyk.scanCommit,
        get status() {
          return state.providerStatusFor("snyk");
        },
      },
    };
  },
} satisfies ProviderModule<ReturnType<typeof useSnyk>, SnykDetailSource>;
