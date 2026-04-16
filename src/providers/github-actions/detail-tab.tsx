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
import { categorize, statusColor, statusIcon } from "./status";
import type { GitHubCommitData, GitHubJob, GitHubWorkflowRun } from "./types";

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
  onOpenJobLog?: (job: GitHubJob, run: GitHubWorkflowRun) => void;
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

  // ── Expand / jobs state ───────────────────────────────────────────────

  /** Set of run IDs that are expanded (showing their jobs). */
  const [expandedRuns, setExpandedRuns] = createSignal<Set<number>>(new Set());
  /** Map of run ID → fetched jobs. Wrapped in a signal so changes trigger re-renders. */
  const [fetchedJobs, setFetchedJobs] = createSignal<Map<number, GitHubJob[]>>(new Map());
  /** Set of run IDs with an in-flight job fetch. */
  const [loadingRuns, setLoadingRuns] = createSignal<Set<number>>(new Set());

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
      props.fetchJobsForRun(run).then(jobs => {
        setFetchedJobs(prev => {
          const next = new Map(prev);
          next.set(run.id, jobs);
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
    } else if (cursor >= count) {
      props.setDetailCursorIndex(count - 1);
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
        props.onOpenJobLog?.(item.job, item.run);
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
          <box height={1} />
          <For each={data().runs}>
            {(run, runIndexFn) => {
              const runFlatIndex = () => flatItems().findIndex(it => it.kind === "run" && it.run.id === run.id);
              const isExpanded = () => expandedRuns().has(run.id);
              const isLoading = () => loadingRuns().has(run.id);
              const jobs = () => fetchedJobs().get(run.id) ?? [];
              const isCursored = () => props.detailFocused() && props.detailCursorIndex() === runFlatIndex();
              const cat = categorize(run.status, run.conclusion);
              const color = () => statusColor(t(), cat);
              const icon = statusIcon(cat);
              const label = run.status !== "completed" ? run.status.replace("_", " ") : (run.conclusion ?? "completed");
              const relTime = () => formatRelativeDate(run.updatedAt);

              return (
                <box flexDirection="column" width="100%" paddingLeft={2}>
                  {runIndexFn() > 0 ? <box height={1} /> : null}

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
                    <text flexShrink={0} wrapMode="none" fg={color()}>
                      {isExpanded() ? "▾ " : "▸ "}
                      {icon}{" "}
                    </text>
                    <text
                      flexGrow={1}
                      flexShrink={1}
                      wrapMode="none"
                      truncate
                      fg={isCursored() ? t().foreground : t().foreground}
                    >
                      {run.name}
                    </text>
                    <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                      {" "}
                      #{run.runNumber}
                      {"  "}
                      {relTime()}
                      {"  "}
                      {run.event}
                    </text>
                  </box>

                  {/* Jobs — shown when expanded */}
                  <Show when={isExpanded()}>
                    <Show when={isLoading()}>
                      <box paddingLeft={4}>
                        <text fg={t().foregroundMuted}>Loading jobs…</text>
                      </box>
                    </Show>
                    <Show when={!isLoading() && jobs().length === 0}>
                      <box paddingLeft={4}>
                        <text fg={t().foregroundMuted}>No jobs found</text>
                      </box>
                    </Show>
                    <For each={jobs()}>
                      {job => {
                        const jobFlatIndex = () =>
                          flatItems().findIndex(
                            it => it.kind === "job" && it.job.id === job.id && it.run.id === run.id,
                          );
                        const isJobCursored = () =>
                          props.detailFocused() && props.detailCursorIndex() === jobFlatIndex();
                        const jobCat = categorize(job.status, job.conclusion);
                        const jobColor = () => statusColor(t(), jobCat);
                        const jobIcon = statusIcon(jobCat);
                        const duration = formatDuration(job.startedAt, job.completedAt);

                        return (
                          <box
                            ref={(el: Renderable) => {
                              const fi = jobFlatIndex();
                              if (fi >= 0) itemRefs[fi] = el;
                            }}
                            flexDirection="row"
                            width="100%"
                            paddingLeft={4}
                            backgroundColor={isJobCursored() ? t().backgroundElementActive : undefined}
                          >
                            <text flexShrink={0} wrapMode="none" fg={jobColor()}>
                              {jobIcon}{" "}
                            </text>
                            <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foreground}>
                              {job.name}
                            </text>
                            {duration ? (
                              <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                {"  "}
                                {duration}
                              </text>
                            ) : null}
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
