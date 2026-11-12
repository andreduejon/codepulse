import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { type DashboardEvent, type DashboardRow, dashboardRows } from "./events";
import { type LoadOptions, loadAppEvents } from "./load";

export interface DashboardApp {
  path: string;
  name: string;
}

const HOUR = 3_600_000;
const DEFAULT_WINDOW_MS = 7 * 24 * HOUR;
const DEFAULT_KNOT_MS = HOUR;
const MAX_KNOT_ROWS = 5;

/** A selectable row's identity, so the cursor stays on its event when the rows are read again. */
export function dashboardRowKey(row: DashboardRow | undefined): string | null {
  if (row?.kind === "event") return `event:${row.event.id}`;
  if (row?.kind === "more") return `more:${row.knot}`;
  return null;
}

export interface DashboardState {
  /** Every app of the group, in rope order. */
  apps: Accessor<DashboardApp[]>;
  /** The apps shown: all of them, or the one chosen in the footer. */
  shownApps: Accessor<DashboardApp[]>;
  /** The chosen app's path, or null for all apps. */
  scope: Accessor<string | null>;
  setScope: (path: string | null) => void;
  /** All apps, then each app: ←/→ in the footer. */
  cycleScope: (direction: 1 | -1) => void;
  rows: Accessor<DashboardRow[]>;
  eventCount: Accessor<number>;
  /** The selected row's index in `rows`, -1 without any event. */
  cursor: Accessor<number>;
  select: (index: number) => void;
  move: (delta: number) => void;
  moveToEnd: (end: "first" | "last") => void;
  /** Enter: opens a knot's hidden rows, or returns the selected event for the caller to show. */
  activate: () => DashboardEvent | null;
  loading: Accessor<boolean>;
  reload: () => Promise<void>;
}

/**
 * The dashboard's data and cursor. It reads the apps' events when the dashboard is shown, again when the apps change
 * and on `reload`; it never reads while hidden.
 */
export function useDashboard(
  opts: Readonly<{
    apps: Accessor<DashboardApp[]>;
    active: Accessor<boolean>;
    now?: () => number;
    windowMs?: number;
    knotMs?: number;
    cacheRoot?: string;
    /** How one app's events are read (tests); from Git and the provider caches otherwise. */
    load?: (app: string, options: LoadOptions) => Promise<DashboardEvent[]>;
  }>,
): DashboardState {
  const [scope, setScope] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<DashboardEvent[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());

  const reload = async () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const apps = untrack(opts.apps);
    const since = (opts.now ?? Date.now)() - (opts.windowMs ?? DEFAULT_WINDOW_MS);
    setLoading(true);
    try {
      const loaded = await Promise.all(
        apps.map(app =>
          (opts.load ?? loadAppEvents)(app.path, { since, signal: current.signal, cacheRoot: opts.cacheRoot }),
        ),
      );
      if (current.signal.aborted) return;
      setEvents(loaded.flat());
    } finally {
      if (controller === current) setLoading(false);
    }
  };

  createEffect(() => {
    if (!opts.active()) return;
    opts.apps();
    void untrack(reload);
  });

  const shownApps = createMemo(() => {
    const apps = opts.apps();
    const chosen = scope();
    return chosen && apps.some(app => app.path === chosen) ? apps.filter(app => app.path === chosen) : apps;
  });
  const shownEvents = createMemo(() => {
    const shown = new Set(shownApps().map(app => app.path));
    return events().filter(event => shown.has(event.app));
  });
  const rows = createMemo(() =>
    dashboardRows(shownEvents(), {
      knotMs: opts.knotMs ?? DEFAULT_KNOT_MS,
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
  const cycleScope = (direction: 1 | -1) => {
    const choices = [null, ...opts.apps().map(app => app.path)];
    const at = Math.max(0, choices.indexOf(scope()));
    setScope(choices[(at + direction + choices.length) % choices.length] ?? null);
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
    apps: opts.apps,
    shownApps,
    scope,
    setScope,
    cycleScope,
    rows,
    eventCount: () => shownEvents().length,
    cursor,
    select,
    move,
    moveToEnd,
    activate,
    loading,
    reload,
  };
}
