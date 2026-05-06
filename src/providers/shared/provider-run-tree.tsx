import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { formatDuration, formatRelativeDate } from "../../utils/date";
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
  raw: TJobRaw;
}

export interface ProviderTreeJobFetchResult<TJobRaw> {
  jobs: ProviderTreeJob<TJobRaw>[];
  error: string | null;
}

type FlatItem<TRaw, TJobRaw> =
  | { kind: "run"; run: ProviderTreeRun<TRaw>; flatIndex: number }
  | { kind: "job"; job: ProviderTreeJob<TJobRaw>; run: ProviderTreeRun<TRaw>; flatIndex: number };

export interface ProviderRunTreeProps<TRaw, TJobRaw> {
  runs: ProviderTreeRun<TRaw>[];
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  fetchJobsForRun: (run: ProviderTreeRun<TRaw>) => Promise<ProviderTreeJobFetchResult<TJobRaw>>;
  getInitialJobsForRun?: (run: ProviderTreeRun<TRaw>) => ProviderTreeJob<TJobRaw>[];
  onOpenJobAction?: (
    job: ProviderTreeJob<TJobRaw>,
    run: ProviderTreeRun<TRaw>,
    jobs?: ProviderTreeJob<TJobRaw>[],
  ) => void;
  summaryLabel: string;
  loadingText: string;
  emptyText: string;
  jobsLoadingText?: string;
  jobsUnavailableText?: string;
  noJobsText?: string;
  autoExpandSingleRun?: boolean;
  childCountLabel?: (count: number) => string;
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
  let autoExpandedSignature: string | null = null;
  const itemRefs: Renderable[] = [];

  const formatStepDuration = (step: ProviderTreeStep) => formatDuration(step.startedAt, step.completedAt);
  const formatRunDuration = (run: ProviderTreeRun<TRaw>) => {
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

  const flatItems = createMemo((): FlatItem<TRaw, TJobRaw>[] => {
    const expanded = expandedRuns();
    const jobs = fetchedJobs();
    const items: FlatItem<TRaw, TJobRaw>[] = [];
    let idx = 0;
    for (const run of props.runs) {
      items.push({ kind: "run", run, flatIndex: idx++ });
      if (expanded.has(run.id)) {
        for (const job of jobs.get(run.id) ?? []) items.push({ kind: "job", job, run, flatIndex: idx++ });
      }
    }
    return items;
  });

  const toggleRun = (run: ProviderTreeRun<TRaw>) => {
    const opening = !expandedRuns().has(run.id);
    const wasFocusedRun =
      props.detailCursorIndex() === flatItems().findIndex(item => item.kind === "run" && item.run.id === run.id);
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
        setLoadedRuns(prev => new Set([...prev, run.id]));
        if (error || jobs.length === 0) setPendingFocusRunId(null);
      });
    }
  };

  createEffect(() => {
    const runId = pendingFocusRunId();
    if (!runId) return;
    flatItems();
    const jobIdx = flatItems().findIndex(item => item.kind === "job" && item.run.id === runId);
    if (jobIdx < 0) return;
    props.setDetailCursorIndex(jobIdx);
    setPendingFocusRunId(null);
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

  createEffect(() => {
    const items = flatItems();
    if (!props.navRef) return;
    props.navRef.itemCount = items.length;
    props.navRef.itemRefs = itemRefs;
    props.navRef.activateCurrentItem = () => {
      const item = items[props.detailCursorIndex()];
      if (!item) return false;
      if (item.kind === "run") {
        toggleRun(item.run);
        return false;
      }
      props.onOpenJobAction?.(item.job, item.run, fetchedJobs().get(item.run.id) ?? []);
      return false;
    };
  });

  createEffect(() => {
    const items = flatItems();
    const idx = props.detailCursorIndex();
    if (!props.detailFocused() || idx < 0 || idx >= items.length) {
      props.setDetailCursorAction(null);
      return;
    }
    const item = items[idx];
    if (item.kind === "run") props.setDetailCursorAction(expandedRuns().has(item.run.id) ? "collapse" : "expand");
    else props.setDetailCursorAction(props.onOpenJobAction ? "view log" : null);
  });

  return (
    <Show
      when={props.runs.length > 0}
      fallback={
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={t().foregroundMuted}>{props.loading ? props.loadingText : props.emptyText}</text>
        </box>
      }
    >
      <box flexDirection="column" width="100%">
        <box flexDirection="row" width="100%">
          <box flexGrow={1}>
            <text fg={t().foregroundMuted} wrapMode="none">
              {props.summaryLabel}
            </text>
          </box>
          <box flexShrink={0} width={2} />
          <text fg={t().foregroundMuted} wrapMode="none">
            {props.runs.length}
          </text>
        </box>
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
                    {`${run.label}  #${run.runNumber}`}
                  </text>
                  <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                    {relTime().padStart(rightInfoWidth())}
                  </text>
                  <Show when={durationWidth() > 0}>
                    <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                      {runDuration() ? ` ${runDuration().padStart(durationWidth())}` : " ".repeat(durationWidth() + 1)}
                    </text>
                  </Show>
                  <text flexShrink={0} width={STATUS_COL_WIDTH} wrapMode="none" fg={color()}>
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
                      <text fg={t().foregroundMuted}>{props.jobsLoadingText ?? "Loading jobs…"}</text>
                    </box>
                  </Show>
                  <Show when={!isLoading() && jobError()}>
                    <box flexDirection="row" width="100%">
                      <text flexShrink={0} wrapMode="none" fg={t().border}>
                        {placeholderTreeLead()}└─
                      </text>
                      <text> </text>
                      <text fg={t().foregroundMuted}>{props.jobsUnavailableText ?? "Jobs unavailable"}</text>
                    </box>
                  </Show>
                  <Show when={!isLoading() && !jobError() && jobs().length === 0}>
                    <box flexDirection="row" width="100%">
                      <text flexShrink={0} wrapMode="none" fg={t().border}>
                        {placeholderTreeLead()}└─
                      </text>
                      <text> </text>
                      <text fg={t().foregroundMuted}>{props.noJobsText ?? "No jobs found"}</text>
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
                            ? (props.jobsLoadingText ?? "Loading...")
                            : "";
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
                                {duration ? ` ${duration.padStart(durationWidth())}` : " ".repeat(durationWidth() + 1)}
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
    </Show>
  );
}
