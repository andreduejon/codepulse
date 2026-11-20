/**
 * LogViewer: what the CI log and the OpenShift resource dialogs share. A full-size dialog with a title, numbered lines
 * (or a status mark in the number column), `/` search with sideways reveal, loading, empty and error states, scroll
 * keys, wrap, and the footer in one order: `← … · → … · / search · c view · w wrap · r refresh · o open`.
 *
 * The dialogs keep only what is their own: what the lines are, their views (`c`), refresh (`r`), the page `o` opens,
 * and the entries ←/→ move between.
 */

import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import type { StatusCategory } from "../../../core/status";
import { useScrollWindow } from "../../hooks/use-scroll-window";
import { useT } from "../../hooks/use-t";
import { useModalKeys } from "../../keyboard/dispatcher";
import { statusColor } from "../../providers/shared/status";
import { statusIcon } from "../../utils/status-icon";
import { cellWidth } from "../../utils/terminal-text";
import { fitHints, KeyHint, KeyHintSeparator, type RankedHint } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitle, DialogTitleBar, getStandardDialogFrame } from "./dialog-chrome";
import {
  highlightHits,
  LineNumber,
  LogSearchRow,
  lastVisibleRow,
  useLogSearch,
  useSidewaysReveal,
  useVisibleNumberWidth,
} from "./log-search";
import { handleLogScrollKey, type LogViewState, LogViewStatus } from "./log-view";
import { fitTitleSegments, type TitleSegmentInput } from "./title-utils";

export interface LogViewerLine {
  text: string;
  /** Its number in the gutter; 0 shows none (a summary line). */
  lineNo: number;
  /** `group`: a bold heading with `▸`; `error`: error colour on a red row; `warning`; `muted`; plain otherwise. */
  kind?: "group" | "error" | "warning" | "muted" | "normal";
  /** A status mark in the number column instead of a number, right-aligned (a summary row). */
  mark?: StatusCategory;
}

/** The keys a dialog offers besides search and wrap; each shows its hint while set. */
export interface LogViewerActions {
  /** `c`: the next view. */
  view?: () => void;
  /** `r`: read what is on screen again. */
  refresh?: () => void;
  /** `o`: open its page in the browser. */
  open?: () => void;
}

/** ←/→ between entries (jobs, stages, failed tests): where each arrow goes, or null to leave it out. */
export interface LogViewerNavigation {
  previous: string | null;
  next: string | null;
  go: (direction: -1 | 1) => void;
}

interface LogViewerProps {
  /** Title segments, fitted to the dialog's width (context drops first, the primary segment shrinks last). */
  title: () => TitleSegmentInput[];
  lines: () => LogViewerLine[];
  /** Loading, failed or empty: shown instead of the lines. */
  state: () => LogViewState | null;
  searchPlaceholder: () => string;
  actions?: () => LogViewerActions;
  navigation?: () => LogViewerNavigation | null;
  /** Keep the view at the bottom as lines arrive (a followed log). */
  stickToBottom?: () => boolean;
  /**
   * Where a new entry or view starts, read each time `scrollKey` changes: the top, the bottom (a log), or where it
   * is (null).
   */
  scrollKey?: () => unknown;
  scrollStart?: () => "top" | "bottom" | null;
  onClose: () => void;
  /** Searched once mounted, so the first hit shows when the lines arrive. */
  initialSearch?: string;
}

