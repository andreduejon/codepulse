import type { KeyEvent, Renderable, ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, type JSX, on, onCleanup, Show, untrack } from "solid-js";
import { useT } from "../../hooks/use-t";
import { scheduleScrollIntoView, scrollElementIntoView } from "../../utils/scroll";

/**
 * Search inside a log or object viewer: `/` opens the search row, typing jumps to the first hit, Enter keeps the
 * query and returns to the keys, `n` / `N` move to the next / previous hit, Esc clears the search (a second Esc
 * then closes the dialog as usual). Hits are case-insensitive.
 */
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
  // move to the first hit, so the position never points at a line that no longer matches.
  createEffect(
    on(
      matches,
      hits => {
        if (!untrack(term)) return;
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

/** The `/` search row shown above the dialog footer while searching or while a query is kept. */
export function LogSearchRow(props: Readonly<{ search: LogSearch; placeholder: string }>) {
  const t = useT();
  return (
    <Show when={props.search.editing() || props.search.term()}>
      <box flexDirection="row" width="100%" paddingX={4} flexShrink={0} height={1}>
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
          backgroundColor={t().background}
          focusedBackgroundColor={t().backgroundElement}
        />
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {` ${props.search.position()}`}
        </text>
      </box>
    </Show>
  );
}
