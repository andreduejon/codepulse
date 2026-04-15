/**
 * GitHub Actions CI detail tab.
 *
 * Renders the "CI" tab in the commit detail panel when the selected commit
 * has GitHub Actions run data. Shows all runs (from the already-fetched badge
 * cache) with key metadata. Each run can be expanded to show jobs and steps
 * (fetched on demand via fetchJobsForRun).
 *
 * Receives getCommitData/fetchJobsForRun via props (not useContext) because
 * this component may be rendered during setup before the Provider mounts.
 */

import { createSignal, For, Show } from "solid-js";
import { useT } from "../../hooks/use-t";
import { formatRelativeDate } from "../../utils/date";
import type { GitHubCommitData, GitHubJob, GitHubWorkflowRun } from "./types";

// ── Status helpers ────────────────────────────────────────────────────────

function statusIcon(run: GitHubWorkflowRun): string {
  if (run.status !== "completed") return "●";
  switch (run.conclusion) {
    case "success":
      return "✓";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "✗";
    case "cancelled":
      return "○";
    case "skipped":
      return "–";
    default:
      return "?";
  }
}

function statusLabel(run: GitHubWorkflowRun): string {
  if (run.status !== "completed") return run.status.replace("_", " ");
  return run.conclusion ?? "completed";
}

interface StatusColors {
  icon: string;
  text: string;
}

function useRunStatusColors(run: GitHubWorkflowRun): () => StatusColors {
  const t = useT();
  return () => {
    if (run.status !== "completed") {
      const c = t().accent;
      return { icon: c, text: c };
    }
    switch (run.conclusion) {
      case "success":
        return { icon: t().success, text: t().success };
      case "failure":
      case "timed_out":
      case "startup_failure":
        return { icon: t().error, text: t().error };
      default:
        return { icon: t().foregroundMuted, text: t().foregroundMuted };
    }
  };
}

function jobStatusColor(t: ReturnType<typeof useT>, job: GitHubJob): string {
  if (job.status !== "completed") return t().accent;
  switch (job.conclusion) {
    case "success":
      return t().success;
    case "failure":
    case "timed_out":
      return t().error;
    default:
      return t().foregroundMuted;
  }
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface CIDetailTabProps {
  /** SHA of the selected commit. */
  sha: string;
  /** Get all CI data for the commit. */
  getCommitData: (sha: string) => GitHubCommitData | null;
  /** Fetch jobs for a run on demand. */
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJob[]>;
}

// ── Component ─────────────────────────────────────────────────────────────

export function CIDetailTab(props: Readonly<CIDetailTabProps>) {
  const t = useT();

  const ciData = () => props.getCommitData(props.sha);

  return (
    <Show
      when={ciData()}
      fallback={
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={t().foregroundMuted}>No CI data for this commit</text>
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

// ── RunEntry ──────────────────────────────────────────────────────────────

interface RunEntryProps {
  run: GitHubWorkflowRun;
  index: number;
  fetchJobsForRun: (run: GitHubWorkflowRun) => Promise<GitHubJob[]>;
}

function RunEntry(props: Readonly<RunEntryProps>) {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);
  const [jobs, setJobs] = createSignal<GitHubJob[]>([]);
  const [jobsLoading, setJobsLoading] = createSignal(false);

  const colors = useRunStatusColors(props.run);

  // TODO: wire toggleExpand to keyboard cursor activation in a future commit
  const _toggleExpand = async () => {
    const nowExpanded = !expanded();
    setExpanded(nowExpanded);
    if (nowExpanded && jobs().length === 0 && !jobsLoading()) {
      setJobsLoading(true);
      const result = await props.fetchJobsForRun(props.run);
      setJobs(result);
      setJobsLoading(false);
    }
  };

  const relTime = () => {
    return formatRelativeDate(props.run.updatedAt);
  };

  return (
    <box flexDirection="column" width="100%" paddingLeft={2}>
      {/* Spacer between runs */}
      {props.index > 0 ? <box height={1} /> : null}

      {/* Run header row */}
      <box flexDirection="row" width="100%">
        <text flexShrink={0} wrapMode="none" fg={colors().icon}>
          {expanded() ? "▾ " : "▸ "}
          {statusIcon(props.run)}{" "}
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
      <box flexDirection="row" width="100%" paddingLeft={4}>
        <text flexShrink={0} wrapMode="none" fg={colors().text}>
          {statusLabel(props.run)}
        </text>
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {"  "}
          {relTime()}
          {"  "}
          {props.run.event}
        </text>
      </box>

      {/* Expanded jobs */}
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
        <For each={jobs()}>{job => <JobEntry job={job} />}</For>
      </Show>
    </box>
  );
}

// ── JobEntry ──────────────────────────────────────────────────────────────

interface JobEntryProps {
  job: GitHubJob;
}

function JobEntry(props: Readonly<JobEntryProps>) {
  const t = useT();
  const color = () => jobStatusColor(t, props.job);

  return (
    <box flexDirection="column" width="100%" paddingLeft={4}>
      <box flexDirection="row" width="100%">
        <text flexShrink={0} wrapMode="none" fg={color()}>
          {"  "}
          {props.job.status !== "completed" ? "●" : props.job.conclusion === "success" ? "✓" : "✗"}{" "}
        </text>
        <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foreground}>
          {props.job.name}
        </text>
      </box>
    </box>
  );
}
