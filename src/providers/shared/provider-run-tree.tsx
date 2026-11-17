import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { createRememberedSignal, type DetailMemory } from "../../components/detail-memory";
import type { DetailNavRef } from "../../components/detail-types";
import { categorize, statusIcon } from "../../core/status";
import type { DebugEventSource } from "../../debug/events";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { formatRelativeDate } from "../../utils/date";
import { ProviderActionRow, ProviderSummaryRow, ScrollingLabel, useDetailRowMouse } from "./detail-rows";
import { useDetailTree } from "./detail-tree";
import { type RowShortcut, useOpenRowShortcut } from "./open-row";
import { fetchProviderJobs } from "./provider-job-fetch";
import { statusColor } from "./status";

export interface ProviderTreeStep {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface ProviderTreeRun<TRaw> {
  id: string;
  label: string;
  status: string;
  conclusion: string | null;
  runNumber: number;
  /** When it last changed: its age. */
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
  /** When it ended: an earlier attempt's age. */
  completedAt: string | null;
  steps: ProviderTreeStep[];
  /** The job's web page, opened with `o`. */
  url?: string;
  /** Why it failed, one selectable row each after the steps (GitHub annotations, Jenkins failed tests). */
  notes?: ProviderTreeNote[];
  /** A row above the notes with their count (`Annotations`); without it the notes follow the steps directly. */
  notesLabel?: string;
  /** The run attempt it belongs to (GitHub re-runs). The latest attempt's jobs show; earlier ones fold away. */
  attempt?: number;
  /** Muted text after the name (`  3 failed · 1,204 passed`), cut before the name when space is short. */
  tail?: string;
  raw: TJobRaw;
}

/** The jobs of an earlier attempt of a re-run, folded into one `attempt N` row. */
interface AttemptGroup<TJobRaw> {
  number: number;
  jobs: ProviderTreeJob<TJobRaw>[];
}

/** A run's jobs split by attempt: the latest attempt's jobs, and earlier attempts newest first. */
function splitAttempts<TJobRaw>(jobs: ProviderTreeJob<TJobRaw>[]) {
  const latest = jobs.reduce((max, job) => Math.max(max, job.attempt ?? 1), 1);
  const earlier = new Map<number, ProviderTreeJob<TJobRaw>[]>();
  for (const job of jobs) {
    const number = job.attempt ?? 1;
    if (number !== latest) earlier.set(number, [...(earlier.get(number) ?? []), job]);
  }
  return {
    latest,
    current: jobs.filter(job => (job.attempt ?? 1) === latest),
    attempts: [...earlier]
      .sort((a, b) => b[0] - a[0])
      .map(([number, attemptJobs]): AttemptGroup<TJobRaw> => ({ number, jobs: attemptJobs })),
  };
}

/** An attempt's status from its jobs: failed if one failed, running if one runs, cancelled if all were. */
function attemptStatus<TJobRaw>(jobs: ProviderTreeJob<TJobRaw>[]): { status: string; conclusion: string | null } {
  const categories = jobs.map(job => categorize(job.status, job.conclusion));
  if (categories.includes("fail")) return { status: "completed", conclusion: "failure" };
  if (categories.includes("running")) return { status: "in_progress", conclusion: null };
  if (categories.length > 0 && categories.every(category => category === "cancelled"))
    return { status: "completed", conclusion: "cancelled" };
  return { status: "completed", conclusion: "success" };
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

/** What a tree records about a commit besides its open rows; mutable, so no effect runs again on it. */
interface OpenedMemory {
  /** The commit the run statuses and the single opened run belong to. */
  dataKey: string | null;
  /** The commit whose first failed run was opened on entering the tab (once, so closing it sticks). */
  failureOpenedKey: string | null;
  /** The single run opened on its own (`id:number`), so closing it sticks too. */
  autoExpandedSignature: string | null;
  /** Each run's last seen status: an open run whose status moved loads its jobs again. */
  runSignatures: Map<string, string>;
  /** The target run opened on its own, and the one the focus was put on (`commit\0run`): once each. */
  targetOpenedKey: string | null;
  targetFocusedKey: string | null;
}

const newOpenedMemory = (): OpenedMemory => ({
  dataKey: null,
  failureOpenedKey: null,
  autoExpandedSignature: null,
  runSignatures: new Map(),
  targetOpenedKey: null,
  targetFocusedKey: null,
});

type FlatItem<TRaw, TJobRaw> =
  | { kind: "reload"; flatIndex: number }
  | { kind: "run"; run: ProviderTreeRun<TRaw>; flatIndex: number }
  | { kind: "job"; job: ProviderTreeJob<TJobRaw>; run: ProviderTreeRun<TRaw>; flatIndex: number }
  | { kind: "attempt"; attempt: AttemptGroup<TJobRaw>; run: ProviderTreeRun<TRaw>; flatIndex: number }
  | {
      kind: "note";
      note: ProviderTreeNote;
      job: ProviderTreeJob<TJobRaw>;
      run: ProviderTreeRun<TRaw>;
      flatIndex: number;
    };

/** How long the dashboard's event stays selected before its run opens (and loads its jobs) on its own. */
const TARGET_OPEN_DELAY_MS = 400;

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
  /** Keeps open runs, attempts and loaded jobs while the tree is not shown (another tab, the other layout). */
  memory?: DetailMemory;
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
  /** When false, notes leave out their `✗`/`!` (Jenkins: every listed test failed). */
  noteMarks?: boolean;
  onReloadCommit?: () => void | Promise<void>;
  /**
   * Whether a finished run's loaded jobs are final beyond their statuses (Jenkins: the test report is known). One that
   * is not loads again on Reload, like a run still running or one that failed to load.
   */
  jobsFinal?: (jobs: readonly ProviderTreeJob<TJobRaw>[]) => boolean;
  reloadLabel?: string;
  reloadBusy?: boolean;
  /** Muted text after the reload label while it is busy (`fetching runs...`). */
  reloadBusyText?: string;
  reloadEnabled?: boolean;
  /** When false, hide the count row. Unknown must not look like zero. */
  showSummary?: boolean;
  /** Open the first failed run when the tab gets focus (default true). */
  openFailedRun?: boolean;
  /**
   * The run the tree is shown for (the dashboard's event): it opens at once, its name takes `targetColor`, and the
   * tab's focus starts on it. Failure-first then opens nothing else.
   */
  targetRunId?: string;
  targetColor?: string;
}

export function ProviderRunTree<TRaw, TJobRaw>(props: Readonly<ProviderRunTreeProps<TRaw, TJobRaw>>) {
  const t = useT();
  const STATUS_COL_WIDTH = 2;
  // What the user opened and what loaded for it, per commit: kept in the memory when there is one.
  const dataKey = () => props.dataKey;
  const remembered = <T,>(key: string, initial: () => T) => createRememberedSignal(props.memory, key, dataKey, initial);
  const [expandedRuns, setExpandedRuns] = remembered("expandedRuns", () => new Set<string>());
  /** Open earlier attempts, as `runId:number`. */
  const [expandedAttempts, setExpandedAttempts] = remembered("expandedAttempts", () => new Set<string>());
  const [fetchedJobs, setFetchedJobs] = remembered("fetchedJobs", () => new Map<string, ProviderTreeJob<TJobRaw>[]>());
  const [jobErrors, setJobErrors] = remembered("jobErrors", () => new Map<string, string>());
  const [loadedRuns, setLoadedRuns] = remembered("loadedRuns", () => new Set<string>());
  /** Which commit already had its failed run opened, the single run opened, and each run's last seen status. */
  const opened = props.memory?.("opened", newOpenedMemory) ?? newOpenedMemory();
  if (opened.dataKey !== props.dataKey) {
    opened.dataKey = props.dataKey;
    opened.autoExpandedSignature = null;
    opened.runSignatures.clear();
  }
  const [loadingRuns, setLoadingRuns] = createSignal<Set<string>>(new Set());
  const [pendingFocusRunId, setPendingFocusRunId] = createSignal<string | null>(null);
  const fetchControllers = new Map<string, AbortController>();
  /** Runs whose status changed while their jobs were loading; they load again when that request settles. */
  const reloadAfterLoad = new Set<string>();
  let previousDataKey = props.dataKey;
  const itemKey = (item: FlatItem<TRaw, TJobRaw>) =>
    item.kind === "reload"
      ? "reload"
      : item.kind === "run"
        ? `run:${item.run.id}`
        : item.kind === "job"
          ? `job:${item.run.id}:${item.job.id}`
          : item.kind === "attempt"
            ? `attempt:${item.run.id}:${item.attempt.number}`
            : `note:${item.run.id}:${item.job.id}:${item.note.id}`;
  const rows = useDetailRowMouse({
    mouseEnabled: () => props.mouseEnabled,
    onMouseFocus: props.onMouseFocus,
    setDetailCursorIndex: props.setDetailCursorIndex,
    activate: () => activateCurrentItem(),
    inert: key => key === "reload" && (!reloadEnabled() || reloadBusy()),
  });
  const { mouseRow, hoverBg } = rows;

  // Before every memo that reads them (createMemo runs at once).
  const runJobs = createMemo(() => new Map([...fetchedJobs()].map(([id, jobs]) => [id, splitAttempts(jobs)])));
  const jobsOf = (runId: string) =>
    runJobs().get(runId) ?? { latest: 1, current: [] as ProviderTreeJob<TJobRaw>[], attempts: [] };
  const attemptKey = (runId: string, number: number) => `${runId}:${number}`;
  const toggleAttempt = (runId: string, number: number) =>
    setExpandedAttempts(prev => {
      const next = new Set(prev);
      const key = attemptKey(runId, number);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const statusMark = (status: string, conclusion: string | null) => statusIcon(categorize(status, conclusion));
  /** When the last of these jobs ended: an earlier attempt's age. */
  const lastFinished = (jobs: readonly ProviderTreeJob<TJobRaw>[]) =>
    jobs.reduce<string | null>(
      (latest, job) => (job.completedAt && (!latest || job.completedAt > latest) ? job.completedAt : latest),
      null,
    );

  /**
   * The ages column of runs and earlier attempts. Rows show no times or counts, like the OpenShift tree: a job's and
   * a step's time are in the log viewer.
   */
  const rightInfoWidth = createMemo(() => {
    let max = 0;
    for (const run of props.runs) {
      max = Math.max(max, formatRelativeDate(run.updatedAt).length);
      for (const attempt of jobsOf(run.id).attempts) {
        const finished = lastFinished(attempt.jobs);
        if (finished) max = Math.max(max, formatRelativeDate(finished).length);
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
    const openAttempts = expandedAttempts();
    const items: FlatItem<TRaw, TJobRaw>[] = [];
    let idx = 0;
    // A disabled reload row stays visible (muted) but leaves the cursor order.
    if (props.onReloadCommit && reloadEnabled()) items.push({ kind: "reload", flatIndex: idx++ });
    for (const run of props.runs) {
      items.push({ kind: "run", run, flatIndex: idx++ });
      if (expanded.has(run.id)) {
        const { current, attempts } = jobsOf(run.id);
        for (const job of current) {
          items.push({ kind: "job", job, run, flatIndex: idx++ });
          for (const note of job.notes ?? []) items.push({ kind: "note", note, job, run, flatIndex: idx++ });
        }
        for (const attempt of attempts) {
          items.push({ kind: "attempt", attempt, run, flatIndex: idx++ });
          if (!openAttempts.has(attemptKey(run.id, attempt.number))) continue;
          for (const job of attempt.jobs) items.push({ kind: "job", job, run, flatIndex: idx++ });
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
  const isSettled = (run: ProviderTreeRun<TRaw>) => {
    const jobs = fetchedJobs().get(run.id) ?? [];
    return (
      run.status === "completed" &&
      jobs.every(job => job.status === "completed" && job.steps.every(step => step.status === "completed")) &&
      (props.jobsFinal?.(jobs) ?? true)
    );
  };

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
  const runSignatures = opened.runSignatures;
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

  /** Stops what this tree has running: a tree mounted again (or for another commit) starts its own. */
  const stopLoading = () => {
    for (const ctrl of fetchControllers.values()) ctrl.abort();
    fetchControllers.clear();
    setLoadingRuns(new Set<string>());
    setPendingFocusRunId(null);
    reloadAfterLoad.clear();
    rows.clearHover();
  };

  const resetRunState = () => {
    stopLoading();
    setExpandedRuns(new Set<string>());
    setExpandedAttempts(new Set<string>());
    setFetchedJobs(new Map<string, ProviderTreeJob<TJobRaw>[]>());
    setJobErrors(new Map<string, string>());
    setLoadedRuns(new Set<string>());
    opened.dataKey = props.dataKey;
    opened.autoExpandedSignature = null;
    runSignatures.clear();
  };

  createEffect(() => {
    const dataKey = props.dataKey;
    if (dataKey === previousDataKey) return;
    previousDataKey = dataKey;
    resetRunState();
  });

  onCleanup(stopLoading);

  // Back from another tab or layout: an open run whose jobs had not arrived yet loads them again.
  onMount(() => {
    for (const run of props.runs) {
      if (expandedRuns().has(run.id) && !loadedRuns().has(run.id) && !jobErrors().has(run.id)) void loadJobsForRun(run);
    }
  });

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

  // The dashboard's event: its run opens once (closing it sticks), and the focus starts on it once. Opening loads its
  // jobs, so it waits until the event stays selected: browsing past events loads nothing. Jobs already loaded, or the
  // tab's focus, open it at once.
  createEffect(() => {
    const id = props.targetRunId;
    const run = id ? props.runs.find(candidate => candidate.id === id) : undefined;
    if (!id || !run) return;
    const key = `${props.dataKey}\u0000${id}`;
    if (opened.targetOpenedKey === key) return;
    const open = () => {
      opened.targetOpenedKey = key;
      if (!untrack(expandedRuns).has(id)) untrack(() => toggleRun(run));
    };
    if (props.detailFocused() || untrack(fetchedJobs).has(id)) {
      open();
      return;
    }
    const timer = setTimeout(open, TARGET_OPEN_DELAY_MS);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => {
    const id = props.targetRunId;
    if (!id || !props.detailFocused()) return;
    const key = `${props.dataKey}\u0000${id}`;
    if (opened.targetFocusedKey === key) return;
    // Tracked: a run that arrives later (its commit's data loads after the focus) still gets the cursor, once.
    const index = flatItems().findIndex(item => item.kind === "run" && item.run.id === id);
    if (index < 0) return;
    opened.targetFocusedKey = key;
    props.setDetailCursorIndex(index);
  });

  createEffect(() => {
    if (props.targetRunId || props.openFailedRun === false || !props.detailFocused() || props.runs.length === 0) return;
    const key = props.dataKey;
    if (opened.failureOpenedKey === key) return;
    opened.failureOpenedKey = key;
    const failed = props.runs.find(run => categorize(run.status, run.conclusion) === "fail");
    if (!failed || untrack(expandedRuns).size > 0) return;
    untrack(() => toggleRun(failed));
  });

  createEffect(() => {
    if (!props.autoExpandSingleRun) return;
    if (props.runs.length !== 1) return;
    const run = props.runs[0];
    const signature = `${run.id}:${run.runNumber}`;
    if (opened.autoExpandedSignature === signature) return;
    if (expandedRuns().has(run.id)) return;
    opened.autoExpandedSignature = signature;
    toggleRun(run);
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
    if (item.kind === "attempt") {
      toggleAttempt(item.run.id, item.attempt.number);
      return false;
    }
    if (item.kind === "note") {
      props.onOpenNote?.(item.note, item.job, item.run, jobsOf(item.run.id).current);
      return false;
    }
    // ←/→ in the log move between the jobs of the same attempt.
    const split = jobsOf(item.run.id);
    const siblings =
      (item.job.attempt ?? 1) === split.latest
        ? split.current
        : (split.attempts.find(attempt => attempt.number === item.job.attempt)?.jobs ?? [item.job]);
    props.onOpenJobAction?.(item.job, item.run, siblings);
    return false;
  };

  const tree = useDetailTree({
    navRef: props.navRef,
    keys: () => flatItems().map(itemKey),
    activate: activateCurrentItem,
    detailCursorIndex: props.detailCursorIndex,
    setDetailCursorIndex: props.setDetailCursorIndex,
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
    else if (item.kind === "attempt")
      props.setDetailCursorAction(
        expandedAttempts().has(attemptKey(item.run.id, item.attempt.number)) ? "collapse" : "expand",
      );
    else props.setDetailCursorAction(props.onOpenJobAction ? "view log" : null);
  });

  useOpenRowShortcut({
    navRef: props.navRef,
    detailFocused: props.detailFocused,
    url: () => {
      const item = flatItems()[props.detailCursorIndex()];
      if (item?.kind === "note") return item.note.url ?? item.job.url;
      if (item?.kind === "attempt") return item.run.url ? `${item.run.url}/attempts/${item.attempt.number}` : null;
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
          rowRef={tree.ref("reload")}
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
          const jobs = () => jobsOf(run.id).current;
          const attempts = () => jobsOf(run.id).attempts;
          /** A re-run says which attempt its jobs are from. */
          const runTail = () => (jobsOf(run.id).latest > 1 ? `  attempt ${jobsOf(run.id).latest}` : undefined);
          const jobError = () => jobErrors().get(run.id) ?? null;
          const isCursored = () => props.detailFocused() && props.detailCursorIndex() === runFlatIndex();
          const cat = () => categorize(run.status, run.conclusion);
          const color = () => statusColor(t(), cat());
          const relTime = () => formatRelativeDate(run.updatedAt);
          const runTreePrefix = () => (runIndexFn() === props.runs.length - 1 ? "└─ " : "├─ ");
          const runIndicatorColor = () => (isCursored() ? t().accent : t().foregroundMuted);
          const runTextColor = () =>
            isCursored()
              ? t().accent
              : run.id === props.targetRunId && props.targetColor
                ? props.targetColor
                : t().foreground;
          const runIsLast = () => runIndexFn() === props.runs.length - 1;
          const placeholderTreeLead = () => (runIsLast() ? "   " : "│  ");

          return (
            <box flexDirection="column" width="100%">
              <box
                ref={tree.ref(`run:${run.id}`)}
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
                  tail={runTail()}
                  tailFg={t().foregroundMuted}
                  active={isCursored()}
                  fg={runTextColor()}
                />
                <box flexShrink={0} width={1} />
                <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                  {relTime().padStart(rightInfoWidth())}
                </text>
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
                      <ScrollingLabel text={error()} active={false} fg={t().error} />
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
                    /** A passed job is one row; a failed or running one lists its steps (where it went wrong). */
                    const steps = () => (jobCat === "fail" || jobCat === "running" ? job.steps : []);
                    const jobTextColor = () => (isJobCursored() ? t().accent : t().foreground);
                    const jobTreeLead = () => (runIsLast() ? "   " : "│  ");
                    // Earlier attempts follow the jobs, so the last job is only last without them.
                    const jobIsLast = () => jobIndexFn() === jobs().length - 1 && attempts().length === 0;
                    const jobTreePrefix = () => (jobIsLast() ? "└─ " : "├─ ");
                    const notes = () => job.notes ?? [];
                    /** The lead of the job's children: steps, the notes row, and the notes without one. */
                    const childLead = () => jobTreeLead() + (jobIsLast() ? "   " : "│  ");

                    return (
                      <box flexDirection="column" width="100%">
                        <box
                          ref={tree.ref(`job:${run.id}:${job.id}`)}
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
                            tail={job.tail}
                            tailFg={t().foregroundMuted}
                            active={isJobCursored()}
                            fg={jobTextColor()}
                          />
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

                        <Show when={steps().length > 0}>
                          <For each={steps()}>
                            {(step, stepIndexFn) => {
                              const stepCat = categorize(step.status, step.conclusion);
                              const stepColor = () => statusColor(t(), stepCat);
                              const stepTreePrefix = () => jobTreeLead() + (jobIsLast() ? "   " : "│  ");
                              const stepConnector = () =>
                                stepIndexFn() === steps().length - 1 && notes().length === 0 ? "└─ " : "├─ ";

                              return (
                                <box flexDirection="row" width="100%">
                                  <text flexShrink={0} wrapMode="none" fg={t().border}>
                                    {stepTreePrefix()}
                                    {stepConnector()}
                                  </text>
                                  <ScrollingLabel text={step.name} active={false} fg={t().foregroundMuted} />
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
                                <ScrollingLabel text={label()} active={false} fg={t().foregroundMuted} />
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
                                  ref={tree.ref(key)}
                                  {...mouseRow(key, noteFlatIndex)}
                                  flexDirection="row"
                                  width="100%"
                                  backgroundColor={isNoteCursored() ? t().backgroundElementActive : hoverBg(key)}
                                >
                                  <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                                    {noteLead()}
                                    {noteConnector()}
                                  </text>
                                  <Show when={props.noteMarks !== false}>
                                    <text
                                      selectable={!props.mouseEnabled}
                                      flexShrink={0}
                                      wrapMode="none"
                                      fg={note.mark === "fail" ? t().error : t().warning}
                                    >
                                      {note.mark === "fail" ? "✗ " : "! "}
                                    </text>
                                  </Show>
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
                <For each={attempts()}>
                  {(attempt, attemptIndexFn) => {
                    const key = `attempt:${run.id}:${attempt.number}`;
                    const attemptFlatIndex = () =>
                      flatItems().findIndex(
                        it => it.kind === "attempt" && it.run.id === run.id && it.attempt.number === attempt.number,
                      );
                    const isAttemptCursored = () =>
                      props.detailFocused() && props.detailCursorIndex() === attemptFlatIndex();
                    const isOpen = () => expandedAttempts().has(attemptKey(run.id, attempt.number));
                    const isLastAttempt = () => attemptIndexFn() === attempts().length - 1;
                    const lead = () => (runIsLast() ? "   " : "│  ");
                    const childLead = () => lead() + (isLastAttempt() ? "   " : "│  ");
                    const status = () => attemptStatus(attempt.jobs);
                    const finished = () => lastFinished(attempt.jobs);
                    return (
                      <box flexDirection="column" width="100%">
                        <box
                          ref={tree.ref(key)}
                          {...mouseRow(key, attemptFlatIndex)}
                          flexDirection="row"
                          width="100%"
                          backgroundColor={isAttemptCursored() ? t().backgroundElementActive : hoverBg(key)}
                        >
                          <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                            {lead()}
                            {isLastAttempt() ? "└─ " : "├─ "}
                          </text>
                          <text
                            selectable={!props.mouseEnabled}
                            flexShrink={0}
                            wrapMode="none"
                            fg={isAttemptCursored() ? t().accent : t().foregroundMuted}
                          >
                            {isOpen() ? "▾ " : "▸ "}
                          </text>
                          <ScrollingLabel
                            selectable={!props.mouseEnabled}
                            text={`attempt ${attempt.number}`}
                            active={isAttemptCursored()}
                            fg={isAttemptCursored() ? t().accent : t().foreground}
                          />
                          <text
                            selectable={!props.mouseEnabled}
                            flexShrink={0}
                            wrapMode="none"
                            fg={t().foregroundMuted}
                          >
                            {(finished() ? formatRelativeDate(finished() ?? "") : "").padStart(rightInfoWidth())}
                          </text>
                          <text
                            selectable={!props.mouseEnabled}
                            flexShrink={0}
                            width={STATUS_COL_WIDTH}
                            wrapMode="none"
                            fg={statusColor(t(), categorize(status().status, status().conclusion))}
                          >
                            {statusMark(status().status, status().conclusion).padStart(STATUS_COL_WIDTH)}
                          </text>
                        </box>
                        <Show when={isOpen()}>
                          <For each={attempt.jobs}>
                            {(job, jobIndexFn) => {
                              const jobKey = `job:${run.id}:${job.id}`;
                              const jobFlatIndex = () =>
                                flatItems().findIndex(
                                  it => it.kind === "job" && it.job.id === job.id && it.run.id === run.id,
                                );
                              const isJobCursored = () =>
                                props.detailFocused() && props.detailCursorIndex() === jobFlatIndex();
                              return (
                                <box
                                  ref={tree.ref(jobKey)}
                                  {...mouseRow(jobKey, jobFlatIndex)}
                                  flexDirection="row"
                                  width="100%"
                                  backgroundColor={isJobCursored() ? t().backgroundElementActive : hoverBg(jobKey)}
                                >
                                  <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
                                    {childLead()}
                                    {jobIndexFn() === attempt.jobs.length - 1 ? "└─ " : "├─ "}
                                  </text>
                                  <ScrollingLabel
                                    selectable={!props.mouseEnabled}
                                    text={job.name}
                                    active={isJobCursored()}
                                    fg={isJobCursored() ? t().accent : t().foreground}
                                  />
                                  <text
                                    selectable={!props.mouseEnabled}
                                    flexShrink={0}
                                    width={STATUS_COL_WIDTH}
                                    wrapMode="none"
                                    fg={statusColor(t(), categorize(job.status, job.conclusion))}
                                  >
                                    {statusMark(job.status, job.conclusion).padStart(STATUS_COL_WIDTH)}
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
