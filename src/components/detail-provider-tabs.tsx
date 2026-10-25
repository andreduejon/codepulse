import { Show } from "solid-js";
import { useAppState } from "../context/state";
import { BANNER } from "../debug/banner";
import { ActionsDetailTab } from "../providers/github-actions/detail-tab";
import { JenkinsDetailTab } from "../providers/jenkins/detail-tab";
import { OpenShiftDetailTab } from "../providers/openshift/detail-tab";
import { SnykDependenciesTab } from "../providers/snyk/deps-tab";
import { SnykDetailTab } from "../providers/snyk/detail-tab";
import type { SnykViewMemory } from "../providers/snyk/view-memory";
import type { DetailViewProps } from "./detail-types";

/** The provider tabs of a committed commit's detail view: Actions, Jenkins, OpenShift and both Snyk tabs. */
export function ProviderDetailTabs(
  props: Readonly<{
    view: DetailViewProps;
    sha: string;
    /** Snyk tab view state across tab switches (owned by the detail view, which outlives its tabs). */
    snykMemory: SnykViewMemory;
  }>,
) {
  const { state, actions } = useAppState();
  const activeTab = () => state.detailActiveTab();
  const cursor = {
    navRef: props.view.navRef,
    detailCursorIndex: () => state.detailCursorIndex(),
    detailFocused: () => state.detailFocused(),
    setDetailCursorAction: actions.setDetailCursorAction,
    setDetailCursorIndex: actions.setDetailCursorIndex,
  };
  const snykScan = async () => {
    await props.view.snykScanCommit?.(props.sha, !!props.view.snykGetCommitData?.(props.sha));
  };

  return (
    <>
      <Show
        when={
          activeTab() === "github-actions" && !!props.view.githubGetCommitData && !!props.view.githubFetchJobsForRun
        }
      >
        <ActionsDetailTab
          mouseEnabled={props.view.mouseEnabled}
          onMouseFocus={props.view.onMouseFocus}
          sha={props.sha}
          // biome-ignore lint/style/noNonNullAssertion: guarded by Show when condition above
          getCommitData={props.view.githubGetCommitData!}
          // biome-ignore lint/style/noNonNullAssertion: guarded by Show when condition above
          fetchJobsForRun={props.view.githubFetchJobsForRun!}
          fetchCommitData={props.view.githubFetchCommitData}
          unavailableReason={
            props.view.githubProviderStatus?.kind === "unavailable" ? props.view.githubProviderStatus.message : null
          }
          loading={props.view.githubProviderStatus?.kind === "loading"}
          {...cursor}
          onOpenJobLog={props.view.onOpenJobLog}
        />
      </Show>

      <Show
        when={activeTab() === "jenkins" && !!props.view.jenkinsGetCommitData && !!props.view.jenkinsFetchJobsForRun}
      >
        <JenkinsDetailTab
          mouseEnabled={props.view.mouseEnabled}
          onMouseFocus={props.view.onMouseFocus}
          sha={props.sha}
          // biome-ignore lint/style/noNonNullAssertion: guarded by Show when condition above
          getCommitData={props.view.jenkinsGetCommitData!}
          // biome-ignore lint/style/noNonNullAssertion: guarded by Show when condition above
          fetchJobsForRun={props.view.jenkinsFetchJobsForRun!}
          fetchCommitData={props.view.jenkinsFetchCommitData}
          unavailableReason={
            props.view.jenkinsProviderStatus?.kind === "unavailable" ? props.view.jenkinsProviderStatus.message : null
          }
          loading={props.view.jenkinsProviderStatus?.kind === "loading"}
          {...cursor}
          onOpenJobLog={props.view.onOpenJenkinsJobLog}
        />
      </Show>

      <Show when={activeTab() === "openshift" && props.view.openshiftGetCommitData}>
        {getCommitData => (
          <OpenShiftDetailTab
            mouseEnabled={props.view.mouseEnabled}
            onMouseFocus={props.view.onMouseFocus}
            sha={props.sha}
            getCommitData={getCommitData()}
            fetchCommitData={props.view.openshiftFetchCommitData}
            isLoading={props.view.openshiftIsLoading}
            liveAge={props.view.openshiftLiveAge}
            onOpenResource={props.view.onOpenOpenShiftResource}
            unavailableReason={
              props.view.openshiftProviderStatus?.kind === "unavailable"
                ? props.view.openshiftProviderStatus.message
                : null
            }
            liveUnavailable={
              props.view.openshiftProviderStatus?.kind === "error" &&
              props.view.openshiftProviderStatus.message === BANNER.openshift.tokenExpired
            }
            warningReason={
              props.view.openshiftProviderStatus?.kind === "warning" &&
              props.view.openshiftProviderStatus.message !== BANNER.openshift.watchDenied
                ? props.view.openshiftProviderStatus.message
                : null
            }
            loading={props.view.openshiftProviderStatus?.kind === "loading"}
            {...cursor}
          />
        )}
      </Show>

      <Show when={activeTab() === "snyk" && props.view.snykGetCommitData && props.view.snykScanCommit}>
        <SnykDetailTab
          memory={props.snykMemory}
          active={() => activeTab() === "snyk"}
          takePendingFilter={() => {
            const query = state.snykPendingFilter();
            actions.setSnykPendingFilter(null);
            return query;
          }}
          mouseEnabled={props.view.mouseEnabled}
          onMouseFocus={props.view.onMouseFocus}
          scan={props.view.snykGetCommitData?.(props.sha) ?? null}
          contentWidth={props.view.contentWidth}
          onScan={snykScan}
          loading={props.view.snykIsScanning?.(props.sha) ?? false}
          {...cursor}
        />
      </Show>

      <Show when={activeTab() === "snyk-deps" && props.view.snykGetCommitData && props.view.snykScanCommit}>
        <SnykDependenciesTab
          memory={props.snykMemory}
          active={() => activeTab() === "snyk-deps"}
          setDetailCursorShortcut={actions.setDetailCursorShortcut}
          onShowVulnerabilities={query => {
            actions.setSnykPendingFilter(query);
            actions.setDetailCursorAction(null);
            actions.setDetailActiveTab("snyk");
            actions.setDetailCursorIndex(0);
          }}
          mouseEnabled={props.view.mouseEnabled}
          onMouseFocus={props.view.onMouseFocus}
          scan={props.view.snykGetCommitData?.(props.sha) ?? null}
          contentWidth={props.view.contentWidth}
          onScan={snykScan}
          loading={props.view.snykIsScanning?.(props.sha) ?? false}
          {...cursor}
        />
      </Show>
    </>
  );
}