export function LogViewer(props: Readonly<LogViewerProps>) {
  const t = useT();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const frame = createMemo(() => getStandardDialogFrame(dimensions()));
  const [wrapEnabled, setWrapEnabled] = createSignal(false);
  const actions = () => props.actions?.() ?? {};
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const texts = () => props.lines().map(line => line.text);
  /** The mounted lines' elements by index, for the last one on the screen while wrapped. */
  const lineRefs: (Renderable | undefined)[] = [];
  // Before the window: its heights need the text's width, which needs the numbers' (rule 1 in agents.md).
  const [textWidth, setTextWidth] = createSignal(1);
  /**
   * Only the lines near the screen are mounted, the others are empty space. Unwrapped every line is one row; wrapped
   * (by character) one takes as many rows as its width needs, so its height is known before it mounts.
   */
  const lineWindow = useScrollWindow({
    heights: () => {
      if (!wrapEnabled()) return props.lines().map(() => 1);
      const width = Math.max(1, textWidth());
      return props
        .lines()
        .map(line => Math.max(1, Math.ceil(cellWidth(line.kind === "group" ? `▸ ${line.text}` : line.text) / width)));
    },
    screenHeight: () => dimensions().height,
  });
  const shownLines = createMemo(() => {
    const { start, end } = lineWindow.range();
    return props.lines().slice(start, end);
  });
  const numberWidth = useVisibleNumberWidth({
    scrollbox: () => scrollboxRef,
    lastVisible: (scrollbox, count) => {
      if (!wrapEnabled()) return Math.max(0, Math.min(count - 1, scrollbox.scrollTop + scrollbox.viewport.height - 1));
      // Among the mounted lines: the screen is inside them.
      const { start, end } = untrack(lineWindow.range);
      const last = lastVisibleRow(scrollbox, Math.min(end, count) - start, index => lineRefs[start + index]);
      return last === null ? null : start + last;
    },
    lines: props.lines,
    numberAt: index => props.lines()[index]?.lineNo ?? 0,
    layoutKey: wrapEnabled,
  });
  const search = useLogSearch({
    texts,
    scrollToLine: index => lineWindow.scrollIntoView(index),
  });
  // Inner width: the dialog's frame (1) and padding (4) on both sides, then the line numbers and their gap.
  createEffect(() => setTextWidth(frame().width - 10 - (numberWidth() + 2)));
  const reveal = useSidewaysReveal({ search, texts, wrap: wrapEnabled, width: textWidth });
  // After mount, so the app hears that the search owns Esc (the first hit shows once the lines have loaded).
  onMount(() => {
    if (props.initialSearch) search.setQuery(props.initialSearch);
  });

  createEffect(() => {
    props.scrollKey?.();
    const start = untrack(() => props.scrollStart?.() ?? "top");
    if (start === "top") scrollboxRef?.scrollTo(0);
    else if (start === "bottom")
      queueMicrotask(() => {
        // Closed in the meantime: its scrollbox is gone.
        if (scrollboxRef && !scrollboxRef.isDestroyed) scrollboxRef.scrollTo(Number.POSITIVE_INFINITY);
      });
  });

  const toggleWrap = () => setWrapEnabled(value => !value);

  /**
   * The footer's hints, fitted to the dialog: the arrows and search stay longest, wrap goes first. Inside the frame's
   * padding (1) and the footer's (4) on both sides.
   */
  const footerHints = () => {
    const navigation = props.navigation?.();
    const { view, refresh, open } = actions();
    const hints: (RankedHint & { onClick: () => void })[] = [];
    if (navigation?.previous)
      hints.push({ key: "←", desc: ` ${navigation.previous}`, rank: 1, onClick: () => navigation.go(-1) });
    if (navigation?.next)
      hints.push({ key: "→", desc: ` ${navigation.next}`, rank: 1, onClick: () => navigation.go(1) });
    if (search.term()) hints.push({ key: "n/N", desc: " next/previous", rank: 2, onClick: () => search.step(1) });
    else hints.push({ key: "/", desc: " search", rank: 2, onClick: () => search.setEditing(true) });
    if (view) hints.push({ key: "c", desc: " view", rank: 3, onClick: view });
    hints.push({ key: "w", desc: wrapEnabled() ? " nowrap" : " wrap", rank: 6, onClick: toggleWrap });
    if (refresh) hints.push({ key: "r", desc: " refresh", rank: 5, onClick: refresh });
    if (open) hints.push({ key: "o", desc: " open", rank: 4, onClick: open });
    return fitHints(hints, frame().width - 10);
  };
  const titleElement = createMemo(() => <DialogTitle segments={fitTitleSegments(props.title(), frame().width)} />);

  // A key that closes the viewer (the app's Esc) doesn't reach this handler: the dispatcher skips a removed one.
  useModalKeys(e => {
    if (e.eventType === "release") return;
    if (search.handleKey(e)) return;
    if (handleLogScrollKey(e, scrollboxRef, frame().height - 6)) {
      e.preventDefault();
      return;
    }
    const navigation = props.navigation?.();
    const run = (action: (() => void) | undefined) => {
      if (!action) return;
      e.preventDefault();
      action();
    };
    switch (e.name) {
      case "q":
        e.preventDefault();
        renderer.destroy();
        break;
      case "escape":
        e.preventDefault();
        props.onClose();
        break;
      case "w":
        e.preventDefault();
        toggleWrap();
        break;
      case "c":
        run(actions().view);
        break;
      case "r":
        run(actions().refresh);
        break;
      case "o":
        run(actions().open);
        break;
      case "left":
      case "h":
        if (!navigation) break;
        e.preventDefault();
        if (navigation.previous) navigation.go(-1);
        break;
      case "right":
      case "l":
        if (!navigation) break;
        e.preventDefault();
        if (navigation.next) navigation.go(1);
        break;
    }
  });

  const renderLine = (line: LogViewerLine, index: () => number) => {
    const th = t();
    const lineNo = () => (line.lineNo > 0 ? String(line.lineNo) : "").padStart(numberWidth());
    const wrapMode = () => (wrapEnabled() ? "char" : "none");
    const text = (value: string) => highlightHits(reveal(value), search.term(), { fg: th.background, bg: th.accent });
    const isCurrentHit = () => search.current() === index();
    let mounted: Renderable | undefined;
    /** Where this line put its element: read no signal while it is cleaned up. */
    let at = -1;
    const ref = (element: Renderable) => {
      mounted = element;
      at = index();
      lineRefs[at] = element;
    };
    onCleanup(() => {
      if (at >= 0 && lineRefs[at] === mounted) lineRefs[at] = undefined;
    });
    const kind = line.kind ?? "normal";
    if (kind === "group") {
      return (
        <box ref={ref} flexDirection="row" width="100%">
          <LineNumber text={lineNo()} current={isCurrentHit()} />
          <text wrapMode={wrapMode()} fg={th.accent}>
            <strong>
              {"▸ "}
              {text(line.text)}
            </strong>
          </text>
        </box>
      );
    }
    const fg =
      kind === "error"
        ? th.error
        : kind === "warning"
          ? th.warning
          : kind === "muted"
            ? th.foregroundMuted
            : th.foreground;
    return (
      <box ref={ref} flexDirection="row" width="100%" backgroundColor={kind === "error" ? th.diffRemovedBg : undefined}>
        {/* A summary row's mark takes its line number's place, right-aligned, so the text starts with the lines'. */}
        <Show
          when={!isCurrentHit() && line.mark}
          fallback={
            <LineNumber
              text={line.mark ? statusIcon(line.mark).padStart(numberWidth()) : lineNo()}
              current={isCurrentHit()}
            />
          }
        >
          {mark => (
            <text flexShrink={0} wrapMode="none" fg={statusColor(th, mark())}>
              {`${statusIcon(mark()).padStart(numberWidth())}  `}
            </text>
          )}
        </Show>
        <text wrapMode={wrapMode()} fg={fg}>
          {text(line.text)}
        </text>
      </box>
    );
  };

  return (
    <DialogOverlay align="top" topOffset={2}>
      <box
        width={frame().width}
        height={frame().height}
        backgroundColor={t().background}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title={titleElement()} onClose={props.onClose} />
        <scrollbox
          ref={element => {
            scrollboxRef = element;
            lineWindow.attach(element);
          }}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          stickyScroll={props.stickToBottom?.() ?? false}
          stickyStart={props.stickToBottom?.() ? "bottom" : undefined}
          verticalScrollbarOptions={{ visible: false }}
        >
          {/* 1+4 from the dialog's border, as its title: an error box too, its own border in the title's column. */}
          <box flexDirection="column" width="100%" paddingX={4}>
            <Show
              when={props.state()}
              fallback={
                <>
                  <box height={lineWindow.before()} flexShrink={0} />
                  <For each={shownLines()}>
                    {(line, shownIndex) => renderLine(line, () => lineWindow.range().start + shownIndex())}
                  </For>
                  <box height={lineWindow.after()} flexShrink={0} />
                </>
              }
            >
              {state => <LogViewStatus state={state()} />}
            </Show>
          </box>
        </scrollbox>
        <LogSearchRow search={search} placeholder={props.searchPlaceholder()} />
        <DialogFooter>
          <For each={footerHints()}>
            {(hint, index) => (
              <>
                <Show when={index() > 0}>
                  <KeyHintSeparator />
                </Show>
                <KeyHint key={hint.key} desc={hint.desc} onClick={hint.onClick} />
              </>
            )}
          </For>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
