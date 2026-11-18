import type { OpenShiftCommitData, OpenShiftResource } from "../../../core/openshift/types";
import { scopedMemory } from "../../components/detail-memory";
import { OPENSHIFT_LEGEND } from "../legends";
import { detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { OpenShiftDetailTab } from "./detail-tab";

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
  /** Enter on a resource: its log, object and events. */
  onOpenResource?: (resource: OpenShiftResource) => void;
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
    const lists = (source.getCommitData(sha)?.namespaces ?? []).flatMap(ns => [
      ns.deployments,
      ns.deploymentConfigs,
      ns.pods,
      ns.builds,
      ns.imageStreamTags,
    ]);
    return lists.some(list => list.length > 0) ? OPENSHIFT_LEGEND : null;
  },
});
