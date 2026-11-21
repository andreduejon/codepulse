/** OpenShift as a provider module. */

import { openShiftProvider } from "../../../core/openshift/definition";
import { isOpenShiftWarningEvent, openShiftEvents } from "../../../core/openshift/events";
import { OPENSHIFT_EVENTS_TAB } from "../../../core/openshift/id";
import type { OpenShiftResource } from "../../../core/openshift/types";
import type { TabNotice } from "../../app/app-tab-notice";
import { statusIcon } from "../../utils/status-icon";
import { providerModule } from "../module";
import { statusColor } from "../shared/status";
import { type OpenShiftDetailSource, openshiftDetail, openshiftEventsDetail } from "./detail-entry";
import { OPENSHIFT_GRAPH_COLUMNS } from "./graph-columns";
import { OPENSHIFT_HELP } from "./help";
import { OPENSHIFT_LEGEND, OPENSHIFT_WARNING_LEGEND } from "./legend";
import { buildOpenShiftProviderItems } from "./menu-items";
import OpenShiftResourceDialog from "./resource-dialog";
import { useOpenShift } from "./use-openshift";

/**
 * Under the Events tab: the namespaces whose warnings it lacks, the token's (and the permission that would let it) or
 * a list that failed (its warnings are the ones listed before).
 */
export function eventsNotice(denied: readonly string[], failed: readonly string[]): TabNotice | null {
  if (denied.length === 0 && failed.length === 0) return null;
  const failedText = `Could not list events in ${failed.join(", ")}`;
  return {
    key: `${OPENSHIFT_EVENTS_TAB}:${denied.join(",")}:${failed.join(",")}`,
    fromStatus: false,
    kind: "warning",
    title: denied.length > 0 ? `No permission to list events in ${denied.join(", ")}` : failedText,
    detail: [
      ...(denied.length > 0 ? ["The token needs list on events."] : []),
      ...(failed.length === 0
        ? []
        : denied.length > 0
          ? [`${failedText}: its warnings are the ones listed before.`]
          : ["Its warnings are the ones listed before."]),
    ],
    entries: [],
  };
}

export const openShiftModule = providerModule({
  definition: openShiftProvider,
  start: ({ state, actions, settings, suspended, onOpenDialog, adapters }) => {
    const openShift = useOpenShift({ state, actions, config: settings, suspended, adapters });
    /** A resource's log, events and object, over the app; Esc goes back. */
    const openResource = (resource: OpenShiftResource, view?: "events", eventsOnly?: boolean) =>
      onOpenDialog(close => (
        <OpenShiftResourceDialog
          resource={resource}
          initialView={view}
          eventsOnly={eventsOnly}
          savedWarnings={() => openShift.warningsAboutResource(resource)}
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
      warningIsCached: openShift.warningIsCached,
      warningIsPresent: openShift.warningIsPresent,
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
      // Namespaces whose events the token may not read, or whose list failed: the Events tab lacks their warnings.
      tabNotice: (_sha, tab) =>
        tab === OPENSHIFT_EVENTS_TAB ? eventsNotice(openShift.warningsDenied(), openShift.warningsFailed()) : null,
    };
  },
  colors: theme => ({ bg: theme.openShiftBg, fg: theme.openShiftFg }),
  menuItems: menu =>
    buildOpenShiftProviderItems(menu.settings, undefined, menu.update, menu.lastRefresh, menu.tokenIsSet),
  detailEntries: { [openShiftProvider.id]: openshiftDetail, [OPENSHIFT_EVENTS_TAB]: openshiftEventsDetail },
  help: OPENSHIFT_HELP,
  legend: [...OPENSHIFT_LEGEND, OPENSHIFT_WARNING_LEGEND],
  // A saved warning: the `!` its resource shows in the Resources tab. A build: how it ended.
  eventMark: event => {
    if (isOpenShiftWarningEvent(event)) return { icon: "!", color: theme => theme.warning };
    const status = event.status;
    return status && { icon: statusIcon(status), color: theme => statusColor(theme, status) };
  },
});
