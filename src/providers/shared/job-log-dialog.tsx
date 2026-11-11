/** JobLogDialog: CI logs (GitHub jobs, Jenkins builds, stages and failed tests), styled like the diff dialog. */

import { createEffect, createMemo, createSignal } from "solid-js";
import type { LogViewState } from "../../components/dialogs/log-view";
import { LogViewer, type LogViewerNavigation } from "../../components/dialogs/log-viewer";
import { BUSY } from "../../utils/busy-text";
import { openUrl } from "../../utils/open-url";
import { stripTerminalControls } from "../../utils/terminal-text";
import type { StatusCategory } from "./status";

type LogLineKind = "group" | "error" | "warning" | "normal" | "muted";
type LogViewMode = "all" | "issues" | "errors" | "raw";

interface LogLine {
  kind: LogLineKind;
  text: string;
  /** The line in the log as received; 0 for a summary line, which has no number. */
  lineNo: number;
  /** A status mark before the text (a summary row). */
  mark?: StatusCategory;
}

/** A line above the log in the "all" view (a Jenkins build's summary): no line number, an optional status mark. */
export interface JobLogSummaryLine {
  text: string;
  kind: "muted" | "normal";
  mark?: StatusCategory;
}

/** A log with lines to show above it. */
export interface JobLogContent {
  log: string;
  summary?: JobLogSummaryLine[];
  /** The entry's time as read with the log, for the title: a job that was running when it opened has one now. */
  detail?: string;
}

/** One log the dialog moves between with ←/→: a GitHub job, a Jenkins build or stage, a failed test. */
export interface JobLogEntry {
  id: string | number;
  name: string;
  /** After the name in the title (a Jenkins stage's time). */
  detail?: string;
  /** How the footer names it as an arrow's target (`← full log`); otherwise `previous stage`, `next stage`. */
  navLabel?: string;
}

/** What the app opens the dialog with: a provider builds it (`githubJobLogTarget`, `jenkinsBuildLogTarget`, …). */
export interface JobLogTarget {
  provider: "github-actions" | "jenkins";
  job: JobLogEntry;
  run: { name: string; runNumber: number; url?: string };
  jobs: JobLogEntry[];
  fetchLog: (job: JobLogEntry) => Promise<string | JobLogContent>;
  /** Searched when the log opens (an annotation's message). */
  search?: string;
  /** What ←/→ move between, for the footer: `job` by default. */
  noun?: string;
}

interface LoadedLog {
  raw: string | null;
  summary: JobLogSummaryLine[];
  /** The time read with the log; the entry's own until then. */
  detail?: string;
  loading: boolean;
  error: string | null;
}

interface JobLogDialogProps {
  provider: "github-actions" | "jenkins";
  job: JobLogEntry;
  jobs: JobLogEntry[];
  run: { name: string; runNumber: number; url?: string };
  fetchLog: (job: JobLogEntry) => Promise<string | JobLogContent>;
  /** What ←/→ move between, for the footer (`previous stage`): `job` by default. */
  entryNoun?: string;
  onClose: () => void;
  /** The search row starts or stops owning Esc (see `useLogSearch`). */
  onSearchActive?: (active: boolean) => void;
  /** Opened from an annotation: its message, searched from the start so the log shows where it happened. */
  initialSearch?: string;
}

const VIEW_MODE_CYCLE: LogViewMode[] = ["all", "issues", "errors", "raw"];
const VIEW_MODE_TITLE_LABEL: Record<LogViewMode, string> = {
  all: "",
  issues: "issues only",
  errors: "errors only",
  raw: "raw",
};

function stripTimestamp(line: string): string {
  return stripTerminalControls(line)
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/, "")
    .replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\]\s?/, "");
}

/**
 * A Jenkins Pipeline block's opening, `[Pipeline] { (Unit tests)`: a heading with the block's name. A parallel branch
 * (`Branch: Unit tests`) opens its stage right after, so only the stage is a heading.
 */
