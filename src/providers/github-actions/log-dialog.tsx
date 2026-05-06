/** JobLogDialog — paged GitHub Actions job logs, styled like the diff dialog. */

import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, type JSX, Show } from "solid-js";
import {
  DialogFooter,
  DialogOverlay,
  DialogTitleBar,
  getStandardDialogFrame,
} from "../../components/dialogs/dialog-chrome";
import { middleTruncate, TITLE_SEP } from "../../components/dialogs/title-utils";
import { KeyHint, KeyHintSeparator } from "../../components/key-hint";
import MessageBox from "../../components/message-box";
import { useTheme } from "../../context/theme";
import { useT } from "../../hooks/use-t";

type LogLineKind = "group" | "error" | "warning" | "normal";
type LogViewMode = "all" | "issues" | "errors";

interface LogLine {
  kind: LogLineKind;
  text: string;
  lineNo: number;
}

interface LoadedLog {
  raw: string | null;
  loading: boolean;
  error: string | null;
}

interface JobLogDialogProps {
  job: { id: string | number; name: string };
  jobs: { id: string | number; name: string }[];
  run: { name: string; runNumber: number };
  fetchLog: (job: { id: string | number; name: string }) => Promise<string>;
  onClose: () => void;
}

const SCROLL_JUMP = 10;
const VIEW_MODE_CYCLE: LogViewMode[] = ["all", "issues", "errors"];
const VIEW_MODE_NEXT_LABEL: Record<LogViewMode, string> = {
  all: "show issues only",
  issues: "show errors only",
  errors: "show all",
};
const VIEW_MODE_TITLE_LABEL: Record<LogViewMode, string> = {
  all: "",
  issues: "issues only",
  errors: "errors only",
};

function stripTimestamp(line: string): string {
  return line
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/, "")
    .replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\]\s?/, "");
}

