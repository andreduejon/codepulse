import { Show } from "solid-js";
import { type ProviderStatus, useAppState } from "../context/state";
import { BANNER } from "../debug/banner";
import { ActionsDetailTab } from "../providers/github-actions/detail-tab";
import { JenkinsDetailTab } from "../providers/jenkins/detail-tab";
import { OpenShiftDetailTab } from "../providers/openshift/detail-tab";
import type { ProviderDetailView } from "../providers/provider";
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
    setDetailCursorShortcut: actions.setDetailCursorShortcut,
  };
  /**
   * Why a provider cannot load: its status reason or, once that banner was dismissed, its own readiness check, so
   * closing a message never re-enables an action that cannot work.
   */
  const unavailable = (view: ProviderDetailView, status: ProviderStatus | undefined): string | null => {
    if (status?.kind === "unavailable") return status.message;
    state.providers.getVersion();
    return state.providers.get(view)?.isAvailable() === false ? "Setup incomplete." : null;
  };
  /** Like the CI and OpenShift Reload rows, Scan is muted and skipped while Snyk cannot work. */
  const snykUnavailable = () => unavailable("snyk", props.view.snykProviderStatus) !== null;
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
          unavailableReason={unavailable("github-actions", props.view.githubProviderStatus)}
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
          unavailableReason={unavailable("jenkins", props.view.jenkinsProviderStatus)}
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
            consoleUrl={props.view.openshiftConsoleUrl}
            onOpenResource={props.view.onOpenOpenShiftResource}
            unavailableReason={unavailable("openshift", props.view.openshiftProviderStatus)}
            liveUnavailable={
              props.view.openshiftProviderStatus?.kind === "error" &&
              props.view.openshiftProviderStatus.message === BANNER.openshift.tokenExpired
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
          unavailable={snykUnavailable()}
          {...cursor}
        />
      </Show>

      <Show when={activeTab() === "snyk-deps" && props.view.snykGetCommitData && props.view.snykScanCommit}>
        <SnykDependenciesTab
          memory={props.snykMemory}
          active={() => activeTab() === "snyk-deps"}
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
          unavailable={snykUnavailable()}
          {...cursor}
        />
      </Show>
    </>
  );
}
