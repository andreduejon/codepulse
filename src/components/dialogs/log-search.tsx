import type { KeyEvent, Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createMemo, createSignal, type JSX, on, onCleanup, Show, untrack } from "solid-js";
import { useT } from "../../hooks/use-t";
import { hasScrollLayout, scheduleScrollIntoView, scrollElementIntoView } from "../../utils/scroll";

/**
 * Search inside a log or object viewer: `/` opens the search row, typing jumps to the first hit, Enter keeps the
 * query and returns to the keys, `n` / `N` move to the next / previous hit, Esc clears the search (a second Esc
 * then closes the dialog as usual). Hits are case-insensitive.
 */
/**
 * How many lines a text lost at its start: `after` begins where `before` continued (checked on a few lines). 0 when it
 * did not simply drop lines (another log, a refresh).
 */
export function linesDropped(before: readonly string[], after: readonly string[]): number {
  if (before.length === 0 || after.length === 0 || before[0] === after[0]) return 0;
  const probe = Math.min(3, after.length);
  for (let shift = 1; shift < before.length; shift++) {
    let same = true;
    for (let i = 0; i < probe && shift + i < before.length; i++) {
      if (before[shift + i] !== after[i]) {
        same = false;
        break;
      }
    }
    if (same) return shift;
  }
  return 0;
}

