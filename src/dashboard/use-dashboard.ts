import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { EventSource } from "../providers/provider";
import { onProviderCacheWrite } from "../providers/shared/sha-sqlite-cache";
import { type DashboardEvent, type DashboardRow, dashboardRows } from "./events";
import { type LoadOptions, loadAppEvents } from "./load";
import { type DashboardSettings, DEFAULT_DASHBOARD_SETTINGS } from "./settings";

export interface DashboardApp {
  path: string;
  name: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How long the dashboard waits after a provider's write before reading again, so a fetch's writes read once. */
const RELOAD_DELAY_MS = 300;

/** A selectable row's identity, so the cursor stays on its event when the rows are read again. */
export function dashboardRowKey(row: DashboardRow | undefined): string | null {
  return row?.kind === "event" ? `event:${row.event.id}` : null;
}

export interface DashboardState {
  /** The open app. */
  app: Accessor<DashboardApp>;
  settings: Accessor<DashboardSettings>;
  rows: Accessor<DashboardRow[]>;
  /** The events shown: all but the hidden providers'. */
  eventCount: Accessor<number>;
  /** Every event read, shown or not. */
  totalCount: Accessor<number>;
  /** The providers whose events are left out, from their badges. */
  hidden: Accessor<ReadonlySet<EventSource>>;
  /** A provider badge's click: hides its events, or shows them again. */
  toggleSource: (source: EventSource) => void;
  /** The selected row's index in `rows`, -1 without any event. */
  cursor: Accessor<number>;
  /** The event of the selected row, for the side panel. */
  selected: Accessor<DashboardEvent | null>;
  select: (index: number) => void;
  move: (delta: number) => void;
  moveToEnd: (end: "first" | "last") => void;
  /** Enter: the selected event, for the caller to show. */
  activate: () => DashboardEvent | null;
  loading: Accessor<boolean>;
  reload: () => Promise<void>;
}

/**
 * The open app's dashboard: its data and cursor. It reads the app's events when the dashboard is shown, again when
 * the app or the settings change, when its providers write to their caches or its graph is read again, and on
 * `reload`. It never reads while hidden. Nothing is fetched: the app's provider views fill the caches.
 */
export function useDashboard(
  opts: Readonly<{
    app: Accessor<DashboardApp>;
    active: Accessor<boolean>;
    settings?: Accessor<DashboardSettings>;
    /** Read again when this changes while shown: the graph's commits, after a refresh or a fetch. */
    changes?: Accessor<unknown>;
    now?: () => number;
    cacheRoot?: string;
    /** How the app's events are read (tests); from Git and the provider caches otherwise. */
    load?: (app: string, options: LoadOptions) => Promise<DashboardEvent[]>;
    /**
     * The open app's events its providers hold now: their caches keep only what ended, so a running build comes from
     * here. A read event with the same id wins (it ended); one without a branch takes its commit's from a read event.
     */
    live?: Accessor<DashboardEvent[]>;
  }>,
): DashboardState {
  const settings = () => opts.settings?.() ?? DEFAULT_DASHBOARD_SETTINGS;
  /** Only a new window reads again: a new knot size lays out the same events. */
  const windowDays = createMemo(() => settings().windowDays);
  /** The events read, with the app they were read for: another app shows none of them while its own load. */
  const [loaded, setLoaded] = createSignal<{ app: string; events: DashboardEvent[] }>({ app: "", events: [] });
  const events = () => {
    const read = loaded();
    return read.app === opts.app().path ? read.events : [];
  };
  const [loading, setLoading] = createSignal(false);
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [hidden, setHidden] = createSignal<ReadonlySet<EventSource>>(new Set());
  let controller: AbortController | undefined;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    controller?.abort();
    if (reloadTimer) clearTimeout(reloadTimer);
  });

  const reload = async () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const app = untrack(opts.app);
    const since = (opts.now ?? Date.now)() - untrack(windowDays) * DAY;
    setLoading(true);
    try {
      const loaded = await (opts.load ?? loadAppEvents)(app.path, {
        since,
        signal: current.signal,
        cacheRoot: opts.cacheRoot,
      });
      if (current.signal.aborted) return;
      setLoaded({ app: app.path, events: loaded });
    } finally {
      if (controller === current) setLoading(false);
    }
  };
  /** Many writes in a row (one per commit of a fetch) read once, after the last. */
  const reloadSoon = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      if (untrack(opts.active)) void reload();
    }, RELOAD_DELAY_MS);
  };

  createEffect(() => {
    if (!opts.active()) return;
    opts.app();
    windowDays();
    void untrack(reload);
  });
  // A new app starts with the cursor on its newest event.
  createEffect(() => {
    opts.app();
    setSelectedKey(null);
  });
  createEffect(() => {
    if (!opts.active()) return;
    let first = true;
    createEffect(() => {
      opts.changes?.();
      if (first) first = false;
      else reloadSoon();
    });
    onCleanup(onProviderCacheWrite(reloadSoon));
  });

  const all = createMemo(() => {
    const read = events();
    const held = opts.live?.() ?? [];
    if (held.length === 0) return read;
    const since = (opts.now ?? Date.now)() - windowDays() * DAY;
    const ids = new Set(read.map(event => event.id));
    const branches = new Map(read.flatMap(event => (event.branch ? [[event.sha, event.branch] as const] : [])));
    const added = held.flatMap(event => {
      if (ids.has(event.id) || event.time < since) return [];
      const branch = event.branch ?? branches.get(event.sha);
      return [branch ? { ...event, branch } : event];
    });
    return added.length === 0 ? read : [...read, ...added].sort((a, b) => b.time - a.time);
  });
  const shown = createMemo(() => {
    const left = hidden();
    return left.size === 0 ? all() : all().filter(event => !left.has(event.source));
  });
  const rows = createMemo(() =>
    dashboardRows(shown(), {
      knotMs: settings().knotMinutes * 60_000,
    }),
  );
  const toggleSource = (source: EventSource) =>
    setHidden(current => {
      const next = new Set(current);
      if (!next.delete(source)) next.add(source);
      return next;
    });
  const selectable = createMemo(() => rows().flatMap((row, index) => (dashboardRowKey(row) === null ? [] : [index])));
  /** The selected row: the one with the selected key, else the first event. */
  const cursor = createMemo(() => {
    const key = selectedKey();
    const index = key === null ? -1 : rows().findIndex(row => dashboardRowKey(row) === key);
    return index >= 0 ? index : (selectable()[0] ?? -1);
  });

  const select = (index: number) => {
    const key = dashboardRowKey(rows()[index]);
    if (key !== null) setSelectedKey(key);
  };
  const move = (delta: number) => {
    const stops = selectable();
    if (stops.length === 0) return;
    const at = stops.indexOf(cursor());
    select(stops[Math.max(0, Math.min(stops.length - 1, at + delta))] ?? -1);
  };
  const moveToEnd = (end: "first" | "last") => {
    const stops = selectable();
    select((end === "first" ? stops[0] : stops.at(-1)) ?? -1);
  };
  const selected = () => {
    const row = rows()[cursor()];
    return row?.kind === "event" ? row.event : null;
  };

  return {
    app: opts.app,
    settings,
    rows,
    eventCount: () => shown().length,
    totalCount: () => all().length,
    hidden,
    toggleSource,
    cursor,
    selected,
    select,
    move,
    moveToEnd,
    activate: selected,
    loading,
    reload,
  };
}
