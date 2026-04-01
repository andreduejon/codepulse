import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useAppState } from "../../context/state";
import { useTheme } from "../../context/theme";
import { getFileBlame, getFileDiff } from "../../git/repo";
import type { BlameLine, DiffTarget, FileDiff } from "../../git/types";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./dialog-chrome";
import { buildRowOffsets, findLineAtRow, formatHunkHeader } from "./diff-utils";

/** Maximum number of diff lines displayed before truncation. */
const MAX_DISPLAY_LINES = 5000;

/** Maximum dialog width in columns (fits 120-150 char lines with gutter). */
const MAX_DIALOG_WIDTH = 160;

/** Number of offscreen lines to render above/below viewport as buffer. */
const WINDOW_BUFFER = 30;

/** Blame annotation width: "abc1234 Author " — short hash (7) + space + author (capped) + space */
const BLAME_COL_WIDTH = 22;

type DiffViewMode = "mixed" | "new" | "old";

const VIEW_MODE_CYCLE: DiffViewMode[] = ["mixed", "new", "old"];
/** Label describes what pressing `c` will switch TO (the next mode in the cycle). */
const VIEW_MODE_NEXT_LABEL: Record<DiffViewMode, string> = {
  mixed: "show new",
  new: "show old",
  old: "show all",
};

interface DiffBlameDialogProps {
  target: DiffTarget;
  onClose: () => void;
  /** Navigate to a different file within the same commit (left/right arrows). */
  onNavigate: (target: DiffTarget) => void;
}

