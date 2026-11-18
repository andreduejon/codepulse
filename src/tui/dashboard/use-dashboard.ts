import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { type DashboardEvent, type DashboardRow, dashboardRows, keepUnchangedRows } from "../../core/dashboard/events";
import type { ReadOptions } from "../../core/dashboard/load";
import { type DashboardSettings, DEFAULT_DASHBOARD_SETTINGS } from "../../core/dashboard-settings";
import type { EventSource } from "../../core/provider-model";
import { RECENT_APPS } from "../constants";
import { rememberRecent } from "../utils/recent";

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
  /** Reading the app's events for the first time: nothing to show yet. Re-reads don't count. */
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
    /** How the app's events are read (tests); from Git and the provider caches otherwise. */
    load: (app: string, options: ReadOptions) => Promise<DashboardEvent[]>;
    /** Calls back after each provider write to the caches; returns the function that stops it. */
    onCacheWrite?: (listener: (repoPath: string) => void) => () => void;
    /**
     * The open app's events its providers hold now: their caches keep only what ended, so a running build comes from
     * here. With the same id, the newer wins; one without a branch takes its commit's from a read event.
     */
    live?: Accessor<DashboardEvent[]>;
    /** The providers turned on: a turned-off one's cached events stay out, so nothing offers to ask it. All without. */
    shownSources?: Accessor<ReadonlySet<EventSource>>;
  }>,
): DashboardState {
  const settings = () => opts.settings?.() ?? DEFAULT_DASHBOARD_SETTINGS;
  /** Only a new window reads again: a new knot size lays out the same events. */
  const windowDays = createMemo(() => settings().windowDays);
  /**
   * The events read, per app: another app shows none of them while its own load, and an app read before shows its
   * last ones at once while they are read again.
   */
  const [loaded, setLoaded] = createSignal<ReadonlyMap<string, DashboardEvent[]>>(new Map());
  const events = () => loaded().get(opts.app().path) ?? [];
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
      const loaded = await opts.load(app.path, {
        since,
        signal: current.signal,
      });
      if (current.signal.aborted) return;
      // The last few apps read keep their events, so coming back shows them at once; older ones read again.
      setLoaded(current => rememberRecent(current, app.path, loaded, RECENT_APPS));
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
    const stop = opts.onCacheWrite?.(reloadSoon);
    if (stop) onCleanup(stop);
  });

  /** The events read, without those of providers turned off. */
  const readOn = createMemo(() => {
    const read = events();
    const on = opts.shownSources?.();
    return !on || read.every(event => on.has(event.source)) ? read : read.filter(event => on.has(event.source));
  });
  const all = createMemo(() => {
    const read = readOn();
    const on = opts.shownSources?.();
    const held = (opts.live?.() ?? []).filter(event => !on || on.has(event.source));
    if (held.length === 0) return read;
    const since = (opts.now ?? Date.now)() - windowDays() * DAY;
    const byId = new Map(read.map(event => [event.id, event] as const));
    const branches = new Map(read.flatMap(event => (event.branch ? [[event.sha, event.branch] as const] : [])));
    let changed = false;
    for (const event of held) {
      if (event.time < since) continue;
      // The newer wins: a run going again under its id (a GitHub re-run) over its cached end, a cached end over a
      // provider's older copy.
      const known = byId.get(event.id);
      if (known && known.time >= event.time) continue;
      const branch = event.branch ?? known?.branch ?? branches.get(event.sha);
      byId.set(event.id, branch ? { ...event, branch } : event);
      changed = true;
    }
    return changed ? [...byId.values()].sort((a, b) => b.time - a.time) : read;
  });
  const shown = createMemo(() => {
    const left = hidden();
    return left.size === 0 ? all() : all().filter(event => !left.has(event.source));
  });
  // A row read again unchanged stays the same row, so the view keeps it mounted.
  const rows = createMemo<DashboardRow[]>(
    previous => keepUnchangedRows(previous, dashboardRows(shown(), { knotMs: settings().knotMinutes * 60_000 })),
    [],
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
    // Only the first read of an app shows as reading: a re-read (a provider wrote, r, the graph changed, back from
    // another app) keeps the events on screen, so it needs no label and doesn't make the footer blink.
    loading: () => loading() && !loaded().has(opts.app().path),
    reload,
  };
}
