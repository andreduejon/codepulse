/**
 * GitHub Actions CI detail tab.
 *
 * Layout:
 *   - Each run header shows: status icon, workflow name, run number, time, event
 *   - Expanding a run (enter key) fetches its jobs+steps on demand via fetchJobsForRun (REST)
 *
 * Receives props directly (not via useContext) because this component may be
 * rendered during setup before the AppStateContext.Provider mounts (AGENTS.md rule 5).
 */

import { createSignal, For, Show } from "solid-js";
import type { Theme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import { formatRelativeDate } from "../../utils/date";
import { categorize, statusColor, statusIcon } from "./status";
import type { GitHubCommitData, GitHubJob, GitHubStep, GitHubWorkflowRun } from "./types";

// ── Status helpers (thin wrappers that extract status/conclusion) ──────────

function runIcon(run: GitHubWorkflowRun): string {
  return statusIcon(categorize(run.status, run.conclusion));
}

function runColor(t: Theme, run: GitHubWorkflowRun): string {
  return statusColor(t, categorize(run.status, run.conclusion));
}

function jobIcon(job: GitHubJob): string {
  return statusIcon(categorize(job.status, job.conclusion));
}

function jobColorFn(t: Theme, job: GitHubJob): string {
  return statusColor(t, categorize(job.status, job.conclusion));
}

function stepIcon(step: GitHubStep): string {
  return statusIcon(categorize(step.status, step.conclusion));
}

function stepColorFn(t: Theme, step: GitHubStep): string {
  return statusColor(t, categorize(step.status, step.conclusion));
}

function runStatusLabel(run: GitHubWorkflowRun): string {
  if (run.status !== "completed") return run.status.replace("_", " ");
  return run.conclusion ?? "completed";
}

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
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJob[]>;
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
}

// ── Top-level component ───────────────────────────────────────────────────

export function ActionsDetailTab(props: Readonly<ActionsDetailTabProps>) {
  const t = useT();
  const actionsData = () => props.getCommitData(props.sha);

  // When the provider is registered but unavailable, show setup guidance.
  if (props.unavailableReason) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={2}>
        <text fg={t().foregroundMuted} wrapMode="word">
          {props.unavailableReason}
        </text>
        <box height={1} />
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

  return (
    <Show
      when={actionsData()}
      fallback={
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={t().foregroundMuted}>{props.loading ? "Loading CI data..." : "No CI data for this commit"}</text>
        </box>
      }
    >
      {data => (
        <box flexDirection="column" width="100%">
          <box height={1} />
          <text fg={t().accent} wrapMode="none">
            <strong>github</strong>
          </text>
          <box height={1} />
          <For each={data().runs}>
            {(run, i) => <RunEntry run={run} index={i()} fetchJobsForRun={props.fetchJobsForRun} />}
          </For>
        </box>
      )}
    </Show>
  );
}

// ── RunEntry — shows run header; expands to fetch and show jobs ───────────

interface RunEntryProps {
  run: GitHubWorkflowRun;
  index: number;
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJob[]>;
}

