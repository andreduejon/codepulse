import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { addDebugEvent } from "../debug/events";
import type { CacheSyncResult } from "../providers/shared/cache-sync";
import { type DashboardEvent, type DashboardRow, dashboardRows } from "./events";
import { type LoadOptions, loadAppEvents } from "./load";
import { type SyncTarget, syncTarget, syncTargets } from "./sync";

export interface DashboardApp {
  path: string;
  name: string;
}

const HOUR = 3_600_000;
const DEFAULT_WINDOW_MS = 7 * 24 * HOUR;
const DEFAULT_KNOT_MS = HOUR;
const MAX_KNOT_ROWS = 5;
const DEBUG_SOURCE = { "github-actions": "GitHub", jenkins: "Jenkins", openshift: "OpenShift" } as const;
/** How often the dashboard looks for a provider whose auto refresh is due. */
const SYNC_TICK_MS = 15_000;

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
  /** All apps, then each app: ←/→ in the footer. One app has nothing to switch to. */
  cycleScope: (direction: 1 | -1) => void;
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
  /** Reading the events from Git and the caches. */
  loading: Accessor<boolean>;
  /** Asking the apps' providers for new runs and builds. */
  fetching: Accessor<boolean>;
  reload: () => Promise<void>;
  /** `r`: reads the events again and asks every provider of every app, also one whose token was refused. */
  refresh: () => Promise<void>;
}

/**
 * The dashboard's data and cursor. It reads the apps' events when the dashboard is shown, again when the apps change
 * and on `reload`; it never reads while hidden.
 *
 * While shown, it also asks each app's providers for new runs and builds, as their views would if the app were open:
 * each provider once when the dashboard is first shown, then again when its own auto refresh is due. What they find
 * goes into their normal caches, and the events are read again from there.
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
    /** Which providers of an app are asked and how (tests); each app's settings and the real servers otherwise. */
    sync?: {
      targets: (app: string) => SyncTarget[];
      run: (target: SyncTarget, signal: AbortSignal) => Promise<CacheSyncResult>;
    };
    tickMs?: number;
  }>,
): DashboardState {
  const [scope, setScope] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<DashboardEvent[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [fetching, setFetching] = createSignal(false);
  let controller: AbortController | undefined;
  let syncController: AbortController | undefined;
  onCleanup(() => {
    controller?.abort();
    syncController?.abort();
  });
  const now = () => (opts.now ?? Date.now)();
  const sync = opts.sync ?? {
    targets: syncTargets,
    run: (target: SyncTarget, signal: AbortSignal) => syncTarget(target, { signal, cacheRoot: opts.cacheRoot }),
  };
  const syncKey = (target: SyncTarget) => `${target.app}\u0000${target.source}`;
  /** When each provider of each app last finished asking, this session. */
  const lastSynced = new Map<string, number>();
  /** Providers whose token was refused: asked again only on `refresh`. */
  const refused = new Set<string>();

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

  /** Asks the providers that are due (all of them with `force`), then reads the events of each app that answered. */
  const syncDue = async (force: boolean) => {
    if (syncController && !force) return;
    syncController?.abort();
    if (force) refused.clear();
    const at = now();
    const due = (target: SyncTarget) => {
      const key = syncKey(target);
      if (force) return true;
      if (refused.has(key)) return false;
      const last = lastSynced.get(key);
      return last === undefined || (target.intervalMs > 0 && at - last >= target.intervalMs);
    };
    const plan = untrack(opts.apps)
      .map(app => sync.targets(app.path).filter(due))
      .filter(targets => targets.length > 0);
    if (plan.length === 0) return;
    const current = new AbortController();
    syncController = current;
    setFetching(true);
    try {
      await Promise.all(
        plan.map(async targets => {
          const results = await Promise.all(
            targets.map(async target => {
              try {
                return await sync.run(target, current.signal);
              } catch (error) {
                if (current.signal.aborted) return null;
                return { error: error instanceof Error ? error.message : String(error), authFailed: false };
              }
            }),
          );
          if (current.signal.aborted) return;
          targets.forEach((target, index) => {
            const result = results[index];
            lastSynced.set(syncKey(target), now());
            if (result?.authFailed) refused.add(syncKey(target));
            if (result?.error)
              addDebugEvent({
                source: DEBUG_SOURCE[target.source],
                message: `Dashboard, ${target.app}: ${result.error}`,
                status: "error",
              });
          });
          await reload();
        }),
      );
    } finally {
      if (syncController === current) {
        syncController = undefined;
        setFetching(false);
      }
    }
  };

  const refresh = async () => {
    await Promise.all([reload(), syncDue(true)]);
  };

  createEffect(() => {
    if (!opts.active()) {
      // Nothing is asked while hidden: a sync running stops, and what is due runs when the dashboard shows again.
      untrack(() => {
        syncController?.abort();
        syncController = undefined;
        setFetching(false);
      });
      return;
    }
    opts.apps();
    void untrack(reload);
    void untrack(() => syncDue(false));
    const timer = setInterval(() => void syncDue(false), opts.tickMs ?? SYNC_TICK_MS);
    onCleanup(() => clearInterval(timer));
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
    // One app is all of them: nothing to switch to.
    if (opts.apps().length <= 1) return;
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
    selected: () => {
      const row = rows()[cursor()];
      return row?.kind === "event" ? row.event : null;
    },
    select,
    move,
    moveToEnd,
    activate,
    loading,
    fetching,
    reload,
    refresh,
  };
}
