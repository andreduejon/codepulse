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

import { createEffect, createMemo, createSignal } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import {
  ProviderRunTree,
  type ProviderTreeJob,
  type ProviderTreeRun,
  type ProviderTreeStep,
} from "../shared/provider-run-tree";
import type { GitHubCommitData, GitHubJob, GitHubJobFetchResult, GitHubStep, GitHubWorkflowRun } from "./types";

// ── Props ─────────────────────────────────────────────────────────────────

export interface ActionsDetailTabProps {
  /** SHA of the selected commit. */
  sha: string;
  /** Get all CI data for the commit (run list). */
  getCommitData: (sha: string) => GitHubCommitData | null;
  /**
   * Fetch full job details (with steps) for a run on demand.
   * Called when the user expands a run entry. Checks cache first.
   */
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJobFetchResult>;
  /** Fetch CI data for the selected SHA when it was not in the preload window. */
  fetchCommitData?: (sha: string) => Promise<void>;
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
  const t = useT();
  const actionsData = () => props.getCommitData(props.sha);
  const [requestedSha, setRequestedSha] = createSignal<string | null>(null);

  createEffect(() => {
    const sha = props.sha;
    if (props.loading) return;
    if (actionsData()) return;
    if (requestedSha() === sha) return;
    setRequestedSha(sha);
    void props.fetchCommitData?.(sha);
  });

  // When the provider is registered but unavailable, show setup guidance.
  if (props.unavailableReason) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={2}>
        <text fg={t().foregroundMuted} wrapMode="word">
          Set a GitHub Personal Access Token via environment variable:
        </text>
        <box height={1} />
        <text fg={t().accent} wrapMode="none">
          {"  export GITHUB_TOKEN=<token>"}
        </text>
        <box height={1} />
        <text fg={t().foregroundMuted} wrapMode="word">
          {"Configure the variable name in Menu \u2192 Providers \u2192 Token env."}
        </text>
        <box height={1} />
        <text fg={t().foregroundMuted} wrapMode="word">
          {"See :help \u2192 Providers for more details."}
        </text>
      </box>
    );
  }

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
      loadingText="Loading GitHub Actions runs..."
      emptyText="No GitHub Actions runs for this commit"
      jobsLoadingText="Loading..."
      jobsUnavailableText="Unavailable"
      noJobsText="No items"
      autoExpandSingleRun
    />
  );
}
