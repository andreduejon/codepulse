import { detailEntry, type ProviderDetailSource } from "../shared/detail-entry";
import { JENKINS_LEGEND, JenkinsDetailTab } from "./detail-tab";
import type { JenkinsCommitData, JenkinsFailedTest, JenkinsJob, JenkinsJobFetchResult, JenkinsRun } from "./types";

/** What Jenkins hands the detail view. */
export interface JenkinsDetailSource extends ProviderDetailSource<JenkinsCommitData> {
  /** A build's stages and test report, read when it is expanded. */
  fetchJobsForRun: (run: JenkinsRun) => Promise<JenkinsJobFetchResult>;
  /** Read one commit again (`Reload commit`). */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  /** A build in the log viewer at an entry: 0 is the full log, stage `i` is `i + 1`. */
  onOpenBuild?: (run: JenkinsRun, pipeline: JenkinsJob, entry: number) => void;
  /** A failed test's error and stack in the log viewer, ←/→ to the other failed tests. */
  onOpenTestFailure?: (run: JenkinsRun, failed: JenkinsFailedTest[], index: number) => void;
}

export const jenkinsDetail = detailEntry({
  view: "jenkins",
  Tab: props => (
    <JenkinsDetailTab
      mouseEnabled={props.context.mouseEnabled}
      onMouseFocus={props.context.onMouseFocus}
      sha={props.context.sha}
      getCommitData={props.source.getCommitData}
      fetchJobsForRun={props.source.fetchJobsForRun}
      fetchCommitData={props.source.fetchCommitData}
      unavailableReason={props.context.unavailable("jenkins", props.source.status)}
      loading={props.source.status?.kind === "loading"}
      {...props.context.cursor}
      onOpenBuild={props.source.onOpenBuild}
      onOpenTestFailure={props.source.onOpenTestFailure}
    />
  ),
  legend: (source, sha) => ((source.getCommitData(sha)?.runs.length ?? 0) > 0 ? JENKINS_LEGEND : null),
});
