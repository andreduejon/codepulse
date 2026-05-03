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

import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { formatDuration, formatRelativeDate } from "../../utils/date";
import { categorize, statusColor } from "./status";
import type { GitHubCommitData, GitHubJob, GitHubJobFetchResult, GitHubStep, GitHubWorkflowRun } from "./types";

// ── Flat item list ─────────────────────────────────────────────────────────

type FlatItem =
  | { kind: "run"; run: GitHubWorkflowRun; flatIndex: number }
  | { kind: "job"; job: GitHubJob; run: GitHubWorkflowRun; flatIndex: number };

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

  const STATUS_COL_WIDTH = 2;

  const formatStepDuration = (step: GitHubStep) => formatDuration(step.startedAt, step.completedAt);
  const formatRunDuration = (run: GitHubWorkflowRun) => {
    const duration = formatDuration(run.startedAt ?? null, run.updatedAt);
    return duration ? `~${duration}` : "";
  };
  const statusMark = (status: string, conclusion: string | null) => {
    const cat = categorize(status, conclusion);
    switch (cat) {
      case "pass":
        return "✓";
      case "fail":
        return "✕";
      case "running":
        return "●";
      case "cancelled":
        return "○";
      case "skipped":
        return "–";
      default:
        return "?";
    }
  };

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

  // ── Expand / jobs state ───────────────────────────────────────────────

  /** Set of run IDs that are expanded (showing their jobs). */
  const [expandedRuns, setExpandedRuns] = createSignal<Set<number>>(new Set());
  /** Map of run ID → fetched jobs. Wrapped in a signal so changes trigger re-renders. */
  const [fetchedJobs, setFetchedJobs] = createSignal<Map<number, GitHubJob[]>>(new Map());
  /** Map of run ID → fetch error. */
  const [jobErrors, setJobErrors] = createSignal<Map<number, string>>(new Map());
  /** Set of run IDs with an in-flight job fetch. */
  const [loadingRuns, setLoadingRuns] = createSignal<Set<number>>(new Set());
  /** Tracks which commit SHA already received the one-time single-run auto-expand. */
  let autoExpandedSha: string | null = null;

  const rightInfoWidth = createMemo(() => {
    let max = 0;
    const runs = actionsData()?.runs ?? [];
    for (const run of runs) {
      max = Math.max(max, formatRelativeDate(run.updatedAt).length);
    }
    for (const jobs of fetchedJobs().values()) {
      for (const job of jobs) {
        const label = job.steps.length > 0 ? `${job.steps.length} step${job.steps.length === 1 ? "" : "s"}` : "";
        max = Math.max(max, label.length);
      }
    }
    return max;
  });

  const durationWidth = createMemo(() => {
    let max = 0;
    const runs = actionsData()?.runs ?? [];
    for (const run of runs) {
      max = Math.max(max, formatRunDuration(run).length);
    }
    for (const jobs of fetchedJobs().values()) {
      for (const job of jobs) {
        max = Math.max(max, formatDuration(job.startedAt, job.completedAt).length);
      }
    }
    return max;
  });

  createEffect(() => {
    const sha = props.sha;
    const runs = actionsData()?.runs ?? [];
    if (autoExpandedSha === sha) return;
    if (runs.length !== 1) return;
    if (expandedRuns().has(runs[0].id)) return;
    autoExpandedSha = sha;
    toggleRun(runs[0]);
  });

  /** Element refs for all interactive flat items. */
  const itemRefs: Renderable[] = [];

  // ── Flat item list ────────────────────────────────────────────────────

  const flatItems = createMemo((): FlatItem[] => {
    const data = actionsData();
    if (!data) return [];
    const expanded = expandedRuns();
    const jobs = fetchedJobs();
    const items: FlatItem[] = [];
    let idx = 0;
    for (const run of data.runs) {
      items.push({ kind: "run", run, flatIndex: idx++ });
      if (expanded.has(run.id)) {
        const runJobs = jobs.get(run.id) ?? [];
        for (const job of runJobs) {
          items.push({ kind: "job", job, run, flatIndex: idx++ });
        }
      }
    }
    return items;
  });

  // ── Toggle expand ─────────────────────────────────────────────────────

  const toggleRun = (run: GitHubWorkflowRun) => {
    const nowExpanded = !expandedRuns().has(run.id);
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (nowExpanded) next.add(run.id);
      else next.delete(run.id);
      return next;
    });
    if (nowExpanded && !fetchedJobs().has(run.id) && !loadingRuns().has(run.id)) {
      setLoadingRuns(prev => new Set([...prev, run.id]));
      props.fetchJobsForRun(run).then(({ jobs, error }) => {
        setFetchedJobs(prev => {
          const next = new Map(prev);
          next.set(run.id, jobs);
          return next;
        });
        setJobErrors(prev => {
          const next = new Map(prev);
          if (error) next.set(run.id, error);
          else next.delete(run.id);
          return next;
        });
        setLoadingRuns(prev => {
          const next = new Set(prev);
          next.delete(run.id);
          return next;
        });
      });
    }
  };

  // ── navRef sync ───────────────────────────────────────────────────────

  // Clamp cursor when items change
  createEffect(() => {
    const count = flatItems().length;
    const cursor = untrack(() => props.detailCursorIndex());
    if (count === 0) {
      props.setDetailCursorIndex(0);
    } else if (cursor < 0 || cursor >= count) {
      props.setDetailCursorIndex(Math.max(0, Math.min(count - 1, cursor)));
    }
  });

  createEffect(() => {
    const items = flatItems();
    if (!props.navRef) return;
    props.navRef.itemCount = items.length;
    props.navRef.itemRefs = itemRefs;
    props.navRef.activateCurrentItem = () => {
      const cursor = props.detailCursorIndex();
      const item = items[cursor];
      if (!item) return false;
      if (item.kind === "run") {
        toggleRun(item.run);
      } else if (item.kind === "job") {
        props.onOpenJobLog?.(item.job, item.run, fetchedJobs().get(item.run.id) ?? []);
      }
      return false;
    };
  });

  // Footer hint effect
  createEffect(() => {
    const items = flatItems();
    const idx = props.detailCursorIndex();
    if (!props.detailFocused() || idx < 0 || idx >= items.length) {
      props.setDetailCursorAction(null);
      return;
    }
    const item = items[idx];
    if (item.kind === "run") {
      props.setDetailCursorAction(expandedRuns().has(item.run.id) ? "collapse" : "expand");
    } else if (item.kind === "job") {
      props.setDetailCursorAction("view log");
    }
  });

  // ── Render ────────────────────────────────────────────────────────────

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
          <box flexDirection="row" width="100%">
            <box flexGrow={1}>
              <text fg={t().foregroundMuted} wrapMode="none">
                total workflow runs
              </text>
            </box>
            <box flexShrink={0} width={2} />
            <text fg={t().foregroundMuted} wrapMode="none">
              {data().runs.length}
            </text>
          </box>
          <For each={data().runs}>
            {(run, runIndexFn) => {
              const runFlatIndex = () => flatItems().findIndex(it => it.kind === "run" && it.run.id === run.id);
              const isExpanded = () => expandedRuns().has(run.id);
              const isLoading = () => loadingRuns().has(run.id);
              const jobs = () => fetchedJobs().get(run.id) ?? [];
              const jobError = () => jobErrors().get(run.id) ?? null;
              const isCursored = () => props.detailFocused() && props.detailCursorIndex() === runFlatIndex();
              const cat = categorize(run.status, run.conclusion);
              const color = () => statusColor(t(), cat);
              const relTime = () => formatRelativeDate(run.updatedAt);
              const runDuration = () => formatRunDuration(run);
              const runTreePrefix = () => (runIndexFn() === data().runs.length - 1 ? "└─ " : "├─ ");
              const runIndicatorColor = () => (isCursored() ? t().accent : t().foregroundMuted);
              const runTextColor = () => (isCursored() ? t().accent : t().foreground);
              const runIsLast = () => runIndexFn() === data().runs.length - 1;

              return (
                <box flexDirection="column" width="100%">
                  {/* Run header */}
                  <box
                    ref={(el: Renderable) => {
                      const fi = runFlatIndex();
                      if (fi >= 0) itemRefs[fi] = el;
                    }}
                    flexDirection="row"
                    width="100%"
                    backgroundColor={isCursored() ? t().backgroundElementActive : undefined}
                  >
                    <text flexShrink={0} wrapMode="none" fg={t().border}>
                      {runTreePrefix()}
                    </text>
                    <text flexShrink={0} wrapMode="none" fg={runIndicatorColor()}>
                      {isExpanded() ? "▾ " : "▸ "}
                    </text>
                    <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={runTextColor()}>
                      {`${run.name}  #${run.runNumber}`}
                    </text>
                    <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                      {relTime().padStart(rightInfoWidth())}
                    </text>
                    <Show when={durationWidth() > 0}>
                      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                        {runDuration()
                          ? ` ${runDuration().padStart(durationWidth())}`
                          : " ".repeat(durationWidth() + 1)}
                      </text>
                    </Show>
                    <text flexShrink={0} width={STATUS_COL_WIDTH} wrapMode="none" fg={color()}>
                      {statusMark(run.status, run.conclusion).padStart(STATUS_COL_WIDTH)}
                    </text>
                  </box>

                  {/* Jobs — shown when expanded */}
                  <Show when={isExpanded()}>
                    <Show when={isLoading()}>
                      <box>
                        <text fg={t().foregroundMuted}>Loading jobs…</text>
                      </box>
                    </Show>
                    <Show when={!isLoading() && jobError()}>
                      <box>
                        <text fg={t().foregroundMuted}>Jobs unavailable</text>
                      </box>
                    </Show>
                    <Show when={!isLoading() && !jobError() && jobs().length === 0}>
                      <box>
                        <text fg={t().foregroundMuted}>No jobs found</text>
                      </box>
                    </Show>
                    <For each={jobs()}>
                      {(job, jobIndexFn) => {
                        const jobFlatIndex = () =>
                          flatItems().findIndex(
                            it => it.kind === "job" && it.job.id === job.id && it.run.id === run.id,
                          );
                        const isJobCursored = () =>
                          props.detailFocused() && props.detailCursorIndex() === jobFlatIndex();
                        const jobCat = categorize(job.status, job.conclusion);
                        const jobColor = () => statusColor(t(), jobCat);
                        const duration = formatDuration(job.startedAt, job.completedAt);
                        const stepCountLabel = () =>
                          job.steps.length > 0 ? `${job.steps.length} step${job.steps.length === 1 ? "" : "s"}` : "";
                        const jobTextColor = () => (isJobCursored() ? t().accent : t().foreground);
                        const jobTreeLead = () => (runIsLast() ? "   " : "│  ");
                        const jobTreePrefix = () => (jobIndexFn() === jobs().length - 1 ? "└─ " : "├─ ");
                        const jobIsLast = () => jobIndexFn() === jobs().length - 1;

                        return (
                          <box flexDirection="column" width="100%">
                            <box
                              ref={(el: Renderable) => {
                                const fi = jobFlatIndex();
                                if (fi >= 0) itemRefs[fi] = el;
                              }}
                              flexDirection="row"
                              width="100%"
                              backgroundColor={isJobCursored() ? t().backgroundElementActive : undefined}
                            >
                              <text flexShrink={0} wrapMode="none" fg={t().border}>
                                {jobTreeLead()}
                                {jobTreePrefix()}
                              </text>
                              <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={jobTextColor()}>
                                {job.name}
                              </text>
                              <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                {stepCountLabel().padStart(rightInfoWidth())}
                              </text>
                              <Show when={durationWidth() > 0}>
                                <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                  {duration
                                    ? ` ${duration.padStart(durationWidth())}`
                                    : " ".repeat(durationWidth() + 1)}
                                </text>
                              </Show>
                              <text flexShrink={0} width={STATUS_COL_WIDTH} wrapMode="none" fg={jobColor()}>
                                {statusMark(job.status, job.conclusion).padStart(STATUS_COL_WIDTH)}
                              </text>
                            </box>

                            <Show when={job.steps.length > 0}>
                              <For each={job.steps}>
                                {(step, stepIndexFn) => {
                                  const stepCat = categorize(step.status, step.conclusion);
                                  const stepColor = () => statusColor(t(), stepCat);
                                  const stepDuration = () => formatStepDuration(step);
                                  const stepTreePrefix = () => jobTreeLead() + (jobIsLast() ? "   " : "│  ");
                                  const stepConnector = () => (stepIndexFn() === job.steps.length - 1 ? "└─ " : "├─ ");

                                  return (
                                    <box flexDirection="row" width="100%">
                                      <text flexShrink={0} wrapMode="none" fg={t().border}>
                                        {stepTreePrefix()}
                                        {stepConnector()}
                                      </text>
                                      <text
                                        flexGrow={1}
                                        flexShrink={1}
                                        wrapMode="none"
                                        truncate
                                        fg={t().foregroundMuted}
                                      >
                                        {step.name}
                                      </text>
                                      {stepDuration() ? (
                                        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                          {stepDuration()}
                                        </text>
                                      ) : null}
                                      <text flexShrink={0} width={STATUS_COL_WIDTH} wrapMode="none" fg={stepColor()}>
                                        {statusMark(step.status, step.conclusion).padStart(STATUS_COL_WIDTH)}
                                      </text>
                                    </box>
                                  );
                                }}
                              </For>
                            </Show>
                          </box>
                        );
                      }}
                    </For>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
      )}
    </Show>
  );
}
