/**
 * JobLogDialog — displays the plain-text log output for a single GitHub Actions job.
 *
 * Log format emitted by GitHub Actions:
 *   - Step headers:  ##[group]Step name
 *   - Step end:      ##[endgroup]
 *   - Error lines:   ##[error]message  or lines starting with "Error:"
 *   - Warning lines: ##[warning]message
 *   - Normal output: anything else
 *
 * Rendering:
 *   - Step group headers → bold accent line (like hunk headers in the diff dialog)
 *   - Error lines → t().error foreground + t().diffRemovedBg background
 *   - Warning lines → t().warning / accent foreground
 *   - Normal lines → t().foreground
 *   - ##[endgroup] → hidden (skipped)
 *
 * Keyboard: Up/Down scroll, Page Up/Down, g/G jump to top/bottom, Escape close.
 */

import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "../../components/dialogs/dialog-chrome";
import { KeyHint } from "../../components/key-hint";
import { useTheme } from "../../context/theme";
import { useT } from "../../hooks/use-t";
import type { GitHubJob, GitHubWorkflowRun } from "../../providers/github-actions/types";

// ── Log line classification ───────────────────────────────────────────────

type LogLineKind = "group" | "error" | "warning" | "normal";

interface LogLine {
  kind: LogLineKind;
  /** Raw text after stripping the ##[...] prefix, or the full line for normal. */
  text: string;
}

/**
 * Parse the raw log text into classified lines.
 * Skips ##[endgroup] lines entirely.
 * Strips the ISO timestamp prefix GitHub prepends to every line (e.g. "2026-04-16T10:30:00.0000000Z ").
 */
function parseLogLines(raw: string): LogLine[] {
  const lines = raw.split("\n");
  const result: LogLine[] = [];
  for (const rawLine of lines) {
    // Strip leading ISO timestamp that GitHub prepends: "2026-04-16T10:30:00.0000000Z "
    const line = rawLine.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/, "");

    if (line.startsWith("##[endgroup]") || line.trim() === "") continue;

    if (line.startsWith("##[group]")) {
      result.push({ kind: "group", text: line.slice("##[group]".length) });
    } else if (line.startsWith("##[error]")) {
      result.push({ kind: "error", text: line.slice("##[error]".length) });
    } else if (line.startsWith("##[warning]")) {
      result.push({ kind: "warning", text: line.slice("##[warning]".length) });
    } else if (/^error:/i.test(line) || /^\s+at\s/.test(line)) {
      // Stack frames and bare "Error:" lines
      result.push({ kind: "error", text: line });
    } else {
      result.push({ kind: "normal", text: line });
    }
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────

interface JobLogDialogProps {
  job: GitHubJob;
  run: GitHubWorkflowRun;
  /** Async function to load the log text. */
  fetchLog: () => Promise<string>;
  onClose: () => void;
}

const SCROLL_JUMP = 10;

export default function JobLogDialog(props: Readonly<JobLogDialogProps>) {
  const t = useT();
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();

  const dialogWidth = () => Math.min(Math.floor(dimensions().width * 0.9), 160);
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.85), dimensions().height - 4);

  // ── Log loading ───────────────────────────────────────────────────────

  const [rawLog, setRawLog] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [logError, setLogError] = createSignal<string | null>(null);

  createEffect(() => {
    setLoading(true);
    setRawLog(null);
    setLogError(null);
    props
      .fetchLog()
      .then(text => {
        if (text === "") {
          setLogError("No log output available.");
        } else {
          setRawLog(text);
        }
        setLoading(false);
      })
      .catch(() => {
        setLogError("Failed to load log.");
        setLoading(false);
      });
  });

  const logLines = createMemo((): LogLine[] => {
    const raw = rawLog();
    if (!raw) return [];
    return parseLogLines(raw);
  });

  // ── Scrolling ─────────────────────────────────────────────────────────

  let scrollboxRef: ScrollBoxRenderable | undefined;
  const [scrollRow, setScrollRow] = createSignal(0);

  const clampedScroll = (next: number) => {
    const max = Math.max(0, logLines().length - 1);
    return Math.max(0, Math.min(next, max));
  };

  const scroll = (delta: number) => setScrollRow(r => clampedScroll(r + delta));

  createEffect(() => {
    // Sync scroll position to the scrollbox
    const row = scrollRow();
    const sb = scrollboxRef;
    if (!sb) return;
    // Each line is 1 row tall
    sb.scrollTo(row);
  });

  // ── Keyboard ──────────────────────────────────────────────────────────

  useKeyboard(e => {
    if (e.eventType === "release") return;
    switch (e.name) {
      case "escape":
        props.onClose();
        break;
      case "up":
      case "k":
        scroll(e.shift ? -SCROLL_JUMP : -1);
        break;
      case "down":
      case "j":
        scroll(e.shift ? SCROLL_JUMP : 1);
        break;
      case "pageup":
        scroll(-Math.floor((dialogHeight() - 6) / 2));
        break;
      case "pagedown":
        scroll(Math.floor((dialogHeight() - 6) / 2));
        break;
      case "g":
        setScrollRow(0);
        break;
      case "G":
        setScrollRow(clampedScroll(logLines().length));
        break;
    }
  });

  // ── Title ─────────────────────────────────────────────────────────────

  const title = () => `${props.job.name}  —  ${props.run.name} #${props.run.runNumber}`;

  // ── Line renderer ─────────────────────────────────────────────────────

  const renderLine = (line: LogLine) => {
    const th = theme();
    if (line.kind === "group") {
      return (
        <box flexDirection="row" width="100%">
          <text wrapMode="none" fg={th.accent}>
            <strong>{`  ▸ ${line.text}`}</strong>
          </text>
        </box>
      );
    }
    if (line.kind === "error") {
      return (
        <box flexDirection="row" width="100%" backgroundColor={th.diffRemovedBg}>
          <text wrapMode="none" fg={th.error}>
            {`  ${line.text}`}
          </text>
        </box>
      );
    }
    if (line.kind === "warning") {
      return (
        <box flexDirection="row" width="100%">
          <text wrapMode="none" fg={th.accent}>
            {`  ${line.text}`}
          </text>
        </box>
      );
    }
    // Normal line
    return (
      <box flexDirection="row" width="100%">
        <text wrapMode="none" fg={th.foregroundMuted}>
          {`  ${line.text}`}
        </text>
      </box>
    );
  };

  return (
    <DialogOverlay>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={theme().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title={title()} />

        <scrollbox
          ref={scrollboxRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" width="100%">
            <Show when={loading()}>
              <box flexGrow={1} alignItems="center" justifyContent="center" paddingY={2}>
                <text fg={t().foregroundMuted}>Loading log…</text>
              </box>
            </Show>
            <Show when={!loading() && logError()}>
              <box paddingY={2} paddingX={2}>
                <text fg={t().error}>{logError()}</text>
              </box>
            </Show>
            <Show when={!loading() && !logError()}>
              <For each={logLines()}>{line => renderLine(line)}</For>
            </Show>
          </box>
        </scrollbox>

        <DialogFooter>
          <KeyHint key="↑/↓" desc=" scroll  " />
          <KeyHint key="g/G" desc=" top/bottom  " />
          <KeyHint key="esc" desc=" close" />
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
