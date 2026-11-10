import { createMemo, createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { BUSY } from "../../utils/busy-text";
import type { LegendItem } from "../shared/detail-legend";
import type { RowShortcut } from "../shared/open-row";
import { ProviderRunTree, type ProviderTreeJob, type ProviderTreeRun } from "../shared/provider-run-tree";
import { statusColor, statusIcon } from "../shared/status";
import { jenkinsTestsJob } from "./tests";
import type {
  JenkinsCommitData,
  JenkinsFailedTest,
  JenkinsJob,
  JenkinsJobFetchResult,
  JenkinsRun,
  JenkinsTreeRow,
} from "./types";

export interface JenkinsDetailTabProps {
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  sha: string;
  getCommitData: (sha: string) => JenkinsCommitData | null;
  fetchJobsForRun: (run: JenkinsRun, signal?: AbortSignal) => Promise<JenkinsJobFetchResult>;
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  unavailableReason?: string | null;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  setDetailCursorShortcut?: (shortcut: RowShortcut | null) => void;
  /**
   * Enter on a stage (or the Console row of a build without stages): the build in the log viewer at that entry. Entry 0
   * is the whole build (its summary, then the console), stage `i` is entry `i + 1`; ←/→ move between them.
   */
  onOpenBuild?: (run: JenkinsRun, pipeline: JenkinsJob, entry: number) => void;
  /** Enter on a failed test: its error and stack in the log viewer, ←/→ to the other failed tests. */
  onOpenTestFailure?: (run: JenkinsRun, failed: JenkinsFailedTest[], index: number) => void;
}

/** The row marks, explained below the tree. A cancelled build is `aborted` in Jenkins. */
export const JENKINS_LEGEND: LegendItem[] = (
  [
    ["pass", "passed"],
    ["running", "running"],
    ["fail", "failed"],
    ["skipped", "skipped"],
    ["cancelled", "aborted"],
  ] as const
).map(([category, label]) => [[[statusIcon(category), theme => statusColor(theme, category)]], label]);

/**
 * The rows under a build, as quiet as the OpenShift tree: each stage with its mark (times are in the log's summary),
 * or one Console row when the build has no stages; then the Tests row, when it has a report.
 */
function buildRows(pipeline: JenkinsJob, buildUrl: string): ProviderTreeJob<JenkinsTreeRow>[] {
  const logRow = (
    entry: number,
    name: string,
    state: Pick<JenkinsJob, "status" | "conclusion" | "startedAt" | "completedAt">,
  ): ProviderTreeJob<JenkinsTreeRow> => ({
    id: entry === 0 ? "console" : `stage:${entry}`,
    name,
    status: state.status,
    conclusion: state.conclusion,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    steps: [],
    url: buildUrl,
    raw: { kind: "log", pipeline, entry },
  });
  const stages =
    pipeline.steps.length > 0
      ? pipeline.steps.map((stage, index) => logRow(index + 1, stage.name, stage))
      : [logRow(0, "Console", pipeline)];
  return [...stages, ...(pipeline.tests ? [jenkinsTestsJob(pipeline.tests, buildUrl)] : [])];
}

export function JenkinsDetailTab(props: Readonly<JenkinsDetailTabProps>) {
  const data = () => props.getCommitData(props.sha);
  const [reloadBusy, setReloadBusy] = createSignal(false);

  const runs = createMemo<ProviderTreeRun<JenkinsRun>[]>(() =>
    (data()?.runs ?? []).map(run => ({
      id: run.id,
      label: run.name,
      status: run.status,
      conclusion: run.conclusion,
      runNumber: run.runNumber,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      url: run.url,
      raw: run,
    })),
  );

  return (
    <ProviderRunTree
      mouseEnabled={props.mouseEnabled}
      onMouseFocus={props.onMouseFocus}
      runs={runs()}
      navRef={props.navRef}
      detailCursorIndex={props.detailCursorIndex}
      detailFocused={props.detailFocused}
      setDetailCursorAction={props.setDetailCursorAction}
      setDetailCursorIndex={props.setDetailCursorIndex}
      setDetailCursorShortcut={props.setDetailCursorShortcut}
      fetchJobsForRun={async (run, signal) => {
        const { jobs, error } = await props.fetchJobsForRun(run.raw, signal);
        return { jobs: jobs.flatMap(pipeline => buildRows(pipeline, run.raw.url)), error };
      }}
      debugSource="Jenkins"
      dataKey={props.sha}
      onOpenJobAction={(job, run) => {
        const row = job.raw;
        if (row.kind === "log") props.onOpenBuild?.(run.raw, row.pipeline, row.entry);
        else if (row.report.failed.length > 0) props.onOpenTestFailure?.(run.raw, row.report.failed, 0);
      }}
      onOpenNote={(note, job, run) => {
        const failed = job.raw.kind === "tests" ? job.raw.report.failed : [];
        props.onOpenTestFailure?.(run.raw, failed, Number(note.id));
      }}
      noteAction="view failure"
      noteMarks={false}
      summaryLabel="total builds"
      jobsLoadingText={BUSY.fetchingStages}
      reloadBusyText={BUSY.fetchingBuilds}
      noJobsText=""
      showRunDuration={false}
      showJobDuration={false}
      onReloadCommit={async () => {
        if (reloadBusy() || props.unavailableReason) return;
        setReloadBusy(true);
        try {
          await props.fetchCommitData?.(props.sha, true);
        } finally {
          setReloadBusy(false);
        }
      }}
      reloadLabel={data() ? "Reload commit" : "Load commit"}
      reloadBusy={reloadBusy() || !!props.loading}
      reloadEnabled={!props.unavailableReason}
      showSummary={!!data()}
    />
  );
}