const PIPELINE_BLOCK = /^\[Pipeline\]\s+\{\s+\((?!Branch: )(.+)\)\s*$/i;
/** `failed`, `error:`, `FAILED` at the end of a line; not `0 failed`. */
const FAILURE_WORD = /(?<!\b0 )\b(error|exception|failed|failure)\b(?:[: ]|$)/i;
/** An error or exception class with its message: `AssertionFailedError: expected…`, `TimeoutException: …`. */
const THROWABLE = /\b\w*(?:Error|Exception):/;
/** A test runner's failed test or file: Bun's `(fail)`, Jest's `✕`, Vitest's `×`, and `FAIL src/…`. */
const TEST_FAILURE = /^\s*(?:\(fail\)\s|[✕×]\s|FAIL\s)/;
/** A test runner's passing test (Bun's `(pass)`, Jest's `✓`, Gradle's `PASSED`): fine, whatever its name says. */
const TEST_PASS = /^\s*(?:\(pass\)\s|✓\s)|\sPASSED$/;

function classifyLine(line: string): { kind: LogLineKind; text: string } | null {
  if (line.startsWith("##[endgroup]") || line.trim() === "") return null;
  if (line.startsWith("##[group]")) return { kind: "group", text: line.slice("##[group]".length) };
  const block = PIPELINE_BLOCK.exec(line);
  if (block) return { kind: "group", text: block[1] };
  // The rest of the Pipeline markup is Jenkins plumbing: shown, but quiet.
  if (/^\[Pipeline\]/i.test(line)) return { kind: "muted", text: line };
  if (line.startsWith("##[error]")) return { kind: "error", text: line.slice("##[error]".length) };
  if (line.startsWith("##[warning]")) return { kind: "warning", text: line.slice("##[warning]".length) };
  // A test runner's verdict comes first: whatever the test's name says, it passed or it failed.
  if (TEST_PASS.test(line)) return { kind: "normal", text: line };
  if (TEST_FAILURE.test(line)) return { kind: "error", text: line };
  if (/\bwarning\b[: ]/i.test(line)) return { kind: "warning", text: line };
  if (/^error:/i.test(line) || /^\s+at\s/.test(line) || FAILURE_WORD.test(line) || THROWABLE.test(line))
    return { kind: "error", text: line };
  return { kind: "normal", text: line };
}

export function parseLogLines(raw: string): LogLine[] {
  // GitHub's job logs start with a byte order mark, before the first line's timestamp.
  const lines = raw.replace(/^\ufeff/, "").split("\n");
  const result: LogLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const classified = classifyLine(stripTimestamp(lines[i]));
    if (!classified) continue;
    result.push({ ...classified, lineNo: i + 1 });
  }
  return result;
}