/** Flatten all hunks into a single line array with hunk headers interspersed. */
interface DisplayLine {
  kind: "hunk-header" | "add" | "delete" | "context" | "spacer";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function buildDisplayLines(diff: FileDiff): DisplayLine[] {
  const lines: DisplayLine[] = [];
  for (let i = 0; i < diff.hunks.length; i++) {
    // Spacer (horizontal rule) before every hunk — including the first
    lines.push({ kind: "spacer", content: "" });
    const hunk = diff.hunks[i];
    lines.push({ kind: "hunk-header", content: hunk.header });
    for (const line of hunk.lines) {
      lines.push({
        kind: line.type,
        content: line.content,
        oldLineNo: line.oldLineNo,
        newLineNo: line.newLineNo,
      });
    }
  }
  // Spacer (horizontal rule) after the last hunk
  if (diff.hunks.length > 0) {
    lines.push({ kind: "spacer", content: "" });
  }
  return lines;
}

/** Width needed for a line number gutter column. */
function gutterWidth(maxLineNo: number): number {
  return Math.max(String(maxLineNo).length, 3);
}

/** Pad a line number to a fixed width, or return spaces if undefined. */
function padLineNo(lineNo: number | undefined, width: number): string {
  if (lineNo === undefined) return " ".repeat(width);
  return String(lineNo).padStart(width);
}

/** Build the merged gutter string: "oldLineNo newLineNo". */
function buildGutter(line: DisplayLine, oldWidth: number, newWidth: number): string {
  return `${padLineNo(line.oldLineNo, oldWidth)} ${padLineNo(line.newLineNo, newWidth)}`;
}

export default function DiffBlameDialog(props: Readonly<DiffBlameDialogProps>) {
  const { state } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();
  const renderer = useRenderer();

  // ── State ──────────────────────────────────────────────────────────
  const [diff, setDiff] = createSignal<FileDiff | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [blameLines, setBlameLines] = createSignal<BlameLine[]>([]);
  const [showBlame, setShowBlame] = createSignal(false);
  const [blameLoading, setBlameLoading] = createSignal(false);
  /** Whether blame has ever been fetched (lazy — only on first `b` press). */
  let blameFetched = false;
  const [viewMode, setViewMode] = createSignal<DiffViewMode>("mixed");

  let scrollboxRef: ScrollBoxRenderable | undefined;

  // ── Load diff reactively (re-runs when target changes) ─────────────
  createEffect(() => {
    const { commitHash, filePath, source } = props.target;
    // Reset blame state for new file
    blameFetched = false;
    setBlameLines([]);
    setShowBlame(false);

    setLoading(true);
    (async () => {
      try {
        const result = await getFileDiff(state.repoPath(), commitHash, filePath, source);
        setDiff(result);
      } catch {
        setDiff({ filePath, hunks: [], isBinary: false });
      } finally {
        setLoading(false);
      }
    })();
  });

  // ── Lazy blame fetch ───────────────────────────────────────────────
  const fetchBlame = async () => {
    if (blameFetched) return;
    blameFetched = true;
    setBlameLoading(true);
    try {
      const result = await getFileBlame(
        state.repoPath(),
        props.target.commitHash,
        props.target.filePath,
        props.target.source,
      );
      setBlameLines(result);
    } catch {
      setBlameLines([]);
    } finally {
      setBlameLoading(false);
    }
  };

  // ── Derived display data ───────────────────────────────────────────
  // Single memo builds both line array and truncation flag to avoid
  // calling buildDisplayLines twice.
  const diffData = createMemo(() => {
    const d = diff();
    if (!d) return { lines: [] as DisplayLine[], truncated: false };
    const all = buildDisplayLines(d);
    const truncated = all.length > MAX_DISPLAY_LINES;
    const lines = truncated ? all.slice(0, MAX_DISPLAY_LINES) : all;
    return { lines, truncated };
  });

  const displayLines = () => diffData().lines;
  const isTruncated = () => diffData().truncated;

  // Compute max line numbers for gutter sizing
  const maxOldLineNo = createMemo(() => {
    let max = 0;
    for (const line of displayLines()) {
      if (line.oldLineNo !== undefined && line.oldLineNo > max) max = line.oldLineNo;
    }
    return max;
  });

  const maxNewLineNo = createMemo(() => {
    let max = 0;
    for (const line of displayLines()) {
      if (line.newLineNo !== undefined && line.newLineNo > max) max = line.newLineNo;
    }
    return max;
  });

  // Filter lines based on view mode (mixed / new only / old only)
  const visibleLines = createMemo(() => {
    const mode = viewMode();
    const lines = displayLines();
    if (mode === "mixed") return lines;
    if (mode === "new") return lines.filter(l => l.kind !== "delete");
    return lines.filter(l => l.kind !== "add");
  });

  // Build a blame lookup: newLineNo → BlameLine
  const blameLookup = createMemo(() => {
    const map = new Map<number, BlameLine>();
    for (const bl of blameLines()) {
      map.set(bl.lineNo, bl);
    }
    return map;
  });

  // ── Dialog sizing ──────────────────────────────────────────────────
  const dialogWidth = createMemo(() => Math.min(Math.max(40, Math.floor(renderer.width * 0.85)), MAX_DIALOG_WIDTH));
  const dialogHeight = createMemo(() => Math.max(10, Math.floor(renderer.height * 0.9)));

  // ── Windowed rendering ─────────────────────────────────────────────
  // Track scroll position reactively via the scrollbar's "change" event.
  const [scrollTop, setScrollTop] = createSignal(0);

  // Mutable ref to hold the scrollbar listener cleanup function.
  // We use a ref because the listener is set up imperatively after the
  // scrollbox renders (inside a <Show>), and we need to clean up on unmount.
  const listenerRef: { cleanup: (() => void) | null } = { cleanup: null };

  /** Attach the scroll listener to the scrollbox's vertical scrollbar. */
  const attachScrollListener = (sb: ScrollBoxRenderable) => {
    // Remove any previous listener
    if (listenerRef.cleanup) listenerRef.cleanup();

    const handler = ({ position }: { position: number }) => {
      setScrollTop(position);
    };
    sb.verticalScrollBar.on("change", handler);
    listenerRef.cleanup = () => sb.verticalScrollBar.off("change", handler);
  };

  onCleanup(() => {
    if (listenerRef.cleanup) listenerRef.cleanup();
  });

  // Row offsets: prefix-sum for mapping line index ↔ row position.
  const rowOffsets = createMemo(() => buildRowOffsets(visibleLines()));

  /** Total row count of all visible lines (for spacer sizing). */
  const totalRows = createMemo(() => {
    const offsets = rowOffsets();
    return offsets[offsets.length - 1];
  });

  /** Compute the windowed slice of lines to render. */
  const windowSlice = createMemo(() => {
    const lines = visibleLines();
    const offsets = rowOffsets();
    const total = totalRows();
    if (lines.length === 0) return { startIdx: 0, endIdx: 0, topRows: 0, bottomRows: 0 };

    const st = scrollTop();
    // Estimate viewport height: use scrollbox viewport if available, else fallback
    const vpHeight = scrollboxRef?.viewport.height ?? dialogHeight() - 6;

    // Find first visible line (the line that contains the row at scrollTop)
    const firstVisible = findLineAtRow(offsets, st);
    // Find last visible line (the line at scrollTop + viewportHeight)
    const lastVisible = findLineAtRow(offsets, st + vpHeight);

    // Expand by buffer
    const startIdx = Math.max(0, firstVisible - WINDOW_BUFFER);
    const endIdx = Math.min(lines.length, lastVisible + WINDOW_BUFFER + 1);

    const topRows = offsets[startIdx];
    const bottomRows = total - offsets[endIdx];

    return { startIdx, endIdx, topRows, bottomRows };
  });

  /** The actual lines to render (windowed slice). */
  const windowedLines = createMemo(() => {
    const { startIdx, endIdx } = windowSlice();
    return visibleLines().slice(startIdx, endIdx);
  });

  // ── File navigation ────────────────────────────────────────────────
  const hasMultipleFiles = () => props.target.fileList.length > 1;

  const navigateFile = (direction: -1 | 1) => {
    const newIndex = props.target.fileIndex + direction;
    if (newIndex < 0 || newIndex >= props.target.fileList.length) return;
    const newPath = props.target.fileList[newIndex];
    props.onNavigate({
      commitHash: props.target.commitHash,
      filePath: newPath,
      source: props.target.source,
      fileList: props.target.fileList,
      fileIndex: newIndex,
    });
  };

  // ── Reset scroll when visible lines change (file nav or view mode toggle) ──
  createEffect(() => {
    const _lines = visibleLines();
    setScrollTop(0);
    scrollboxRef?.scrollTo(0);
  });

  // ── Keyboard navigation ────────────────────────────────────────────
  useKeyboard(e => {
    if (e.eventType === "release") return;

    switch (e.name) {
      case "up":
      case "k":
        e.preventDefault();
        scrollboxRef?.scrollBy(e.shift ? -10 : -1, "absolute");
        break;
      case "down":
      case "j":
        e.preventDefault();
        scrollboxRef?.scrollBy(e.shift ? 10 : 1, "absolute");
        break;
      case "left":
        e.preventDefault();
        navigateFile(-1);
        break;
      case "right":
        e.preventDefault();
        navigateFile(1);
        break;
      case "pageup":
        e.preventDefault();
        scrollboxRef?.scrollBy(-0.5, "viewport");
        break;
      case "pagedown":
      case " ":
        e.preventDefault();
        scrollboxRef?.scrollBy(0.5, "viewport");
        break;
      case "g":
        e.preventDefault();
        if (e.shift) {
          scrollboxRef?.scrollTo(Infinity);
        } else {
          scrollboxRef?.scrollTo(0);
        }
        break;
      case "b":
        e.preventDefault();
        if (!blameFetched) {
          fetchBlame();
        }
        setShowBlame(!showBlame());
        break;
      case "c":
        e.preventDefault();
        setViewMode(prev => {
          const idx = VIEW_MODE_CYCLE.indexOf(prev);
          return VIEW_MODE_CYCLE[(idx + 1) % VIEW_MODE_CYCLE.length];
        });
        break;
    }
  });

  // ── Line rendering helpers ─────────────────────────────────────────

  /** Get the foreground color for a diff line type. */
  const lineColor = (kind: DisplayLine["kind"]): string => {
    switch (kind) {
      case "add":
        return t().diffAdded;
      case "delete":
        return t().diffRemoved;
      case "hunk-header":
        return t().accent;
      case "context":
      case "spacer":
        return t().foreground;
    }
  };

  /** Get the prefix character for a diff line. */
  const linePrefix = (kind: DisplayLine["kind"]): string => {
    switch (kind) {
      case "add":
        return "+";
      case "delete":
        return "-";
      case "hunk-header":
      case "spacer":
        return "";
      case "context":
        return " ";
    }
  };

  /** Get the background color for a diff line row. */
  const lineBg = (kind: DisplayLine["kind"]): string | undefined => {
    switch (kind) {
      case "add":
        return t().diffAddedBg;
      case "delete":
        return t().diffRemovedBg;
      case "hunk-header":
      case "context":
      case "spacer":
        return undefined;
    }
  };

  const blameAnnotation = (line: DisplayLine): string => {
    if (!showBlame() || line.kind === "hunk-header") return "";
    const lineNo = line.newLineNo;
    if (lineNo === undefined) return " ".repeat(BLAME_COL_WIDTH);
    const bl = blameLookup().get(lineNo);
    if (!bl) return " ".repeat(BLAME_COL_WIDTH);
    const rawAuthor = bl.author.normalize("NFC");
    const author = rawAuthor.length > 12 ? `${rawAuthor.slice(0, 11)}\u2026` : rawAuthor;
    return `${bl.shortHash} ${author} `.padEnd(BLAME_COL_WIDTH);
  };

  // ── Title ──────────────────────────────────────────────────────────
  const title = createMemo(() => {
    const src = props.target.source;
    const label =
      src === "commit"
        ? props.target.commitHash.slice(0, 7)
        : src === "stash"
          ? `stash:${props.target.commitHash.slice(0, 7)}`
          : src;
    const pos =
      props.target.fileList.length > 1 ? `[${props.target.fileIndex + 1}/${props.target.fileList.length}]  ` : "";
    return `${pos}(${label})  ${props.target.filePath}`;
  });

  return (
    <DialogOverlay>
      <box
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title={title()} />

        {/* Loading state */}
        <Show when={loading()}>
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={t().foregroundMuted}>Loading diff...</text>
          </box>
        </Show>

        {/* Binary file */}
        <Show when={!loading() && diff()?.isBinary}>
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={t().foregroundMuted}>Binary file — cannot display diff</text>
          </box>
        </Show>

        {/* Empty diff */}
        <Show when={!loading() && !diff()?.isBinary && displayLines().length === 0}>
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={t().foregroundMuted}>No changes</text>
          </box>
        </Show>

        {/* Diff content */}
        <Show when={!loading() && !diff()?.isBinary && displayLines().length > 0}>
          <scrollbox
            ref={(el: ScrollBoxRenderable) => {
              scrollboxRef = el;
              attachScrollListener(el);
            }}
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
            scrollY
            scrollX={false}
            verticalScrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column" paddingX={4}>
              {/* Top spacer — maintains scroll position for offscreen lines above */}
              <box height={windowSlice().topRows} />

              <For each={windowedLines()}>
                {line => {
                  if (line.kind === "spacer") {
                    const ruleWidth = dialogWidth() - 10;
                    return (
                      <text wrapMode="none" fg={t().border}>
                        {"─".repeat(ruleWidth)}
                      </text>
                    );
                  }

                  const prefix = linePrefix(line.kind);

                  if (line.kind === "hunk-header") {
                    return (
                      <box flexDirection="row" width="100%">
                        <Show when={showBlame()}>
                          <box flexShrink={0} width={BLAME_COL_WIDTH} backgroundColor={t().backgroundElement}>
                            <text wrapMode="none" fg={t().foregroundMuted}>
                              {() => blameAnnotation(line)}
                            </text>
                          </box>
                        </Show>
                        <text wrapMode="none" fg={t().accent}>
                          <strong>{formatHunkHeader(line.content)}</strong>
                        </text>
                      </box>
                    );
                  }

                  return (
                    <box flexDirection="row" width="100%" backgroundColor={lineBg(line.kind)}>
                      {/* Blame annotation (conditional, fixed-width) */}
                      <Show when={showBlame()}>
                        <box flexShrink={0} width={BLAME_COL_WIDTH} backgroundColor={t().backgroundElement}>
                          <text wrapMode="none" fg={t().foregroundMuted}>
                            {() => blameAnnotation(line)}
                          </text>
                        </box>
                      </Show>
                      {/* Line numbers (old + new merged) */}
                      <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                        {() => buildGutter(line, gutterWidth(maxOldLineNo()), gutterWidth(maxNewLineNo()))}
                      </text>
                      {/* Prefix (+/-/space) */}
                      <text flexShrink={0} wrapMode="none" fg={lineColor(line.kind)}>
                        {`  ${prefix} `}
                      </text>
                      {/* Content */}
                      <text flexGrow={1} wrapMode="none" fg={lineColor(line.kind)}>
                        {line.content}
                      </text>
                    </box>
                  );
                }}
              </For>

              {/* Bottom spacer — maintains total content height for offscreen lines below */}
              <box height={windowSlice().bottomRows} />

              {/* Truncation message */}
              <Show when={isTruncated()}>
                <box flexDirection="row" width="100%" paddingY={1}>
                  <text wrapMode="none" fg={t().foregroundMuted}>
                    {`... diff truncated at ${MAX_DISPLAY_LINES} lines`}
                  </text>
                </box>
              </Show>
            </box>
          </scrollbox>
        </Show>

        {/* Footer with keybinds */}
        <DialogFooter>
          <Show when={blameLoading()}>
            <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {"loading blame...  "}
            </text>
          </Show>
          <Show when={hasMultipleFiles()}>
            <text flexShrink={0} wrapMode="none" fg={t().foreground}>
              {"\u2190/\u2192"}
            </text>
            <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
              {" file  "}
            </text>
          </Show>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            {"\u2191/\u2193"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" scroll  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            b
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {showBlame() ? " hide blame  " : " show blame  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            c
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {` ${VIEW_MODE_NEXT_LABEL[viewMode()]}  `}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            g/G
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" top/bottom"}
          </text>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