export function useLogSearch(opts: {
  texts: () => readonly string[];
  rowAt: (index: number) => Renderable | undefined;
  scrollbox: () => ScrollBoxRenderable | undefined;
  /**
   * Told when the search starts or stops owning Esc (editing, or a kept query). The app uses it to keep its own
   * Esc (which closes dialogs) away while the search is active.
   */
  onActiveChange?: (active: boolean) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [current, setCurrent] = createSignal<number | null>(null);
  const term = () => query().trim().toLowerCase();
  const matches = createMemo(() => {
    const needle = term();
    if (!needle) return [] as number[];
    const hits: number[] = [];
    opts.texts().forEach((text, index) => {
      if (text.toLowerCase().includes(needle)) hits.push(index);
    });
    return hits;
  });
  const scrollRef: { scrollTimer?: ReturnType<typeof setTimeout> } = {};
  const reveal = (index: number) => {
    setCurrent(index);
    scheduleScrollIntoView(scrollRef, () => {
      const scrollbox = opts.scrollbox();
      const row = opts.rowAt(index);
      return !!scrollbox && !!row && scrollElementIntoView(scrollbox, row, 1);
    });
  };
  const step = (direction: 1 | -1) => {
    const hits = matches();
    if (hits.length === 0) return;
    const at = hits.indexOf(current() ?? -1);
    const next = at < 0 ? (direction > 0 ? 0 : hits.length - 1) : (at + direction + hits.length) % hits.length;
    reveal(hits[next]);
  };
  createEffect(
    on(
      term,
      () => {
        const hits = matches();
        if (hits.length > 0) reveal(hits[0]);
        else setCurrent(null);
      },
      { defer: true },
    ),
  );
  // The text changed under a kept query (other job, view or refresh): keep the hit if it still matches, else
  // move to the first hit, so the position never points at a line that no longer matches. A followed log drops its
  // oldest lines as new ones arrive: the selected hit moves up with its line.
  let previousTexts: readonly string[] = untrack(opts.texts);
  createEffect(
    on(
      matches,
      hits => {
        const before = previousTexts;
        const now = untrack(opts.texts);
        previousTexts = now;
        if (!untrack(term)) return;
        const selected = untrack(current);
        const shift = linesDropped(before, now);
        if (
          shift > 0 &&
          selected !== null &&
          hits.includes(selected - shift) &&
          now[selected - shift] === before[selected]
        ) {
          setCurrent(selected - shift);
          return;
        }
        const at = untrack(current);
        if (at !== null && hits.includes(at)) return;
        // No current hit (or it stopped matching): take the first one as soon as one exists.
        if (hits.length > 0) reveal(hits[0]);
        else setCurrent(null);
      },
      { defer: true },
    ),
  );
  const clear = () => {
    setQuery("");
    setCurrent(null);
  };
  const active = createMemo(() => editing() || !!term());
  createEffect(on(active, value => opts.onActiveChange?.(value), { defer: true }));
  onCleanup(() => {
    if (active()) opts.onActiveChange?.(false);
  });
  /** Search keys first; returns true when the dialog must not handle the key itself. */
  const handleKey = (e: KeyEvent): boolean => {
    if (editing()) {
      if (e.name === "escape" || e.name === "return") {
        e.preventDefault();
        setEditing(false);
        if (e.name === "escape") clear();
      }
      // Everything else is typing for the search input.
      return true;
    }
    if (e.name === "/") {
      e.preventDefault();
      setEditing(true);
      return true;
    }
    if (e.name === "n" && term()) {
      e.preventDefault();
      step(e.shift ? -1 : 1);
      return true;
    }
    if (e.name === "escape" && term()) {
      e.preventDefault();
      clear();
      return true;
    }
    return false;
  };
  /** `3/12` while searching; `0/0` when nothing matches. */
  const position = () => {
    const hits = matches();
    if (!term()) return "";
    return `${hits.indexOf(current() ?? -1) + 1}/${hits.length}`;
  };
  return { query, setQuery, editing, setEditing, current, term, handleKey, position, step, clear };
}

export type LogSearch = ReturnType<typeof useLogSearch>;

/** Highlight every case-insensitive hit of `term` in `text`; the current hit's line uses the accent background. */
export function highlightHits(text: string, term: string, colors: { fg: string; bg: string }): JSX.Element {
  if (!term) return text;
  const lower = text.toLowerCase();
  const parts: JSX.Element[] = [];
  let from = 0;
  for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<span style={{ fg: colors.fg, bg: colors.bg }}>{text.slice(at, at + term.length)}</span>);
    from = at + term.length;
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/**
 * Width of the line number column: the largest number on screen, not the largest in the log, so the widest visible
 * number starts at the text inset. Numbers grow down the log, so the last visible row holds the widest one.
 *
 * Measured before each paint, from the layout of the frame before. After the scroll position, viewport height,
 * lines or `layoutKey` (wrap) change, two frames measure exactly (the first may still see the old layout). Then
 * the width may only grow: a wider column wraps long lines taller, which can push the widest number out of view,
 * and shrinking again would flip between two widths.
 */
export function useVisibleNumberWidth(opts: {
  scrollbox: () => ScrollBoxRenderable | undefined;
  rowAt: (index: number) => Renderable | undefined;
  lines: () => readonly unknown[];
  numberAt: (index: number) => number;
  layoutKey?: () => unknown;
}): () => number {
  const renderer = useRenderer();
  const digits = (index: number) => String(opts.numberAt(index)).length;
  const total = () => (opts.lines().length === 0 ? 1 : digits(opts.lines().length - 1));
  const [measured, setMeasured] = createSignal<number | null>(null);
  const last: {
    scrollTop: number;
    viewport: number;
    lines: readonly unknown[] | null;
    layout: unknown;
    retried: readonly unknown[] | null;
    exactFrames: number;
  } = { scrollTop: -1, viewport: -1, lines: null, layout: undefined, retried: null, exactFrames: 0 };
  const measure = async () => {
    const scrollbox = opts.scrollbox();
    const lines = untrack(opts.lines);
    if (!scrollbox || lines.length === 0) return;
    const origin = scrollbox.content.screenY;
    const bottom = scrollbox.scrollTop + scrollbox.viewport.height;
    let low = 0;
    let high = lines.length - 1;
    let lastVisible = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const row = opts.rowAt(mid);
      if (!hasScrollLayout(row)) {
        // New rows get their layout in this frame's paint: measure once more in the next frame.
        if (last.retried !== lines) {
          last.retried = lines;
          renderer.requestRender();
        }
        return;
      }
      if ((row as Renderable).screenY - origin < bottom) {
        lastVisible = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    const width = digits(lastVisible);
    const layout = untrack(() => opts.layoutKey?.());
    const same =
      last.scrollTop === scrollbox.scrollTop &&
      last.viewport === scrollbox.viewport.height &&
      last.lines === lines &&
      last.layout === layout;
    last.scrollTop = scrollbox.scrollTop;
    last.viewport = scrollbox.viewport.height;
    last.lines = lines;
    last.layout = layout;
    if (!same) {
      last.exactFrames = 2;
      renderer.requestRender();
    }
    const exact = last.exactFrames > 0;
    if (exact) last.exactFrames--;
    setMeasured(previous => (exact || previous === null ? width : Math.max(previous, width)));
  };
  renderer.setFrameCallback(measure);
  onCleanup(() => renderer.removeFrameCallback(measure));
  return () => Math.min(measured() ?? total(), total());
}

/**
 * A log line's number column (the padded number plus two spaces). The current hit's number is inverted in the hit
 * color across the whole column width, so its line stands out from the other hits.
 */
export function LineNumber(props: Readonly<{ text: string; current: boolean }>) {
  const t = useT();
  return (
    <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
      {props.current
        ? [<span style={{ fg: t().background, bg: t().accent }}>{props.text}</span>, "  "]
        : `${props.text}  `}
    </text>
  );
}

/**
 * The `/` search bar above the dialog footer, while searching or while a query is kept. An empty row separates it
 * from the text like the one before the footer; the text gives up both rows, so the dialog keeps its height. While
 * typing, the slash, the input and the hit count share the input background, inside the text inset.
 */
export function LogSearchRow(props: Readonly<{ search: LogSearch; placeholder: string }>) {
  const t = useT();
  const background = () => (props.search.editing() ? t().backgroundElement : t().background);
  return (
    <Show when={props.search.editing() || props.search.term()}>
      <box height={1} flexShrink={0} />
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0} height={1}>
        <box flexDirection="row" flexGrow={1} height={1} backgroundColor={background()}>
          <text flexShrink={0} wrapMode="none" fg={t().accent}>
            {"/ "}
          </text>
          <input
            focused={props.search.editing()}
            flexGrow={1}
            flexShrink={1}
            value={props.search.query()}
            onInput={value => props.search.setQuery(value)}
            placeholder={props.placeholder}
            textColor={t().foreground}
            focusedTextColor={t().foreground}
            placeholderColor={t().foregroundMuted}
            cursorColor={t().accent}
            backgroundColor={background()}
            focusedBackgroundColor={background()}
          />
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {` ${props.search.position()}`}
          </text>
        </box>
      </box>
    </Show>
  );
}
