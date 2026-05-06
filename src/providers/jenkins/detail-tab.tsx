import { createEffect, createMemo, createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { ProviderRunTree, type ProviderTreeJob, type ProviderTreeRun } from "../shared/provider-run-tree";
import type { JenkinsCommitData, JenkinsJob, JenkinsJobFetchResult, JenkinsRun } from "./types";

export interface JenkinsDetailTabProps {
  sha: string;
  getCommitData: (sha: string) => JenkinsCommitData | null;
  fetchJobsForRun: (run: JenkinsRun) => Promise<JenkinsJobFetchResult>;
  fetchCommitData?: (sha: string) => Promise<void>;
  unavailableReason?: string | null;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  onOpenJobLog?: (job: JenkinsJob, run: JenkinsRun, jobs?: JenkinsJob[]) => void;
}

export function JenkinsDetailTab(props: Readonly<JenkinsDetailTabProps>) {
  const t = useT();
  const data = () => props.getCommitData(props.sha);
  const [requestedSha, setRequestedSha] = createSignal<string | null>(null);

  createEffect(() => {
    const sha = props.sha;
    if (props.loading || data()?.resolved || requestedSha() === sha) return;
    setRequestedSha(sha);
    void props.fetchCommitData?.(sha);
  });

  if (props.unavailableReason) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={2}>
        <text fg={t().foregroundMuted} wrapMode="word">
          Jenkins provider unavailable.
        </text>
        <box height={1} />
        <text fg={t().accent} wrapMode="word">
          {props.unavailableReason}
        </text>
        <box height={1} />
        <text fg={t().foregroundMuted} wrapMode="word">
          Configure jobs and token env in Menu → Providers.
        </text>
      </box>
    );
  }

  const runs = createMemo<ProviderTreeRun<JenkinsRun>[]>(() =>
    (data()?.runs ?? []).map(run => ({
      id: run.id,
      label: run.name,
      status: run.status,
      conclusion: run.conclusion,
      runNumber: run.runNumber,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      raw: run,
    })),
  );

  const mapJob = (job: JenkinsJob): ProviderTreeJob<JenkinsJob> => ({
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
    raw: job,
  });

  return (
    <ProviderRunTree
      runs={runs()}
      loading={props.loading}
      navRef={props.navRef}
      detailCursorIndex={props.detailCursorIndex}
      detailFocused={props.detailFocused}
      setDetailCursorAction={props.setDetailCursorAction}
      setDetailCursorIndex={props.setDetailCursorIndex}
      fetchJobsForRun={async run => {
        const { jobs, error } = await props.fetchJobsForRun(run.raw);
        return { jobs: jobs.map(mapJob), error };
      }}
      onOpenJobAction={(job, run, jobs) => props.onOpenJobLog?.(job.raw, run.raw, jobs?.map(entry => entry.raw) ?? [])}
      summaryLabel="total workflow runs"
      loadingText="Loading Jenkins runs…"
      emptyText="......"
      jobsLoadingText="Loading..."
      jobsUnavailableText="Unavailable"
      noJobsText="No items"
      autoExpandSingleRun
      childCountLabel={count => `${count} stage${count === 1 ? "" : "s"}`}
    />
  );
}