function classifyLine(line: string): { kind: LogLineKind; text: string } | null {
  if (line.startsWith("##[endgroup]") || line.trim() === "") return null;
  if (line.startsWith("##[group]")) return { kind: "group", text: line.slice("##[group]".length) };
  if (/^\[Pipeline\]\s+stage$/i.test(line)) return { kind: "group", text: line };
  if (/^\[Pipeline\]\s+\{\s+\(.+\)\s*$/i.test(line)) return { kind: "group", text: line };
  if (line.startsWith("##[error]")) return { kind: "error", text: line.slice("##[error]".length) };
  if (line.startsWith("##[warning]")) return { kind: "warning", text: line.slice("##[warning]".length) };
  if (/\bwarning\b[: ]/i.test(line)) return { kind: "warning", text: line };
  if (/^error:/i.test(line) || /^\s+at\s/.test(line) || /\b(error|exception|failed|failure)\b[: ]/i.test(line))
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
  const t = useT();
  const renderer = useRenderer();
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();

  const dialogFrame = createMemo(() => getStandardDialogFrame(dimensions()));
  const dialogWidth = () => dialogFrame().width;
  const dialogHeight = () => dialogFrame().height;

  const orderedJobs = createMemo(() => {
    const seen = new Set<string>();
    const result: { id: string | number; name: string }[] = [];
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
  const [scrollRow, setScrollRow] = createSignal(0);
  const [viewMode, setViewMode] = createSignal<LogViewMode>("all");
  const [wrapEnabled, setWrapEnabled] = createSignal(false);

  let scrollboxRef: ScrollBoxRenderable | undefined;

  const currentJob = () => orderedJobs()[jobIndex()] ?? props.job;
  const hasMultipleJobs = () => orderedJobs().length > 1;
  const currentLoadedLog = () => logs().get(String(currentJob().id)) ?? { raw: null, loading: true, error: null };

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
    setLoadedLog(job.id, { raw: null, loading: true, error: null });
    props
      .fetchLog(job)
      .then(text => {
        setLoadedLog(job.id, {
          raw: text || null,
          loading: false,
          error: text ? null : "No log output available.",
        });
      })
      .catch(() => setLoadedLog(job.id, { raw: null, loading: false, error: "Failed to load log." }));
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
    if (mode === "all") return parsedLines();
    if (mode === "issues") return parsedLines().filter(line => line.kind === "warning" || line.kind === "error");
    return parsedLines().filter(line => line.kind === "error");
  });

  const maxLineNoWidth = createMemo(() => Math.max(1, ...filteredLines().map(line => line.lineNo.toString().length)));

  const clampedScroll = (next: number) => {
    const max = Math.max(0, filteredLines().length - 1);
    return Math.max(0, Math.min(next, max));
  };
  const scroll = (delta: number) => setScrollRow(row => clampedScroll(row + delta));

  createEffect(() => {
    currentJob().id;
    viewMode();
    setScrollRow(0);
    scrollboxRef?.scrollTo(0);
  });

  createEffect(() => {
    scrollboxRef?.scrollTo(scrollRow());
  });

  const navigateJob = (direction: -1 | 1) => {
    const next = jobIndex() + direction;
    if (next < 0 || next >= orderedJobs().length) return;
    setJobIndex(next);
  };

  useKeyboard(e => {
    if (e.eventType === "release") return;
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
      case "up":
      case "k":
        e.preventDefault();
        scroll(e.shift ? -SCROLL_JUMP : -1);
        break;
      case "down":
      case "j":
        e.preventDefault();
        scroll(e.shift ? SCROLL_JUMP : 1);
        break;
      case " ":
        e.preventDefault();
        scroll(Math.floor((dialogHeight() - 6) / 2));
        break;
      case "g":
        e.preventDefault();
        setScrollRow(e.shift ? clampedScroll(filteredLines().length) : 0);
        break;
      case "c":
        e.preventDefault();
        setViewMode(prev => {
          const idx = VIEW_MODE_CYCLE.indexOf(prev);
          return VIEW_MODE_CYCLE[(idx + 1) % VIEW_MODE_CYCLE.length];
        });
        break;
      case "w":
        e.preventDefault();
        setWrapEnabled(prev => !prev);
        break;
    }
  });

  const titleElement = createMemo((): JSX.Element => {
    const counter = orderedJobs().length > 1 ? `[${jobIndex() + 1}/${orderedJobs().length}]` : "[1/1]";
    const runLabel = `${props.run.name} #${props.run.runNumber}`;
    const jobLabel = middleTruncate(currentJob().name, Math.max(8, dialogWidth() - 40));
    const modeLabel = VIEW_MODE_TITLE_LABEL[viewMode()];
    const segments = [counter, runLabel, jobLabel, modeLabel].filter(Boolean);
    return (
      <>
        {segments.map((segment, i) => (
          <>
            {i > 0 ? <span>{TITLE_SEP}</span> : null}
            {i === 2 ? (
              <strong>
                <span>{segment}</span>
              </strong>
            ) : (
              <span>{segment}</span>
            )}
          </>
        ))}
      </>
    );
  });

  const renderLine = (line: LogLine) => {
    const th = theme();
    const lineNo = line.lineNo.toString().padStart(maxLineNoWidth());
    const contentWrapMode = wrapEnabled() ? "word" : "none";
    if (line.kind === "group") {
      return (
        <box flexDirection="row" width="100%">
          <text flexShrink={0} wrapMode="none" fg={th.foregroundMuted}>{`${lineNo}  `}</text>
          <text wrapMode={contentWrapMode} fg={th.accent}>
            <strong>{`▸ ${line.text}`}</strong>
          </text>
        </box>
      );
    }
    if (line.kind === "error") {
      return (
        <box flexDirection="row" width="100%" backgroundColor={th.diffRemovedBg}>
          <text flexShrink={0} wrapMode="none" fg={th.foregroundMuted}>{`${lineNo}  `}</text>
          <text wrapMode={contentWrapMode} fg={th.error}>
            {line.text}
          </text>
        </box>
      );
    }
    if (line.kind === "warning") {
      return (
        <box flexDirection="row" width="100%">
          <text flexShrink={0} wrapMode="none" fg={th.foregroundMuted}>{`${lineNo}  `}</text>
          <text wrapMode={contentWrapMode} fg={th.accent}>
            {line.text}
          </text>
        </box>
      );
    }
    return (
      <box flexDirection="row" width="100%">
        <text flexShrink={0} wrapMode="none" fg={th.foregroundMuted}>{`${lineNo}  `}</text>
        <text wrapMode={contentWrapMode} fg={th.foreground}>
          {line.text}
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
        <DialogTitleBar title={titleElement()} />

        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" width="100%" paddingX={4}>
            <Show when={currentLoadedLog().loading}>
              <box flexGrow={1} alignItems="center" justifyContent="center" paddingY={2}>
                <text fg={t().foregroundMuted}>Loading log…</text>
              </box>
            </Show>
            <Show when={!currentLoadedLog().loading && currentLoadedLog().error}>
              <box paddingY={2}>
                <MessageBox
                  kind="error"
                  title="Failed to load log"
                  message={currentLoadedLog().error ?? "Unknown error"}
                  variant="dialog"
                />
              </box>
            </Show>
            <Show when={!currentLoadedLog().loading && !currentLoadedLog().error && filteredLines().length === 0}>
              <box flexGrow={1} alignItems="center" justifyContent="center" paddingY={2}>
                <text fg={t().foregroundMuted}>No log lines in this view</text>
              </box>
            </Show>
            <Show when={!currentLoadedLog().loading && !currentLoadedLog().error && filteredLines().length > 0}>
              <For each={filteredLines()}>{line => renderLine(line)}</For>
            </Show>
          </box>
        </scrollbox>

        <DialogFooter>
          <Show when={hasMultipleJobs()}>
            <KeyHint key={"←/→"} desc=" jobs" />
          </Show>
          <Show when={hasMultipleJobs()}>
            <KeyHintSeparator />
          </Show>
          <KeyHint key={"↑/↓"} desc=" scroll" />
          <KeyHintSeparator />
          <KeyHint key="c" desc={` ${VIEW_MODE_NEXT_LABEL[viewMode()]}`} />
          <KeyHintSeparator />
          <KeyHint key="w" desc={wrapEnabled() ? " disable wrap" : " enable wrap"} />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
