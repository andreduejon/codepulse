/** JobLogDialog: CI logs (GitHub jobs, Jenkins builds, stages and failed tests), styled like the diff dialog. */

import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, type JSX, onMount, Show } from "solid-js";
import {
  DialogFooter,
  DialogOverlay,
  DialogTitle,
  DialogTitleBar,
  getStandardDialogFrame,
} from "../../components/dialogs/dialog-chrome";
import {
  highlightHits,
  LineNumber,
  LogSearchRow,
  useLogSearch,
  useSidewaysReveal,
  useVisibleNumberWidth,
} from "../../components/dialogs/log-search";
import { handleLogScrollKey, type LogViewState, LogViewStatus } from "../../components/dialogs/log-view";
import { fitTitleSegments } from "../../components/dialogs/title-utils";
import { KeyHint, KeyHintSeparator } from "../../components/key-hint";
import { useTheme } from "../../context/theme";
import { BUSY } from "../../utils/busy-text";
import { openUrl } from "../../utils/open-url";
import { stripTerminalControls } from "../../utils/terminal-text";
import { type StatusCategory, statusColor, statusIcon } from "./status";

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

interface LoadedLog {
  raw: string | null;
  summary: JobLogSummaryLine[];
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

function classifyLine(line: string): { kind: LogLineKind; text: string } | null {
  if (line.startsWith("##[endgroup]") || line.trim() === "") return null;
  if (line.startsWith("##[group]")) return { kind: "group", text: line.slice("##[group]".length) };
  const block = PIPELINE_BLOCK.exec(line);
  if (block) return { kind: "group", text: block[1] };
  // The rest of the Pipeline markup is Jenkins plumbing: shown, but quiet.
  if (/^\[Pipeline\]/i.test(line)) return { kind: "muted", text: line };
  if (line.startsWith("##[error]")) return { kind: "error", text: line.slice("##[error]".length) };
  if (line.startsWith("##[warning]")) return { kind: "warning", text: line.slice("##[warning]".length) };
  if (/\bwarning\b[: ]/i.test(line)) return { kind: "warning", text: line };
  if (
    /^error:/i.test(line) ||
    /^\s+at\s/.test(line) ||
    FAILURE_WORD.test(line) ||
    THROWABLE.test(line) ||
    TEST_FAILURE.test(line)
  )
    return { kind: "error", text: line };
  return { kind: "normal", text: line };
}

export function parseLogLines(raw: string): LogLine[] {
  const lines = raw.split("\n");
  const result: LogLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const classified = classifyLine(stripTimestamp(lines[i]));
    if (!classified) continue;
    result.push({ ...classified, lineNo: i + 1 });
  }
  return result;
}