export default function JobLogDialog(props: Readonly<JobLogDialogProps>) {
  const orderedJobs = createMemo(() => {
    const seen = new Set<string>();
    const result: JobLogEntry[] = [];
    for (const job of props.jobs.length > 0 ? props.jobs : [props.job]) {
      const key = String(job.id);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(job);
    }
    if (!seen.has(String(props.job.id))) result.unshift(props.job);
    return result;
  });

  const initialIndex = () =>
    Math.max(
      0,
      orderedJobs().findIndex(job => String(job.id) === String(props.job.id)),
    );
  const [jobIndex, setJobIndex] = createSignal(initialIndex());
  const [logs, setLogs] = createSignal<Map<string, LoadedLog>>(new Map());
  const [viewMode, setViewMode] = createSignal<LogViewMode>("all");

  const currentJob = () => orderedJobs()[jobIndex()] ?? props.job;
  const currentLoadedLog = (): LoadedLog =>
    logs().get(String(currentJob().id)) ?? { raw: null, summary: [], loading: true, error: null };

  const setLoadedLog = (jobId: string | number, loaded: LoadedLog) => {
    setLogs(prev => {
      const next = new Map(prev);
      next.set(String(jobId), loaded);
      return next;
    });
  };

  const loadCurrentJob = () => {
    const job = currentJob();
    const cached = logs().get(String(job.id));
    // Cache terminal failure/empty states too. Otherwise the effect below
    // re-enters after setting `{ loading: false, error: ... }` and refetches
    // the same failed/empty log forever.
    if (cached) return;
    setLoadedLog(job.id, { raw: null, summary: [], loading: true, error: null });
    props
      .fetchLog(job)
      // An empty log is a successful, neutral result; only a failed request is an error (with its reason).
      .then(result => {
        const content = typeof result === "string" ? { log: result } : result;
        setLoadedLog(job.id, {
          raw: content.log,
          summary: content.summary ?? [],
          detail: content.detail,
          loading: false,
          error: null,
        });
      })
      .catch(error =>
        setLoadedLog(job.id, {
          raw: null,
          summary: [],
          loading: false,
          error: error instanceof Error && error.message ? error.message : String(error),
        }),
      );
  };
  /** `r`: fetch the current job's log again (newer output of a running job, or a retry after a failure). */
  const refreshLog = () => {
    const key = String(currentJob().id);
    if (logs().get(key)?.loading) return;
    setLogs(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  createEffect(() => {
    orderedJobs();
    const max = Math.max(0, orderedJobs().length - 1);
    if (jobIndex() > max) setJobIndex(max);
  });

  createEffect(() => {
    currentJob().id;
    loadCurrentJob();
  });

  const parsedLines = createMemo(() => {
    const raw = currentLoadedLog().raw;
    if (!raw) return [] as LogLine[];
    return parseLogLines(raw);
  });

  const filteredLines = createMemo((): LogLine[] => {
    const mode = viewMode();
    if (mode === "raw") {
      const raw = currentLoadedLog().raw;
      if (!raw) return [];
      // Raw is the log as received: timestamps and blank lines stay; only terminal control codes are removed.
      return raw
        .split("\n")
        .map((text, i) => ({ kind: "normal" as LogLineKind, text: stripTerminalControls(text), lineNo: i + 1 }));
    }
    if (mode === "all") {
      // A summary goes first, without line numbers, then an empty line.
      const summary = currentLoadedLog().summary;
      if (summary.length === 0) return parsedLines();
      return [
        ...summary.map(line => ({ ...line, lineNo: 0 })),
        { kind: "normal" as LogLineKind, text: "", lineNo: 0 },
        ...parsedLines(),
      ];
    }
    if (mode === "issues") return parsedLines().filter(line => line.kind === "warning" || line.kind === "error");
    return parsedLines().filter(line => line.kind === "error");
  });

  const viewState = (): LogViewState | null => {
    const loaded = currentLoadedLog();
    if (loaded.loading) return { kind: "loading", text: BUSY.fetchingLog };
    if (loaded.error) return { kind: "error", title: "Failed to load log", message: loaded.error };
    if (!loaded.raw?.trim()) return { kind: "empty", text: "No log output." };
    if (filteredLines().length === 0) return { kind: "empty", text: "No log lines in this view." };
    return null;
  };

  const noun = () => props.entryNoun ?? "job";
  /** ←/→: where each goes (`previous stage`, `full log`, `first stage`); null at the ends, so the footer leaves it out. */
  const navigation = (): LogViewerNavigation => {
    const index = jobIndex();
    const previous = orderedJobs()[index - 1];
    const hasNext = index < orderedJobs().length - 1;
    return {
      previous: previous ? (previous.navLabel ?? `previous ${noun()}`) : null,
      // From a named first entry (the full log) to the `first stage`, else the `next stage`.
      next: !hasNext ? null : index === 0 && currentJob().navLabel ? `first ${noun()}` : `next ${noun()}`,
      go: direction => {
        const next = jobIndex() + direction;
        if (next >= 0 && next < orderedJobs().length) setJobIndex(next);
      },
    };
  };
  const cycleViewMode = () =>
    setViewMode(prev => VIEW_MODE_CYCLE[(VIEW_MODE_CYCLE.indexOf(prev) + 1) % VIEW_MODE_CYCLE.length]);
  const openRun = () => {
    if (props.run.url) openUrl(props.run.url);
  };

  return (
    <LogViewer
      // Like the diff title: context (time, mode, then provider) goes first; the run and job shrink last.
      title={() => [
        { text: props.provider === "jenkins" ? "Jenkins" : "GitHub Actions", drop: 3 },
        { text: `${props.run.name} #${props.run.runNumber}`, drop: 4 },
        { text: currentJob().name, emphasis: true, primary: true },
        { text: currentLoadedLog().detail ?? currentJob().detail ?? "", drop: 1 },
        { text: VIEW_MODE_TITLE_LABEL[viewMode()], drop: 2 },
      ]}
      lines={filteredLines}
      state={viewState}
      searchPlaceholder={() => "Search log..."}
      actions={() => ({ view: cycleViewMode, refresh: refreshLog, open: props.run.url ? openRun : undefined })}
      navigation={navigation}
      scrollKey={() => [currentJob().id, viewMode()]}
      onClose={props.onClose}
      onSearchActive={props.onSearchActive}
      initialSearch={props.initialSearch}
    />
  );
}
