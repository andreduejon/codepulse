import { BANNER } from "../../debug/banner";
import { detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { OPENSHIFT_LEGEND, OpenShiftDetailTab } from "./detail-tab";
import type { OpenShiftCommitData, OpenShiftResource } from "./types";

/** What OpenShift hands the detail view. */
export interface OpenShiftDetailSource extends ProviderDetailSource<OpenShiftCommitData> {
  /** Read one commit again (`Reload commit`). */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  isLoading?: (sha: string) => boolean;
  /** How old the live list is (`live`, `2m ago`). */
  liveAge?: () => string;
  /** Web console URL from the settings, for `o`. */
  consoleUrl?: () => string;
  /** Enter on a resource: its log, object and events. */
  onOpenResource?: (resource: OpenShiftResource) => void;
}

export const openshiftDetail = detailEntry({
  view: "openshift",
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
      onOpenResource={props.source.onOpenResource}
      unavailableReason={props.context.unavailable("openshift", props.source.status)}
      liveUnavailable={
        props.source.status?.kind === "error" && props.source.status.message === BANNER.openshift.tokenExpired
      }
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