export default function JobLogDialog(props: Readonly<JobLogDialogProps>) {
  const renderer = useRenderer();
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();

  const dialogFrame = createMemo(() => getStandardDialogFrame(dimensions()));
  const dialogWidth = () => dialogFrame().width;
  const dialogHeight = () => dialogFrame().height;

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
  const [wrapEnabled, setWrapEnabled] = createSignal(false);

  let scrollboxRef: ScrollBoxRenderable | undefined;

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
        setLoadedLog(job.id, { raw: content.log, summary: content.summary ?? [], loading: false, error: null });
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
  const viewState = (): LogViewState | null => {
    const loaded = currentLoadedLog();
    if (loaded.loading) return { kind: "loading", text: BUSY.fetchingLog };
    if (loaded.error) return { kind: "error", title: "Failed to load log", message: loaded.error };
    if (!loaded.raw?.trim()) return { kind: "empty", text: "No log output." };
    if (filteredLines().length === 0) return { kind: "empty", text: "No log lines in this view." };
    return null;
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

  const filteredLines = createMemo(() => {
    const mode = viewMode();
    if (mode === "raw") {
      const raw = currentLoadedLog().raw;
      if (!raw) return [] as LogLine[];
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

  const lineRefs: Renderable[] = [];
  const maxLineNoWidth = useVisibleNumberWidth({
    scrollbox: () => scrollboxRef,
    rowAt: index => lineRefs[index],
    lines: filteredLines,
    numberAt: index => filteredLines()[index].lineNo,
    layoutKey: wrapEnabled,
  });
  const search = useLogSearch({
    texts: () => filteredLines().map(line => line.text),
    rowAt: index => lineRefs[index],
    scrollbox: () => scrollboxRef,
    onActiveChange: active => props.onSearchActive?.(active),
  });
  // Inner width: the dialog's frame (1) and padding (4) on both sides, then the line numbers and their gap.
  const reveal = useSidewaysReveal({
    search,
    texts: () => filteredLines().map(line => line.text),
    wrap: wrapEnabled,
    width: () => dialogWidth() - 10 - (maxLineNoWidth() + 2),
  });
  // After mount, so the app hears that the search owns Esc (the first hit shows once the log has loaded).
  onMount(() => {
    if (props.initialSearch) search.setQuery(props.initialSearch);
  });

  createEffect(() => {
    currentJob().id;
    viewMode();
    scrollboxRef?.scrollTo(0);
  });

  const navigateJob = (direction: -1 | 1) => {
    const next = jobIndex() + direction;
    if (next < 0 || next >= orderedJobs().length) return;
    setJobIndex(next);
  };
  const noun = () => props.entryNoun ?? "job";
  /** Where ← goes (`previous stage`, `full log`); null at the first, so the footer leaves the arrow out. */
  const previousLabel = () => {
    const previous = orderedJobs()[jobIndex() - 1];
    return previous ? (previous.navLabel ?? `previous ${noun()}`) : null;
  };
  /** Where → goes: from a named first entry (the full log) to the `first stage`, else the `next stage`. */
  const nextLabel = () => {
    if (jobIndex() >= orderedJobs().length - 1) return null;
    return jobIndex() === 0 && currentJob().navLabel ? `first ${noun()}` : `next ${noun()}`;
  };
  const cycleViewMode = () =>
    setViewMode(prev => VIEW_MODE_CYCLE[(VIEW_MODE_CYCLE.indexOf(prev) + 1) % VIEW_MODE_CYCLE.length]);
  const toggleWrap = () => setWrapEnabled(prev => !prev);
  const openRun = () => {
    if (props.run.url) openUrl(props.run.url);
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;
    if (search.handleKey(e)) return;
    if (handleLogScrollKey(e, scrollboxRef, dialogHeight() - 6)) {
      e.preventDefault();
      return;
    }
    switch (e.name) {
      case "q":
        e.preventDefault();
        renderer.destroy();
        break;
      case "escape":
        e.preventDefault();
        props.onClose();
        break;
      case "left":
      case "h":
        e.preventDefault();
        navigateJob(-1);
        break;
      case "right":
      case "l":
        e.preventDefault();
        navigateJob(1);
        break;
      case "r":
        e.preventDefault();
        refreshLog();
        break;
      case "c":
        e.preventDefault();
        cycleViewMode();
        break;
      case "w":
        e.preventDefault();
        toggleWrap();
        break;
      case "o":
        if (!props.run.url) break;
        e.preventDefault();
        openRun();
        break;
    }
  });

  const titleElement = createMemo((): JSX.Element => {
    const isJenkins = props.provider === "jenkins";
    // Like the diff title: context (time, mode, then provider) goes first; the run and job shrink last.
    const segments = fitTitleSegments(
      [
        { text: isJenkins ? "Jenkins" : "GitHub Actions", drop: 3 },
        { text: `${props.run.name} #${props.run.runNumber}`, drop: 4 },
        { text: currentJob().name, emphasis: true, primary: true },
        { text: currentJob().detail ?? "", drop: 1 },
        { text: VIEW_MODE_TITLE_LABEL[viewMode()], drop: 2 },
      ],
      dialogWidth(),
    );
    return <DialogTitle segments={segments} />;
  });

  const renderLine = (line: LogLine, index: () => number) => {
    const th = theme();
    const lineNo = () => (line.lineNo > 0 ? line.lineNo.toString() : "").padStart(maxLineNoWidth());
    const contentWrapMode = () => (wrapEnabled() ? "word" : "none");
    const text = (value: string) => highlightHits(reveal(value), search.term(), { fg: th.background, bg: th.accent });
    const isCurrentHit = () => search.current() === index();
    const ref = (element: Renderable) => {
      lineRefs[index()] = element;
    };
    if (line.kind === "group") {
      return (
        <box ref={ref} flexDirection="row" width="100%">
          <LineNumber text={lineNo()} current={isCurrentHit()} />
          <text wrapMode={contentWrapMode()} fg={th.accent}>
            <strong>
              {"▸ "}
              {text(line.text)}
            </strong>
          </text>
        </box>
      );
    }
    if (line.kind === "error") {
      return (
        <box ref={ref} flexDirection="row" width="100%" backgroundColor={th.diffRemovedBg}>
          <LineNumber text={lineNo()} current={isCurrentHit()} />
          <text wrapMode={contentWrapMode()} fg={th.error}>
            {text(line.text)}
          </text>
        </box>
      );
    }
    if (line.kind === "warning") {
      return (
        <box ref={ref} flexDirection="row" width="100%">
          <LineNumber text={lineNo()} current={isCurrentHit()} />
          <text wrapMode={contentWrapMode()} fg={th.warning}>
            {text(line.text)}
          </text>
        </box>
      );
    }
    if (line.kind === "muted") {
      return (
        <box ref={ref} flexDirection="row" width="100%">
          <LineNumber text={lineNo()} current={isCurrentHit()} />
          <text wrapMode={contentWrapMode()} fg={th.foregroundMuted}>
            {text(line.text)}
          </text>
        </box>
      );
    }
    return (
      <box ref={ref} flexDirection="row" width="100%">
        {/* A summary row's mark takes its line number's place, right-aligned, so the text starts with the log's. */}
        <Show
          when={!isCurrentHit() && line.mark}
          fallback={
            <LineNumber
              text={line.mark ? statusIcon(line.mark).padStart(maxLineNoWidth()) : lineNo()}
              current={isCurrentHit()}
            />
          }
        >
          {mark => (
            <text flexShrink={0} wrapMode="none" fg={statusColor(th, mark())}>
              {`${statusIcon(mark()).padStart(maxLineNoWidth())}  `}
            </text>
          )}
        </Show>
        <text wrapMode={contentWrapMode()} fg={th.foreground}>
          {text(line.text)}
        </text>
      </box>
    );
  };

  return (
    <DialogOverlay align="top" topOffset={2}>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={theme().background}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title={titleElement()} onClose={props.onClose} />

        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          {/* An error box brings its own frame and inset, so it skips the text inset (like the diff dialog). */}
          <box flexDirection="column" width="100%" paddingX={viewState()?.kind === "error" ? 0 : 4}>
            <Show
              when={viewState()}
              fallback={<For each={filteredLines()}>{(line, index) => renderLine(line, index)}</For>}
            >
              {state => <LogViewStatus state={state()} />}
            </Show>
          </box>
        </scrollbox>

        <LogSearchRow search={search} placeholder="Search log..." />
        <DialogFooter>
          <Show when={previousLabel()}>
            {label => (
              <>
                <KeyHint key="←" desc={` ${label()}`} onClick={() => navigateJob(-1)} />
                <KeyHintSeparator />
              </>
            )}
          </Show>
          <Show when={nextLabel()}>
            {label => (
              <>
                <KeyHint key="→" desc={` ${label()}`} onClick={() => navigateJob(1)} />
                <KeyHintSeparator />
              </>
            )}
          </Show>
          <Show
            when={search.term()}
            fallback={<KeyHint key="/" desc=" search" onClick={() => search.setEditing(true)} />}
          >
            <KeyHint key="n/N" desc=" next/previous" onClick={() => search.step(1)} />
          </Show>
          <KeyHintSeparator />
          <KeyHint key="c" desc=" view" onClick={cycleViewMode} />
          <KeyHintSeparator />
          <KeyHint key="w" desc={wrapEnabled() ? " nowrap" : " wrap"} onClick={toggleWrap} />
          <KeyHintSeparator />
          <KeyHint key="r" desc=" refresh" onClick={refreshLog} />
          <Show when={props.run.url}>
            <KeyHintSeparator />
            <KeyHint key="o" desc=" open" onClick={openRun} />
          </Show>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
