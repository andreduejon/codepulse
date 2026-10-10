/**
 * GitHub Actions CI detail tab.
 *
 * Layout:
 *   - Each run header shows: status icon, workflow name, run number, time, event
 *   - Expanding a run (Enter key) fetches its jobs via REST and shows them inline
 *   - Enter on a job will open the log dialog (wired in a later commit)
 *
 * Cursor system:
 *   - Builds a flat `FlatItem[]` list from runs + expanded jobs
 *   - Writes itemCount / activateCurrentItem / itemRefs to navRef on every change
 *   - Highlights the row matching state.detailCursorIndex()
 *
 * Receives props directly (not via useContext) because this component may be
 * rendered during setup before the AppStateContext.Provider mounts (AGENTS.md rule 5).
 */

import { createMemo, createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import {
  ProviderRunTree,
  type ProviderTreeJob,
  type ProviderTreeRun,
  type ProviderTreeStep,
} from "../shared/provider-run-tree";
import type { GitHubCommitData, GitHubJob, GitHubJobFetchResult, GitHubStep, GitHubWorkflowRun } from "./types";

// ── Props ─────────────────────────────────────────────────────────────────

export interface ActionsDetailTabProps {
  mouseEnabled?: boolean;
  /** SHA of the selected commit. */
  sha: string;
  /** Get all CI data for the commit (run list). */
  getCommitData: (sha: string) => GitHubCommitData | null;
  /**
   * Fetch full job details (with steps) for a run on demand.
   * Called when the user expands a run entry. Checks cache first.
   */
  fetchJobsForRun: (run: GitHubWorkflowRun, signal?: AbortSignal) => Promise<GitHubJobFetchResult>;
  /** Fetch CI data for the selected SHA. `force` re-queries even if already loaded. */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  /**
   * When set, the provider is enabled but not yet available (e.g. missing
   * token or no GitHub remote).  The tab shows setup guidance instead of
   * run data.  The string is the human-readable reason from providerStatus.
   */
  unavailableReason?: string | null;
  /**
   * True while the initial CI data fetch is in-flight.  Shown as a loading
   * indicator in the fallback so the user doesn't see "No CI data for this
   * commit" before the request has even completed.
   */
  loading?: boolean;
  /**
   * Mutable navRef to populate so the keyboard handler can navigate items.
   * When provided, this component owns navRef while the github-actions tab is active.
   */
  navRef?: DetailNavRef;
  /** Current cursor index from app state (passed as accessor to avoid useContext during setup). */
  detailCursorIndex: () => number;
  /** Whether the detail panel has focus (for highlight rendering). */
  detailFocused: () => boolean;
  /** Set the footer cursor action hint. */
  setDetailCursorAction: (action: string | null) => void;
  /** Move the detail cursor to a specific index. */
  setDetailCursorIndex: (idx: number) => void;
  /** Called when Enter is pressed on a job — opens the log dialog. */
  onOpenJobLog?: (job: GitHubJob, run: GitHubWorkflowRun, jobs?: GitHubJob[]) => void;
}

// ── Top-level component ───────────────────────────────────────────────────

export function ActionsDetailTab(props: Readonly<ActionsDetailTabProps>) {
  const actionsData = () => props.getCommitData(props.sha);
  const [reloadBusy, setReloadBusy] = createSignal(false);

  const runs = createMemo<ProviderTreeRun<GitHubWorkflowRun>[]>(() =>
    (actionsData()?.runs ?? []).map(run => ({
      id: String(run.id),
      label: run.name,
      status: run.status,
      conclusion: run.conclusion,
      runNumber: run.runNumber,
      startedAt: run.startedAt ?? null,
      updatedAt: run.updatedAt,
      raw: run,
    })),
  );

  const mapStep = (step: GitHubStep, idx: number): ProviderTreeStep => ({
    id: `${step.number}:${idx}`,
    name: step.name,
    status: step.status,
    conclusion: step.conclusion,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
  });

  const mapJob = (job: GitHubJob): ProviderTreeJob<GitHubJob> => ({
    id: String(job.id),
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    steps: job.steps.map(mapStep),
    raw: job,
  });

  return (
    <ProviderRunTree
      mouseEnabled={props.mouseEnabled}
      runs={runs()}
      navRef={props.navRef}
      detailCursorIndex={props.detailCursorIndex}
      detailFocused={props.detailFocused}
      setDetailCursorAction={props.setDetailCursorAction}
      setDetailCursorIndex={props.setDetailCursorIndex}
      fetchJobsForRun={async (run, signal) => {
        const { jobs, error } = await props.fetchJobsForRun(run.raw, signal);
        return { jobs: jobs.map(mapJob), error };
      }}
      debugSource="GitHub"
      dataKey={props.sha}
      onOpenJobAction={(job, run, jobs) => props.onOpenJobLog?.(job.raw, run.raw, jobs?.map(entry => entry.raw) ?? [])}
      summaryLabel="total workflow runs"
      jobsLoadingText="loading jobs..."
      noJobsText=""
      onReloadCommit={async () => {
        if (reloadBusy() || props.unavailableReason) return;
        setReloadBusy(true);
        try {
          await props.fetchCommitData?.(props.sha, true);
        } finally {
          setReloadBusy(false);
        }
      }}
      reloadLabel={actionsData() ? "Reload commit" : "Load commit"}
      reloadBusy={reloadBusy() || !!props.loading}
      reloadEnabled={!props.unavailableReason}
      showSummary={!!actionsData()}
    />
  );
}
