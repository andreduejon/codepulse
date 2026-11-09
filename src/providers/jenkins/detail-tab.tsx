import { createMemo, createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { BUSY } from "../../utils/busy-text";
import type { RowShortcut } from "../shared/open-row";
import { ProviderRunTree, type ProviderTreeJob, type ProviderTreeRun } from "../shared/provider-run-tree";
import type { JenkinsCommitData, JenkinsJob, JenkinsJobFetchResult, JenkinsRun } from "./types";

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
  onOpenJobLog?: (job: JenkinsJob, run: JenkinsRun, jobs?: JenkinsJob[]) => void;
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

  /** The Pipeline job is the build itself, so it opens the build page. */
  const mapJob = (job: JenkinsJob, buildUrl: string): ProviderTreeJob<JenkinsJob> => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    steps: job.steps.map((step, idx) => ({
      id: `${step.id}:${idx}`,
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
    })),
    url: buildUrl,
    raw: job,
  });

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
        return { jobs: jobs.map(job => mapJob(job, run.raw.url)), error };
      }}
      debugSource="Jenkins"
      dataKey={props.sha}
      onOpenJobAction={(job, run, jobs) => props.onOpenJobLog?.(job.raw, run.raw, jobs?.map(entry => entry.raw) ?? [])}
      summaryLabel="total builds"
      jobsLoadingText={BUSY.fetchingStages}
      reloadBusyText={BUSY.fetchingBuilds}
      noJobsText=""
      showRunDuration={false}
      childCountLabel={count => `${count} stage${count === 1 ? "" : "s"}`}
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
