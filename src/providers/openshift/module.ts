/** OpenShift as a provider module. */
import { openShiftEvents } from "../../core/dashboard/events";
import type { ProviderModule } from "../module";
import type { OpenShiftDetailSource } from "./detail-entry";
import { useOpenShift } from "./use-openshift";

export const openShiftModule = {
  id: "openshift",
  start: ({ state, actions, settings, suspended, onOpenResource }) => {
    const openShift = useOpenShift({ state, actions, config: settings.openShift, suspended });
    return {
      instance: openShift,
      getCommitData: openShift.getCommitData,
      invalidate: openShift.invalidate,
      refresh: openShift.refresh,
      heldEvents: app => openShiftEvents(app, openShift.heldEntries()),
      detailSource: {
        getCommitData: openShift.getCommitData,
        fetchCommitData: openShift.fetchCommitDataForSHA,
        isLoading: openShift.isLoading,
        liveAge: openShift.liveAge,
        consoleUrl: () => settings.openShift().consoleUrl,
        get status() {
          return state.providerStatusFor("openshift");
        },
        onOpenResource,
      },
    };
  },
} satisfies ProviderModule<ReturnType<typeof useOpenShift>, OpenShiftDetailSource>;
