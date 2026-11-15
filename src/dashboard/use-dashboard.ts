import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { onProviderCacheWrite } from "../providers/shared/sha-sqlite-cache";
import { type DashboardEvent, type DashboardRow, dashboardRows } from "./events";
import { type LoadOptions, loadAppEvents } from "./load";
import { DEFAULT_DASHBOARD_SETTINGS, type DashboardSettings } from "./settings";

export interface DashboardApp {
  path: string;
  name: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_KNOT_ROWS = 5;
/** How long the dashboard waits after a provider's write before reading again, so a fetch's writes read once. */
const RELOAD_DELAY_MS = 300;

/** A selectable row's identity, so the cursor stays on its event when the rows are read again. */
export function dashboardRowKey(row: DashboardRow | undefined): string | null {
  if (row?.kind === "event") return `event:${row.event.id}`;
  if (row?.kind === "more") return `more:${row.knot}`;
  return null;
}

export interface DashboardState {
  /** The open app. */
  app: Accessor<DashboardApp>;
  settings: Accessor<DashboardSettings>;
  rows: Accessor<DashboardRow[]>;
  eventCount: Accessor<number>;
  /** The selected row's index in `rows`, -1 without any event. */
  cursor: Accessor<number>;
  /** The event of the selected row, for the side panel; null on a knot's `more` row. */
  selected: Accessor<DashboardEvent | null>;
  select: (index: number) => void;
  move: (delta: number) => void;
  moveToEnd: (end: "first" | "last") => void;
  /** Enter: opens a knot's hidden rows, or returns the selected event for the caller to show. */
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
  }>,
): DashboardState {
  const settings = () => opts.settings?.() ?? DEFAULT_DASHBOARD_SETTINGS;
  /** Only a new window reads again: a new knot size lays out the same events. */
  const windowDays = createMemo(() => settings().windowDays);
  const [events, setEvents] = createSignal<DashboardEvent[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
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
      setEvents(loaded);
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
  // A new app starts with nothing open and the cursor on its newest event.
  createEffect(() => {
    opts.app();
    setExpanded(new Set<string>());
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

  const rows = createMemo(() =>
    dashboardRows(events(), {
      knotMs: settings().knotMinutes * 60_000,
      maxKnotRows: MAX_KNOT_ROWS,
      expanded: expanded(),
    }),
  );
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
  const activate = () => {
    const row = rows()[cursor()];
    if (row?.kind === "more") {
      // Its place goes to the first event it hid: the cursor stays where it was.
      const at = cursor();
      setExpanded(previous => new Set([...previous, row.knot]));
      select(at);
      return null;
    }
    return row?.kind === "event" ? row.event : null;
  };

  return {
    app: opts.app,
    settings,
    rows,
    eventCount: () => events().length,
    cursor,
    selected: () => {
      const row = rows()[cursor()];
      return row?.kind === "event" ? row.event : null;
    },
    select,
    move,
    moveToEnd,
    activate,
    loading,
    reload,
  };
}