function RunEntry(props: Readonly<RunEntryProps>) {
  const t = useT();
  const color = () => runColor(t(), props.run);
  const relTime = () => formatRelativeDate(props.run.updatedAt);

  const [expanded, setExpanded] = createSignal(false);
  const [jobs, setJobs] = createSignal<GitHubJob[]>([]);
  const [jobsLoading, setJobsLoading] = createSignal(false);

  // TODO: wire toggleExpand to keyboard cursor activation in a future commit
  const _toggleExpand = async () => {
    const nowExpanded = !expanded();
    setExpanded(nowExpanded);
    if (nowExpanded && jobs().length === 0 && !jobsLoading()) {
      setJobsLoading(true);
      const fetched = await props.fetchJobsForRun(props.run);
      setJobs(fetched);
      setJobsLoading(false);
    }
  };

  return (
    <box flexDirection="column" width="100%" paddingLeft={2}>
      {props.index > 0 ? <box height={1} /> : null}

      {/* Run header */}
      <box flexDirection="row" width="100%">
        <text flexShrink={0} wrapMode="none" fg={color()}>
          {runIcon(props.run)}{" "}
        </text>
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foreground}>
          {props.run.name}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {" "}
          #{props.run.runNumber}
        </text>
      </box>

      {/* Run sub-info */}
      <box flexDirection="row" width="100%" paddingLeft={3}>
        <text flexShrink={0} wrapMode="none" fg={color()}>
          {runStatusLabel(props.run)}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {"  "}
          {relTime()}
          {"  "}
          {props.run.event}
        </text>
      </box>

      {/* Jobs — loaded on expansion via REST */}
      <Show when={expanded()}>
        <Show when={jobsLoading()}>
          <box paddingLeft={4}>
            <text fg={t().foregroundMuted}>Loading jobs…</text>
          </box>
        </Show>
        <Show when={!jobsLoading() && jobs().length === 0}>
          <box paddingLeft={4}>
            <text fg={t().foregroundMuted}>No jobs found</text>
          </box>
        </Show>
        <For each={jobs()}>{job => <JobEntry job={job} fetchJobsForRun={props.fetchJobsForRun} run={props.run} />}</For>
      </Show>
    </box>
  );
}

// ── JobEntry — shows job status inline; expands to show steps ────────────

interface JobEntryProps {
  job: GitHubJob;
  run: GitHubWorkflowRun;
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJob[]>;
}

function JobEntry(props: Readonly<JobEntryProps>) {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);
  const [steps, setSteps] = createSignal<GitHubStep[]>(props.job.steps ?? []);
  const [stepsLoading, setStepsLoading] = createSignal(false);

  const color = () => jobColorFn(t(), props.job);

  // TODO: wire toggleExpand to keyboard cursor activation in a future commit
  const _toggleExpand = async () => {
    const nowExpanded = !expanded();
    setExpanded(nowExpanded);
    // Fetch steps on first expansion if not already available
    if (nowExpanded && steps().length === 0 && !stepsLoading()) {
      setStepsLoading(true);
      // fetchJobsForRun checks the cache first, then falls back to REST
      const jobs = await props.fetchJobsForRun(props.run);
      const thisJob = jobs.find(j => j.id === props.job.id);
      setSteps(thisJob?.steps ?? []);
      setStepsLoading(false);
    }
  };

  return (
    <box flexDirection="column" width="100%" paddingLeft={4}>
      {/* Job row */}
      <box flexDirection="row" width="100%">
        <text flexShrink={0} wrapMode="none" fg={color()}>
          {expanded() ? "▾ " : "▸ "}
          {jobIcon(props.job)}{" "}
        </text>
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foreground}>
          {props.job.name}
        </text>
      </box>

      {/* Steps — shown on expansion */}
      <Show when={expanded()}>
        <Show when={stepsLoading()}>
          <box paddingLeft={4}>
            <text fg={t().foregroundMuted}>Loading steps…</text>
          </box>
        </Show>
        <Show when={!stepsLoading() && steps().length === 0}>
          <box paddingLeft={4}>
            <text fg={t().foregroundMuted}>No steps found</text>
          </box>
        </Show>
        <For each={steps()}>{step => <StepEntry step={step} />}</For>
      </Show>
    </box>
  );
}

// ── StepEntry ─────────────────────────────────────────────────────────────

interface StepEntryProps {
  step: GitHubStep;
}

function StepEntry(props: Readonly<StepEntryProps>) {
  const t = useT();
  const color = () => stepColorFn(t(), props.step);

  return (
    <box flexDirection="row" width="100%" paddingLeft={6}>
      <text flexShrink={0} wrapMode="none" fg={color()}>
        {stepIcon(props.step)}{" "}
      </text>
      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
        {props.step.name}
      </text>
    </box>
  );
}
