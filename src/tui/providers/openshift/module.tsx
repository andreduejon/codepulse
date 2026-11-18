/** OpenShift as a provider module. */

import { openShiftProvider } from "../../../core/openshift/definition";
import { openShiftEvents } from "../../../core/openshift/events";
import { OPENSHIFT_EVENTS_TAB } from "../../../core/openshift/id";
import type { OpenShiftResource } from "../../../core/openshift/types";
import type { TabNotice } from "../../app/app-tab-notice";
import { providerModule } from "../module";
import { type OpenShiftDetailSource, openshiftDetail, openshiftEventsDetail } from "./detail-entry";
import { OPENSHIFT_GRAPH_COLUMNS } from "./graph-columns";
import { OPENSHIFT_HELP } from "./help";
import { OPENSHIFT_LEGEND } from "./legend";
import { buildOpenShiftProviderItems } from "./menu-items";
import OpenShiftResourceDialog from "./resource-dialog";
import { useOpenShift } from "./use-openshift";

/** Under the Events tab: the namespaces whose warnings it cannot show, and the permission that would. */
export function eventsDeniedNotice(namespaces: readonly string[]): TabNotice | null {
  if (namespaces.length === 0) return null;
  return {
    key: `${OPENSHIFT_EVENTS_TAB}:${namespaces.join(",")}`,
    fromStatus: false,
    kind: "warning",
    title: `No permission to list events in ${namespaces.join(", ")}`,
    detail: ["The token needs list on events."],
    entries: [],
  };
}

export const openShiftModule = providerModule({
  definition: openShiftProvider,
  start: ({ state, actions, settings, suspended, onOpenDialog, adapters }) => {
    const openShift = useOpenShift({ state, actions, config: settings, suspended, adapters });
    /** A resource's log, events and object, over the app; Esc goes back. */
    const openResource = (resource: OpenShiftResource, view?: "events") =>
      onOpenDialog(close => (
        <OpenShiftResourceDialog
          resource={resource}
          initialView={view}
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
      // Namespaces whose events the token may not read: their warnings are missing from the Events tab.
      tabNotice: (_sha, tab) => (tab === OPENSHIFT_EVENTS_TAB ? eventsDeniedNotice(openShift.warningsDenied()) : null),
    };
  },
  colors: theme => ({ bg: theme.openShiftBg, fg: theme.openShiftFg }),
  menuItems: menu =>
    buildOpenShiftProviderItems(menu.settings, undefined, menu.update, menu.lastRefresh, menu.tokenIsSet),
  detailEntries: { [openShiftProvider.id]: openshiftDetail, [OPENSHIFT_EVENTS_TAB]: openshiftEventsDetail },
  help: OPENSHIFT_HELP,
  legend: OPENSHIFT_LEGEND,
});
