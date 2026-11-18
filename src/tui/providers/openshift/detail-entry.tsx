import type { OpenShiftCommitData, OpenShiftResource } from "../../../core/openshift/types";
import { warningsAbout } from "../../../core/openshift/warnings";
import { scopedMemory } from "../../components/detail-memory";
import { detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { OpenShiftDetailTab } from "./detail-tab";
import { OpenShiftEventsTab } from "./events-tab";
import { OPENSHIFT_LEGEND, OPENSHIFT_WARNING_LEGEND } from "./legend";

/** What OpenShift hands the detail view. */
export interface OpenShiftDetailSource extends ProviderDetailSource<OpenShiftCommitData> {
  /** Read one commit again (`Reload commit`). */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  isLoading?: (sha: string) => boolean;
  /** How old the live list is (`live`, `2m ago`). */
  liveAge?: () => string;
  /** Whether an expired token stopped the live list until a Reload. */
  isFrozen?: () => boolean;
  /** Web console URL from the settings, for `o`. */
  consoleUrl?: () => string;
  /** Enter on a resource: its log, object and events; or, from the Events tab, its events. */
  onOpenResource?: (resource: OpenShiftResource, view?: "events") => void;
}

/** The live list is off: an expired token froze it. Reads the status, so a view redraws when it changes. */
export const liveListFrozen = (source: OpenShiftDetailSource) =>
  source.status?.kind === "error" && (source.isFrozen?.() ?? false);

export const openshiftDetail = detailEntry<OpenShiftDetailSource>({
  Tab: props => (
    <OpenShiftDetailTab
      mouseEnabled={props.context.mouseEnabled}
      onMouseFocus={props.context.onMouseFocus}
      sha={props.context.sha}
      getCommitData={props.source.getCommitData}
      fetchCommitData={props.source.fetchCommitData}
      isLoading={props.source.isLoading}
      liveAge={props.source.liveAge}
      consoleUrl={props.source.consoleUrl}
      memory={scopedMemory(props.context.memory, "openshift")}
      onOpenResource={props.source.onOpenResource}
      targetResourceId={props.context.target}
      targetColor={props.context.targetColor}
      unavailableReason={props.context.unavailable("openshift", props.source.status)}
      liveUnavailable={liveListFrozen(props.source)}
      loading={props.source.status?.kind === "loading"}
      {...props.context.cursor}
    />
  ),
  legend: (source, sha) => {
    const data = source.getCommitData(sha);
    const resources = (data?.namespaces ?? []).flatMap(ns => [
      ...ns.deployments,
      ...ns.deploymentConfigs,
      ...ns.pods,
      ...ns.builds,
      ...ns.imageStreamTags,
    ]);
    if (resources.length === 0) return null;
    const warnings = data?.warnings ?? [];
    // `!` is explained only when a row shows it.
    const warned = warnings.length > 0 && resources.some(resource => warningsAbout(resource, warnings).length > 0);
    return warned ? [...OPENSHIFT_LEGEND, OPENSHIFT_WARNING_LEGEND] : OPENSHIFT_LEGEND;
  },
});

/** The Events tab: the commit's warnings; Enter opens a warning's resource on its events. */
export const openshiftEventsDetail = detailEntry<OpenShiftDetailSource>({
  Tab: props => (
    <OpenShiftEventsTab
      mouseEnabled={props.context.mouseEnabled}
      onMouseFocus={props.context.onMouseFocus}
      sha={props.context.sha}
      getCommitData={props.source.getCommitData}
      consoleUrl={props.source.consoleUrl}
      memory={scopedMemory(props.context.memory, "openshift")}
      onOpenResource={resource => props.source.onOpenResource?.(resource, "events")}
      {...props.context.cursor}
    />
  ),
});
