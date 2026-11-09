import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import type { DebugEventSource } from "../../debug/events";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { formatDuration, formatRelativeDate } from "../../utils/date";
import { ProviderActionRow, ProviderSummaryRow, ScrollingLabel, useDetailRowMouse } from "./detail-rows";
import { type RowShortcut, useOpenRowShortcut } from "./open-row";
import { fetchProviderJobs } from "./provider-job-fetch";
import { categorize, statusColor, statusIcon } from "./status";

export interface ProviderTreeStep {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProviderTreeRun<TRaw> {
  id: string;
  label: string;
  status: string;
  conclusion: string | null;
  runNumber: number;
  startedAt?: string | null;
  updatedAt: string;
  /** The run's web page, opened with `o`. */
  url?: string;
  raw: TRaw;
}

export interface ProviderTreeJob<TJobRaw> {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: ProviderTreeStep[];
  /** The job's web page, opened with `o`. */
  url?: string;
  /** Why it failed, one selectable row each after the steps (GitHub annotations, Jenkins failed tests). */
  notes?: ProviderTreeNote[];
  /** A row above the notes with their count (`Annotations`); without it the notes follow the steps directly. */
  notesLabel?: string;
  raw: TJobRaw;
}

/** A selectable row under a job that says why it failed: `✗ src/auth.test.ts:42  Expected 200, received 401`. */
export interface ProviderTreeNote {
  id: string;
  /** `✗` in the error colour for a failure, `!` in the warning colour for a warning. */
  mark: "fail" | "warning";
  text: string;
  /** Its web page for `o`; the job's page otherwise. */
  url?: string;
  /** Text to find in the job's log when the note is opened (an annotation's message). */
  search?: string;
}

export interface ProviderTreeJobFetchResult<TJobRaw> {
  jobs: ProviderTreeJob<TJobRaw>[];
  error: string | null;
}

type FlatItem<TRaw, TJobRaw> =
  | { kind: "reload"; flatIndex: number }
  | { kind: "run"; run: ProviderTreeRun<TRaw>; flatIndex: number }
  | { kind: "job"; job: ProviderTreeJob<TJobRaw>; run: ProviderTreeRun<TRaw>; flatIndex: number }
  | {
      kind: "note";
      note: ProviderTreeNote;
      job: ProviderTreeJob<TJobRaw>;
      run: ProviderTreeRun<TRaw>;
      flatIndex: number;
    };

export interface ProviderRunTreeProps<TRaw, TJobRaw> {
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  runs: ProviderTreeRun<TRaw>[];
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  setDetailCursorShortcut?: (shortcut: RowShortcut | null) => void;
  fetchJobsForRun: (run: ProviderTreeRun<TRaw>, signal?: AbortSignal) => Promise<ProviderTreeJobFetchResult<TJobRaw>>;
  debugSource: DebugEventSource;
  dataKey: string;
  getInitialJobsForRun?: (run: ProviderTreeRun<TRaw>) => ProviderTreeJob<TJobRaw>[];
  onOpenJobAction?: (
    job: ProviderTreeJob<TJobRaw>,
    run: ProviderTreeRun<TRaw>,
    jobs?: ProviderTreeJob<TJobRaw>[],
  ) => void;
  /** Enter on a note (an annotation, a failed test). */
  onOpenNote?: (
    note: ProviderTreeNote,
    job: ProviderTreeJob<TJobRaw>,
    run: ProviderTreeRun<TRaw>,
    jobs: ProviderTreeJob<TJobRaw>[],
  ) => void;
  /** Footer verb for Enter on a note (`view in log`). */
  noteAction?: string;
  summaryLabel: string;
  jobsLoadingText?: string;
  noJobsText?: string;
  autoExpandSingleRun?: boolean;
  childCountLabel?: (count: number) => string;
  showRunDuration?: boolean;
  onReloadCommit?: () => void | Promise<void>;
  reloadLabel?: string;
  reloadBusy?: boolean;
  /** Muted text after the reload label while it is busy (`fetching runs...`). */
  reloadBusyText?: string;
  reloadEnabled?: boolean;
  /** When false, hide the count row. Unknown must not look like zero. */
  showSummary?: boolean;
  /** Open the first failed run when the tab gets focus (default true). */
  openFailedRun?: boolean;
}

export function ProviderRunTree<TRaw, TJobRaw>(props: Readonly<ProviderRunTreeProps<TRaw, TJobRaw>>) {
  const t = useT();
  const STATUS_COL_WIDTH = 2;
  const [expandedRuns, setExpandedRuns] = createSignal<Set<string>>(new Set());
  const [fetchedJobs, setFetchedJobs] = createSignal<Map<string, ProviderTreeJob<TJobRaw>[]>>(new Map());
  const [jobErrors, setJobErrors] = createSignal<Map<string, string>>(new Map());
  const [loadingRuns, setLoadingRuns] = createSignal<Set<string>>(new Set());
  const [loadedRuns, setLoadedRuns] = createSignal<Set<string>>(new Set());
  const [pendingFocusRunId, setPendingFocusRunId] = createSignal<string | null>(null);
  const fetchControllers = new Map<string, AbortController>();
  /** Runs whose status changed while their jobs were loading; they load again when that request settles. */
  const reloadAfterLoad = new Set<string>();
  let autoExpandedSignature: string | null = null;
  let previousDataKey = props.dataKey;
  const itemRefs: Renderable[] = [];
  const refsByKey = new Map<string, Renderable>();
  const itemKey = (item: FlatItem<TRaw, TJobRaw>) =>
    item.kind === "reload"
      ? "reload"
      : item.kind === "run"
        ? `run:${item.run.id}`
        : item.kind === "job"
          ? `job:${item.run.id}:${item.job.id}`
          : `note:${item.run.id}:${item.job.id}:${item.note.id}`;
  const syncItemRefs = () => {
    const items = flatItems();
    itemRefs.length = items.length;
    items.forEach((item, index) => {
      itemRefs[index] = refsByKey.get(itemKey(item)) as Renderable;
    });
  };
  const rows = useDetailRowMouse({
    mouseEnabled: () => props.mouseEnabled,
    onMouseFocus: props.onMouseFocus,
    setDetailCursorIndex: props.setDetailCursorIndex,
    activate: () => activateCurrentItem(),
    inert: key => key === "reload" && (!reloadEnabled() || reloadBusy()),
  });
  const { mouseRow, hoverBg } = rows;

  const formatStepDuration = (step: ProviderTreeStep) => formatDuration(step.startedAt, step.completedAt);
  const formatRunDuration = (run: ProviderTreeRun<TRaw>) => {
    if (props.showRunDuration === false) return "";
    const primaryJob = fetchedJobs().get(run.id)?.[0];
    const exactDuration = primaryJob ? formatDuration(primaryJob.startedAt, primaryJob.completedAt) : "";
    if (exactDuration) return exactDuration;
    const duration = formatDuration(run.startedAt ?? null, run.updatedAt);
    return duration ? `~${duration}` : "";
  };
  const statusMark = (status: string, conclusion: string | null) => statusIcon(categorize(status, conclusion));

  const rightInfoWidth = createMemo(() => {
    let max = 0;
    for (const run of props.runs) {
      max = Math.max(max, formatRelativeDate(run.updatedAt).length);
    }
    for (const jobs of fetchedJobs().values()) {
      for (const job of jobs) {
        const label =
          job.steps.length > 0
            ? (props.childCountLabel?.(job.steps.length) ??
              `${job.steps.length} step${job.steps.length === 1 ? "" : "s"}`)
            : "";
        max = Math.max(max, label.length);
      }
    }
    return max;
  });

  const durationWidth = createMemo(() => {
    let max = 0;
    for (const run of props.runs) {
      max = Math.max(max, formatRunDuration(run).length);
    }
    for (const jobs of fetchedJobs().values()) {
      for (const job of jobs) {
        max = Math.max(max, formatDuration(job.startedAt, job.completedAt).length);
      }
    }
    return max;
  });

  const reloadEnabled = () => props.reloadEnabled !== false && !!props.onReloadCommit;
  const reloadBusy = () => !!props.reloadBusy;
  const reloadLabel = () => props.reloadLabel ?? "Reload commit";
  const reloadHint = () => (reloadLabel() === "Load commit" ? "load" : "reload");

  const flatItems = createMemo((): FlatItem<TRaw, TJobRaw>[] => {
    const expanded = expandedRuns();
    const jobs = fetchedJobs();
    const items: FlatItem<TRaw, TJobRaw>[] = [];
    let idx = 0;
    // A disabled reload row stays visible (muted) but leaves the cursor order.
    if (props.onReloadCommit && reloadEnabled()) items.push({ kind: "reload", flatIndex: idx++ });
    for (const run of props.runs) {
      items.push({ kind: "run", run, flatIndex: idx++ });
      if (expanded.has(run.id)) {
        for (const job of jobs.get(run.id) ?? []) {
          items.push({ kind: "job", job, run, flatIndex: idx++ });
          for (const note of job.notes ?? []) items.push({ kind: "note", note, job, run, flatIndex: idx++ });
        }
      }
    }
    return items;
  });

  const clearLoadingRun = (runId: string) => {
    setLoadingRuns(prev => {
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
  };

  const abortRunFetch = (runId: string) => {
    fetchControllers.get(runId)?.abort();
    fetchControllers.delete(runId);
    clearLoadingRun(runId);
    if (pendingFocusRunId() === runId) setPendingFocusRunId(null);
  };

  const loadJobsForRun = async (run: ProviderTreeRun<TRaw>) => {
    if (loadingRuns().has(run.id)) return;

    const ctrl = new AbortController();
    fetchControllers.set(run.id, ctrl);
    setLoadingRuns(prev => new Set([...prev, run.id]));
    setJobErrors(prev => {
      const next = new Map(prev);
      next.delete(run.id);
      return next;
    });

    try {
      const outcome = await fetchProviderJobs(
        () => props.fetchJobsForRun(run, ctrl.signal),
        ctrl.signal,
        props.debugSource,
      );
      if (fetchControllers.get(run.id) !== ctrl || outcome.kind === "cancelled") return;

      setFetchedJobs(prev => {
        const next = new Map(prev);
        next.set(run.id, outcome.jobs);
        return next;
      });
      setJobErrors(prev => {
        const next = new Map(prev);
        if (outcome.error) next.set(run.id, outcome.error);
        else next.delete(run.id);
        return next;
      });
      setLoadedRuns(prev => {
        const next = new Set(prev);
        if (outcome.error) next.delete(run.id);
        else next.add(run.id);
        return next;
      });
      if (outcome.error || outcome.jobs.length === 0) setPendingFocusRunId(null);
    } finally {
      if (fetchControllers.get(run.id) === ctrl) {
        fetchControllers.delete(run.id);
        clearLoadingRun(run.id);
        // The run changed while this request ran: load once more with the current run.
        if (reloadAfterLoad.delete(run.id) && expandedRuns().has(run.id)) {
          const current = props.runs.find(entry => entry.id === run.id);
          if (current) void loadJobsForRun(current);
        }
      }
    }
  };

  const toggleRun = (run: ProviderTreeRun<TRaw>) => {
    const opening = !expandedRuns().has(run.id);
    const wasFocusedRun =
      props.detailCursorIndex() === flatItems().findIndex(item => item.kind === "run" && item.run.id === run.id);
    if (!opening) abortRunFetch(run.id);
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (opening) next.add(run.id);
      else next.delete(run.id);
      return next;
    });
    if (opening && !loadedRuns().has(run.id) && !loadingRuns().has(run.id)) {
      setPendingFocusRunId(run.id);
      const initialJobs = props.getInitialJobsForRun?.(run) ?? [];
      if (initialJobs.length > 0 && !fetchedJobs().has(run.id)) {
        setFetchedJobs(prev => {
          const next = new Map(prev);
          next.set(run.id, initialJobs);
          return next;
        });
        if (wasFocusedRun) {
          queueMicrotask(() => {
            const jobIdx = flatItems().findIndex(item => item.kind === "job" && item.run.id === run.id);
            if (jobIdx >= 0) props.setDetailCursorIndex(jobIdx);
          });
        }
      }
      void loadJobsForRun(run);
    }
  };

  /** Completed, with every loaded job and step completed: its jobs and steps cannot change any more. */
  const isSettled = (run: ProviderTreeRun<TRaw>) =>
    run.status === "completed" &&
    (fetchedJobs().get(run.id) ?? []).every(
      job => job.status === "completed" && job.steps.every(step => step.status === "completed"),
    );

  const reloadCommit = async () => {
    // Expanded runs that failed to load or were still running get fresh jobs and steps too.
    const stale = new Set(props.runs.filter(run => jobErrors().has(run.id) || !isSettled(run)).map(run => run.id));
    await props.onReloadCommit?.();
    await Promise.all(
      props.runs.filter(run => stale.has(run.id) && expandedRuns().has(run.id)).map(run => loadJobsForRun(run)),
    );
  };

  // Auto refresh replaces the runs: an expanded run whose status moved reloads its jobs and steps. If its jobs are
  // still loading, they load again once that request settles (its answer may predate the change).
  const runSignatures = new Map<string, string>();
  createEffect(() => {
    const runs = props.runs;
    untrack(() => {
      for (const run of runs) {
        const signature = `${run.status}:${run.conclusion}:${run.updatedAt}`;
        const previous = runSignatures.get(run.id);
        runSignatures.set(run.id, signature);
        if (previous === undefined || previous === signature || !expandedRuns().has(run.id)) continue;
        if (loadingRuns().has(run.id)) reloadAfterLoad.add(run.id);
        else if (loadedRuns().has(run.id)) void loadJobsForRun(run);
      }
    });
  });

  const resetRunState = () => {
    for (const ctrl of fetchControllers.values()) ctrl.abort();
    fetchControllers.clear();
    setExpandedRuns(new Set<string>());
    setFetchedJobs(new Map<string, ProviderTreeJob<TJobRaw>[]>());
    setJobErrors(new Map<string, string>());
    setLoadingRuns(new Set<string>());
    setLoadedRuns(new Set<string>());
    setPendingFocusRunId(null);
    autoExpandedSignature = null;
    runSignatures.clear();
    reloadAfterLoad.clear();
    itemRefs.length = 0;
    refsByKey.clear();
    rows.clearHover();
  };

  createEffect(() => {
    const dataKey = props.dataKey;
    if (dataKey === previousDataKey) return;
    previousDataKey = dataKey;
    resetRunState();
  });

  onCleanup(resetRunState);

  createEffect(() => {
    const runId = pendingFocusRunId();
    if (!runId) return;
    const items = flatItems();
    // Failure first: an opened run puts the cursor on its first failed job, else on its first job.
    const failedIdx = items.findIndex(
      item =>
        item.kind === "job" && item.run.id === runId && categorize(item.job.status, item.job.conclusion) === "fail",
    );
    const jobIdx = failedIdx >= 0 ? failedIdx : items.findIndex(item => item.kind === "job" && item.run.id === runId);
    if (jobIdx < 0) return;
    props.setDetailCursorIndex(jobIdx);
    setPendingFocusRunId(null);
  });

  // Failure first: entering a commit's tab (detail focus) opens its first failed run once, unless the user already
  // opened one. Only on focus, so browsing commits in the graph never fetches jobs.
  let failureOpenedKey: string | null = null;
  createEffect(() => {
    if (props.openFailedRun === false || !props.detailFocused() || props.runs.length === 0) return;
    const key = props.dataKey;
    if (failureOpenedKey === key) return;
    failureOpenedKey = key;
    const failed = props.runs.find(run => categorize(run.status, run.conclusion) === "fail");
    if (!failed || untrack(expandedRuns).size > 0) return;
    untrack(() => toggleRun(failed));
  });

  createEffect(() => {
    if (!props.autoExpandSingleRun) return;
    if (props.runs.length !== 1) return;
    const run = props.runs[0];
    const signature = `${run.id}:${run.runNumber}`;
    if (autoExpandedSignature === signature) return;
    if (expandedRuns().has(run.id)) return;
    autoExpandedSignature = signature;
    toggleRun(run);
  });

  createEffect(() => {
    const count = flatItems().length;
    const cursor = untrack(() => props.detailCursorIndex());
    if (count === 0) props.setDetailCursorIndex(0);
    else if (cursor < 0 || cursor >= count) props.setDetailCursorIndex(Math.max(0, Math.min(count - 1, cursor)));
  });

  const activateCurrentItem = () => {
    const item = flatItems()[props.detailCursorIndex()];
    if (!item) return false;
    if (item.kind === "reload") {
      if (reloadEnabled() && !reloadBusy()) void reloadCommit();
      return false;
    }
    if (item.kind === "run") {
      toggleRun(item.run);
      return false;
    }
    if (item.kind === "note") {
      props.onOpenNote?.(item.note, item.job, item.run, fetchedJobs().get(item.run.id) ?? []);
      return false;
    }
    props.onOpenJobAction?.(item.job, item.run, fetchedJobs().get(item.run.id) ?? []);
    return false;
  };

  createEffect(() => {
    const items = flatItems();
    syncItemRefs();
    if (!props.navRef) return;
    props.navRef.itemCount = items.length;
    props.navRef.itemRefs = itemRefs;
    props.navRef.activateCurrentItem = activateCurrentItem;
  });

  createEffect(() => {
    const items = flatItems();
    const idx = props.detailCursorIndex();
    if (!props.detailFocused() || idx < 0 || idx >= items.length) {
      props.setDetailCursorAction(null);
      return;
    }
    const item = items[idx];
    if (item.kind === "reload") props.setDetailCursorAction(reloadEnabled() && !reloadBusy() ? reloadHint() : null);
    else if (item.kind === "run") props.setDetailCursorAction(expandedRuns().has(item.run.id) ? "collapse" : "expand");
    else if (item.kind === "note") props.setDetailCursorAction(props.onOpenNote ? (props.noteAction ?? "open") : null);
    else props.setDetailCursorAction(props.onOpenJobAction ? "view log" : null);
  });

  useOpenRowShortcut({
    navRef: props.navRef,
    detailFocused: props.detailFocused,
    url: () => {
      const item = flatItems()[props.detailCursorIndex()];
      if (item?.kind === "note") return item.note.url ?? item.job.url;
      return item?.kind === "run" ? item.run.url : item?.kind === "job" ? item.job.url : null;
    },
    setDetailCursorShortcut: props.setDetailCursorShortcut,
  });

  const reloadIdx = () => flatItems().findIndex(item => item.kind === "reload");
  const isReloadCursored = () => reloadIdx() >= 0 && props.detailFocused() && props.detailCursorIndex() === reloadIdx();
  const reloadStatus = () => {
    if (reloadBusy()) return props.reloadBusyText ?? BUSY.fetchingRuns;
    return "";
  };

  return (
    <box flexDirection="column" width="100%" flexGrow={1}>
      <Show when={!!props.onReloadCommit}>
        <ProviderActionRow
          label={reloadLabel()}
          status={reloadStatus()}
          disabled={!reloadEnabled()}
          cursored={isReloadCursored()}
          mouseEnabled={props.mouseEnabled}
          rows={rows}
          rowKey="reload"
          index={reloadIdx}
          rowRef={el => {
            refsByKey.set("reload", el);
            syncItemRefs();
          }}
        />
      </Show>
      <Show when={props.showSummary !== false}>
        <ProviderSummaryRow label={props.summaryLabel} count={props.runs.length} />
      </Show>
      <For each={props.runs}>
        {(run, runIndexFn) => {
          const runFlatIndex = () => flatItems().findIndex(it => it.kind === "run" && it.run.id === run.id);
          const isExpanded = () => expandedRuns().has(run.id);
          const isLoading = () => loadingRuns().has(run.id);
          const jobs = () => fetchedJobs().get(run.id) ?? [];
          const jobError = () => jobErrors().get(run.id) ?? null;
          const isCursored = () => props.detailFocused() && props.detailCursorIndex() === runFlatIndex();
          const cat = () => categorize(run.status, run.conclusion);
          const color = () => statusColor(t(), cat());
          const relTime = () => formatRelativeDate(run.updatedAt);
          const runDuration = () => formatRunDuration(run);
          const runTreePrefix = () => (runIndexFn() === props.runs.length - 1 ? "└─ " : "├─ ");
          const runIndicatorColor = () => (isCursored() ? t().accent : t().foregroundMuted);
          const runTextColor = () => (isCursored() ? t().accent : t().foreground);
          const runIsLast = () => runIndexFn() === props.runs.length - 1;
          const placeholderTreeLead = () => (runIsLast() ? "   " : "│  ");

          return (
            <box flexDirection="column" width="100%">
              <box
                ref={(el: Renderable) => {
                  refsByKey.set(`run:${run.id}`, el);
                  syncItemRefs();
                }}
                {...mouseRow(`run:${run.id}`, runFlatIndex)}
                flexDirection="row"
                width="100%"
                backgroundColor={isCursored() ? t().backgroundElementActive : hoverBg(`run:${run.id}`)}
              >
                <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                  {runTreePrefix()}
                </text>
                <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={runIndicatorColor()}>
                  {isExpanded() ? "▾ " : "▸ "}
                </text>
                <ScrollingLabel
                  selectable={!props.mouseEnabled}
                  text={`${run.label} #${run.runNumber}`}
                  active={isCursored()}
                  fg={runTextColor()}
                />
                <box flexShrink={0} width={1} />
                <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                  {relTime().padStart(rightInfoWidth())}
                </text>
                {/* Keep the duration column even when runs hide theirs (Jenkins), so runs and jobs line up. */}
                <Show when={durationWidth() > 0}>
                  <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {runDuration() ? ` ${runDuration().padStart(durationWidth())}` : " ".repeat(durationWidth() + 1)}
                  </text>
                </Show>
                <text
                  selectable={!props.mouseEnabled}
                  flexShrink={0}
                  width={STATUS_COL_WIDTH}
                  wrapMode="none"
                  fg={color()}
                >
                  {statusMark(run.status, run.conclusion).padStart(STATUS_COL_WIDTH)}
                </text>
              </box>

              <Show when={isExpanded()}>
                <Show when={isLoading() && jobs().length === 0}>
                  <box flexDirection="row" width="100%">
                    <text flexShrink={0} wrapMode="none" fg={t().border}>
                      {placeholderTreeLead()}└─
                    </text>
                    <text> </text>
                    <text fg={t().foregroundMuted}>{props.jobsLoadingText ?? BUSY.fetchingJobs}</text>
                  </box>
                </Show>
                <Show when={!isLoading() && jobError()}>
                  {error => (
                    // The reason the jobs did not load (Reload commit retries), like the other placeholders.
                    <box flexDirection="row" width="100%">
                      <text flexShrink={0} wrapMode="none" fg={t().border}>
                        {placeholderTreeLead()}└─
                      </text>
                      <text> </text>
                      <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().error}>
                        {error()}
                      </text>
                    </box>
                  )}
                </Show>
                <Show when={!isLoading() && !jobError() && jobs().length === 0 && (props.noJobsText ?? "")}>
                  <box flexDirection="row" width="100%">
                    <text flexShrink={0} wrapMode="none" fg={t().border}>
                      {placeholderTreeLead()}└─
                    </text>
                    <text> </text>
                    <text fg={t().foregroundMuted}>{props.noJobsText}</text>
                  </box>
                </Show>
                <For each={jobs()}>
                  {(job, jobIndexFn) => {
                    const jobFlatIndex = () =>
                      flatItems().findIndex(it => it.kind === "job" && it.job.id === job.id && it.run.id === run.id);
                    const isJobCursored = () => props.detailFocused() && props.detailCursorIndex() === jobFlatIndex();
                    const jobCat = categorize(job.status, job.conclusion);
                    const jobColor = () => statusColor(t(), jobCat);
                    const duration = formatDuration(job.startedAt, job.completedAt);
                    const stepCountLabel = () =>
                      job.steps.length > 0
                        ? (props.childCountLabel?.(job.steps.length) ??
                          `${job.steps.length} step${job.steps.length === 1 ? "" : "s"}`)
                        : isLoading()
                          ? (props.jobsLoadingText ?? BUSY.fetchingJobs)
                          : "";
                    const jobTextColor = () => (isJobCursored() ? t().accent : t().foreground);
                    const jobTreeLead = () => (runIsLast() ? "   " : "│  ");
                    const jobTreePrefix = () => (jobIndexFn() === jobs().length - 1 ? "└─ " : "├─ ");
                    const jobIsLast = () => jobIndexFn() === jobs().length - 1;
                    const notes = () => job.notes ?? [];
                    /** The lead of the job's children: steps, the notes row, and the notes without one. */
                    const childLead = () => jobTreeLead() + (jobIsLast() ? "   " : "│  ");

                    return (
                      <box flexDirection="column" width="100%">
                        <box
                          ref={(el: Renderable) => {
                            refsByKey.set(`job:${run.id}:${job.id}`, el);
                            syncItemRefs();
                          }}
                          {...mouseRow(`job:${run.id}:${job.id}`, jobFlatIndex)}
                          flexDirection="row"
                          width="100%"
                          backgroundColor={
                            isJobCursored() ? t().backgroundElementActive : hoverBg(`job:${run.id}:${job.id}`)
                          }
                        >
                          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                            {jobTreeLead()}
                            {jobTreePrefix()}
                          </text>
                          <ScrollingLabel
                            selectable={!props.mouseEnabled}
                            text={job.name}
                            active={isJobCursored()}
                            fg={jobTextColor()}
                          />
                          <text
                            selectable={!props.mouseEnabled}
                            flexShrink={0}
                            wrapMode="none"
                            fg={t().foregroundMuted}
                          >
                            {stepCountLabel().padStart(rightInfoWidth())}
                          </text>
                          <Show when={durationWidth() > 0}>
                            <text
                              selectable={!props.mouseEnabled}
                              flexShrink={0}
                              wrapMode="none"
                              fg={t().foregroundMuted}
                            >
                              {duration ? ` ${duration.padStart(durationWidth())}` : " ".repeat(durationWidth() + 1)}
                            </text>
                          </Show>
                          <text
                            selectable={!props.mouseEnabled}
                            flexShrink={0}
                            width={STATUS_COL_WIDTH}
                            wrapMode="none"
                            fg={jobColor()}
                          >
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
                              const stepConnector = () =>
                                stepIndexFn() === job.steps.length - 1 && notes().length === 0 ? "└─ " : "├─ ";

                              return (
                                <box flexDirection="row" width="100%">
                                  <text flexShrink={0} wrapMode="none" fg={t().border}>
                                    {stepTreePrefix()}
                                    {stepConnector()}
                                  </text>
                                  <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                                    {step.name}
                                  </text>
                                  <Show when={stepDuration()}>
                                    <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                      {stepDuration()}
                                    </text>
                                  </Show>
                                  <text flexShrink={0} width={STATUS_COL_WIDTH} wrapMode="none" fg={stepColor()}>
                                    {statusMark(step.status, step.conclusion).padStart(STATUS_COL_WIDTH)}
                                  </text>
                                </box>
                              );
                            }}
                          </For>
                        </Show>

                        <Show when={notes().length > 0}>
                          <Show when={job.notesLabel}>
                            {label => (
                              <box flexDirection="row" width="100%">
                                <text flexShrink={0} wrapMode="none" fg={t().border}>
                                  {childLead()}└─{" "}
                                </text>
                                <text flexGrow={1} flexShrink={1} wrapMode="none" truncate fg={t().foregroundMuted}>
                                  {label()}
                                </text>
                                <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                  {String(notes().length)}
                                </text>
                                <text flexShrink={0} width={STATUS_COL_WIDTH} wrapMode="none">
                                  {" ".repeat(STATUS_COL_WIDTH)}
                                </text>
                              </box>
                            )}
                          </Show>
                          <For each={notes()}>
                            {(note, noteIndexFn) => {
                              const key = `note:${run.id}:${job.id}:${note.id}`;
                              const noteFlatIndex = () =>
                                flatItems().findIndex(
                                  it =>
                                    it.kind === "note" &&
                                    it.note.id === note.id &&
                                    it.job.id === job.id &&
                                    it.run.id === run.id,
                                );
                              const isNoteCursored = () =>
                                props.detailFocused() && props.detailCursorIndex() === noteFlatIndex();
                              const noteLead = () => childLead() + (job.notesLabel ? "   " : "");
                              const noteConnector = () => (noteIndexFn() === notes().length - 1 ? "└─ " : "├─ ");
                              return (
                                <box
                                  ref={(el: Renderable) => {
                                    refsByKey.set(key, el);
                                    syncItemRefs();
                                  }}
                                  {...mouseRow(key, noteFlatIndex)}
                                  flexDirection="row"
                                  width="100%"
                                  backgroundColor={isNoteCursored() ? t().backgroundElementActive : hoverBg(key)}
                                >
                                  <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                                    {noteLead()}
                                    {noteConnector()}
                                  </text>
                                  <text
                                    selectable={!props.mouseEnabled}
                                    flexShrink={0}
                                    wrapMode="none"
                                    fg={note.mark === "fail" ? t().error : t().warning}
                                  >
                                    {note.mark === "fail" ? "✗ " : "! "}
                                  </text>
                                  <ScrollingLabel
                                    selectable={!props.mouseEnabled}
                                    text={note.text}
                                    active={isNoteCursored()}
                                    fg={isNoteCursored() ? t().accent : t().foreground}
                                  />
                                  <text flexShrink={0} width={STATUS_COL_WIDTH} wrapMode="none">
                                    {" ".repeat(STATUS_COL_WIDTH)}
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
  );
}
