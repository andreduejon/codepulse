/**
 * LogViewer: what the CI log and the OpenShift resource dialogs share. A full-size dialog with a title, numbered lines
 * (or a status mark in the number column), `/` search with sideways reveal, loading, empty and error states, scroll
 * keys, wrap, and the footer in one order: `← … · → … · / search · c view · w wrap · r refresh · o open`.
 *
 * The dialogs keep only what is their own: what the lines are, their views (`c`), refresh (`r`), the page `o` opens,
 * and the entries ←/→ move between.
 */

import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onMount, Show, untrack } from "solid-js";
import { useT } from "../../hooks/use-t";
import { type StatusCategory, statusColor, statusIcon } from "../../providers/shared/status";
import { KeyHint, KeyHintSeparator } from "../key-hint";
import { DialogFooter, DialogOverlay, DialogTitle, DialogTitleBar, getStandardDialogFrame } from "./dialog-chrome";
import {
  highlightHits,
  LineNumber,
  LogSearchRow,
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
  /** The search row starts or stops owning Esc (see `useLogSearch`). */
  onSearchActive?: (active: boolean) => void;
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
  const lineRefs: Renderable[] = [];
  const numberWidth = useVisibleNumberWidth({
    scrollbox: () => scrollboxRef,
    rowAt: index => lineRefs[index],
    lines: props.lines,
    numberAt: index => props.lines()[index]?.lineNo ?? 0,
    layoutKey: wrapEnabled,
  });
  const search = useLogSearch({
    texts,
    rowAt: index => lineRefs[index],
    scrollbox: () => scrollboxRef,
    onActiveChange: active => props.onSearchActive?.(active),
  });
  // Inner width: the dialog's frame (1) and padding (4) on both sides, then the line numbers and their gap.
  const reveal = useSidewaysReveal({
    search,
    texts,
    wrap: wrapEnabled,
    width: () => frame().width - 10 - (numberWidth() + 2),
  });
  // After mount, so the app hears that the search owns Esc (the first hit shows once the lines have loaded).
  onMount(() => {
    if (props.initialSearch) search.setQuery(props.initialSearch);
  });

  createEffect(() => {
    props.scrollKey?.();
    const start = untrack(() => props.scrollStart?.() ?? "top");
    if (start === "top") scrollboxRef?.scrollTo(0);
    else if (start === "bottom") queueMicrotask(() => scrollboxRef?.scrollTo(Number.POSITIVE_INFINITY));
  });

  const toggleWrap = () => setWrapEnabled(value => !value);
  const titleElement = createMemo(() => <DialogTitle segments={fitTitleSegments(props.title(), frame().width)} />);

  useKeyboard(e => {
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
    const wrapMode = () => (wrapEnabled() ? "word" : "none");
    const text = (value: string) => highlightHits(reveal(value), search.term(), { fg: th.background, bg: th.accent });
    const isCurrentHit = () => search.current() === index();
    const ref = (element: Renderable) => {
      lineRefs[index()] = element;
    };
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
          ref={scrollboxRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          scrollY
          scrollX={false}
          stickyScroll={props.stickToBottom?.() ?? false}
          stickyStart={props.stickToBottom?.() ? "bottom" : undefined}
          verticalScrollbarOptions={{ visible: false }}
        >
          {/* An error box brings its own frame and inset, so it skips the text inset (like the diff dialog). */}
          <box flexDirection="column" width="100%" paddingX={props.state()?.kind === "error" ? 0 : 4}>
            <Show
              when={props.state()}
              fallback={<For each={props.lines()}>{(line, index) => renderLine(line, index)}</For>}
            >
              {state => <LogViewStatus state={state()} />}
            </Show>
          </box>
        </scrollbox>
        <LogSearchRow search={search} placeholder={props.searchPlaceholder()} />
        <DialogFooter>
          <Show when={props.navigation?.()?.previous}>
            {label => (
              <>
                <KeyHint key="←" desc={` ${label()}`} onClick={() => props.navigation?.()?.go(-1)} />
                <KeyHintSeparator />
              </>
            )}
          </Show>
          <Show when={props.navigation?.()?.next}>
            {label => (
              <>
                <KeyHint key="→" desc={` ${label()}`} onClick={() => props.navigation?.()?.go(1)} />
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
          <Show when={actions().view}>
            {view => (
              <>
                <KeyHintSeparator />
                <KeyHint key="c" desc=" view" onClick={() => view()()} />
              </>
            )}
          </Show>
          <KeyHintSeparator />
          <KeyHint key="w" desc={wrapEnabled() ? " nowrap" : " wrap"} onClick={toggleWrap} />
          <Show when={actions().refresh}>
            {refresh => (
              <>
                <KeyHintSeparator />
                <KeyHint key="r" desc=" refresh" onClick={() => refresh()()} />
              </>
            )}
          </Show>
          <Show when={actions().open}>
            {open => (
              <>
                <KeyHintSeparator />
                <KeyHint key="o" desc=" open" onClick={() => open()()} />
              </>
            )}
          </Show>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}
