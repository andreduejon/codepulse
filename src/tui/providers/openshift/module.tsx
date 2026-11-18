/** OpenShift as a provider module. */

import { openShiftProvider } from "../../../core/openshift/definition";
import { openShiftEvents } from "../../../core/openshift/events";
import type { OpenShiftResource } from "../../../core/openshift/types";
import { providerModule } from "../module";
import { type OpenShiftDetailSource, openshiftDetail } from "./detail-entry";
import { OPENSHIFT_GRAPH_COLUMNS } from "./graph-columns";
import { OPENSHIFT_HELP } from "./help";
import { OPENSHIFT_LEGEND } from "./legend";
import { buildOpenShiftProviderItems } from "./menu-items";
import OpenShiftResourceDialog from "./resource-dialog";
import { useOpenShift } from "./use-openshift";

export const openShiftModule = providerModule({
  definition: openShiftProvider,
  start: ({ state, actions, settings, suspended, onOpenDialog, adapters }) => {
    const openShift = useOpenShift({ state, actions, config: settings, suspended, adapters });
    /** A resource's log, events and object, over the app; Esc goes back. */
    const openResource = (resource: OpenShiftResource) =>
      onOpenDialog(close => (
        <OpenShiftResourceDialog
          resource={resource}
          loadLog={async (item, force) =>
            item.kind === "Pod" ? openShift.loadPodLog(item) : openShift.loadBuildLog(item, force)
          }
          followLog={openShift.followLog}
          consoleUrl={settings().consoleUrl}
          loadEvents={item => openShift.loadResourceEvents(item)}
          loadObject={(item, force) => openShift.loadResourceObject(item, force)}
          onClose={close}
        />
      ));
    const detailSource: OpenShiftDetailSource = {
      getCommitData: openShift.getCommitData,
      fetchCommitData: openShift.fetchCommitDataForSHA,
      isLoading: openShift.isLoading,
      liveAge: openShift.liveAge,
      isFrozen: openShift.isFrozen,
      consoleUrl: () => settings().consoleUrl,
      get status() {
        return state.providerStatusFor(openShiftProvider.id);
      },
      onOpenResource: openResource,
    };
    return {
      instance: openShift,
      getCommitData: openShift.getCommitData,
      invalidate: openShift.invalidate,
      refresh: openShift.refresh,
      heldEvents: app => openShiftEvents(app, openShift.heldEntries()),
      detailSource,
      graphColumns: OPENSHIFT_GRAPH_COLUMNS,
    };
  },
  colors: theme => ({ bg: theme.openShiftBg, fg: theme.openShiftFg }),
  menuItems: menu =>
    buildOpenShiftProviderItems(menu.settings, undefined, menu.update, menu.lastRefresh, menu.tokenIsSet),
  detailEntries: { [openShiftProvider.id]: openshiftDetail },
  help: OPENSHIFT_HELP,
  legend: OPENSHIFT_LEGEND,
});
