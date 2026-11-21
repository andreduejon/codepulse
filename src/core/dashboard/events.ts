/**
 * The dashboard's events: what each provider did for an app, one event per commit, run, build or scan, at the time it
 * happened. `dashboardRows` lays them out as knots on the app's rope.
 */

import type { EventSource } from "../provider-model";
import type { Severity, SeverityCounts } from "../severity";
import type { StatusCategory } from "../status";

/** One line of an event's side panel: a label and its value. */
export interface DashboardFact {
  label: string;
  value: string;
}

export interface DashboardEvent {
  /** Unique across apps and providers. */
  id: string;
  /** The app's repository path. */
  app: string;
  source: EventSource;
  /** When it happened (a commit) or ended (a run, a build, a scan), in milliseconds. */
  time: number;
  /** How it ended; null for a commit. */
  status: StatusCategory | null;
  /** A scan's worst finding; null for a clean scan. */
  severity?: Severity | null;
  /** A scan's findings per severity: the dashboard colors each count. */
  counts?: SeverityCounts;
  /** A scan that left projects out: its counts end in the warning `?`. */
  partial?: boolean;
  /** What happened, without the commit (shown beside it). */
  text: string;
  /** The branch it happened on: the provider's own (GitHub), else the one Git finds holding the commit. */
  branch?: string;
  sha: string;
  /** Its page (a run, a build), for `o`. */
  url?: string;
  /** Its entry in its provider's tab (a run's, a build's id): the details open and mark it. */
  entry?: string;
  /** The tab the details open on, when not its provider's first (an OpenShift warning: Events). */
  tab?: string;
  /** What the side panel shows beside the commit. */
  facts?: DashboardFact[];
}

/** A fact for the side panel, when it has a value. */
export const fact = (label: string, value: string | null | undefined): DashboardFact[] =>
  value ? [{ label, value }] : [];

/** How a run that ended in each status reads: `CI #812 failed`. */
export const VERBS: Record<StatusCategory, string> = {
  pass: "passed",
  fail: "failed",
  cancelled: "cancelled",
  skipped: "skipped",
  running: "running",
  unknown: "finished",
};

/** An ISO time in milliseconds; null when it isn't one. */
export const timeOf = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

/** A commit on the app's main branch. */
export interface GitCommitEvent {
  hash: string;
  time: number;
  subject: string;
}

/** The commits on the app's main branch, `branch`. */
export function gitEvents(app: string, commits: readonly GitCommitEvent[], branch?: string): DashboardEvent[] {
  return commits.map(commit => ({
    id: `${app}:git:${commit.hash}`,
    app,
    source: "git",
    time: commit.time,
    status: null,
    text: commit.subject,
    sha: commit.hash,
    ...(branch ? { branch } : {}),
  }));
}

/** One event per run, however many commits' snapshots hold it. */
export function runEvents<T extends { id: string | number; updatedAt: string; headSha: string }>(
  app: string,
  source: EventSource,
  runs: readonly T[],
  describe: (run: T) => {
    status: StatusCategory;
    text: string;
    url?: string;
    branch?: string;
    facts: DashboardFact[];
  },
): DashboardEvent[] {
  const events = new Map<string, DashboardEvent>();
  for (const run of runs) {
    const time = timeOf(run.updatedAt);
    const id = `${app}:${source}:${run.id}`;
    if (time === null || events.has(id)) continue;
    events.set(id, { id, app, source, time, ...describe(run), sha: run.headSha, entry: String(run.id) });
  }
  return [...events.values()];
}

export type DashboardRow =
  /** The first knot of a day: the date, so the times beside the knots stay short. */
  | { kind: "date"; time: number }
  /** Only the ropes, between two knots. */
  | { kind: "gap" }
  | { kind: "event"; event: DashboardEvent; knot: string };

export interface DashboardRowOptions {
  /** How long one knot is. */
  knotMs: number;
  /** Milliseconds to add to a UTC time to get local time, so knots and days follow the local clock. */
  utcOffset?: (time: number) => number;
}

const DAY = 86_400_000;
const localOffset = (time: number) => -new Date(time).getTimezoneOffset() * 60_000;

/**
 * The rows of the dashboard, newest first. A knot is one app's events within one knot length, every one of them on
 * its own row; knots are separated by a rope row, and each day starts with a date row.
 */
export function dashboardRows(events: readonly DashboardEvent[], options: DashboardRowOptions): DashboardRow[] {
  const offset = options.utcOffset ?? localOffset;
  const knots = new Map<string, { key: string; app: string; bucket: number; events: DashboardEvent[] }>();
  for (const event of [...events].sort((a, b) => b.time - a.time)) {
    const utcOffset = offset(event.time);
    const bucket = Math.floor((event.time + utcOffset) / options.knotMs);
    // The offset too: the hour the clock repeats when daylight saving ends holds two knots, not one around another.
    const key = `${event.app}\u0000${bucket}\u0000${utcOffset}`;
    let knot = knots.get(key);
    if (!knot) {
      knot = { key, app: event.app, bucket, events: [] };
      knots.set(key, knot);
    }
    knot.events.push(event);
  }
  // By the newest event's time, not the bucket: the local clock repeats an hour when daylight saving ends.
  const ordered = [...knots.values()].sort((a, b) => (b.events[0]?.time ?? 0) - (a.events[0]?.time ?? 0));
  const rows: DashboardRow[] = [];
  let day: number | null = null;
  for (const knot of ordered) {
    const newest = knot.events[0]?.time ?? 0;
    const knotDay = Math.floor((newest + offset(newest)) / DAY);
    if (rows.length > 0) rows.push({ kind: "gap" });
    if (knotDay !== day) {
      rows.push({ kind: "date", time: newest });
      day = knotDay;
    }
    for (const event of knot.events) rows.push({ kind: "event", event, knot: knot.key });
  }
  return rows;
}

/** Each row's identity: an event by its id, a date by its time, a rope by the row after it. */
function rowKeys(rows: readonly DashboardRow[]): string[] {
  const keys: string[] = new Array(rows.length);
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index] as DashboardRow;
    keys[index] =
      row.kind === "event"
        ? `event:${row.event.id}:${row.knot}`
        : row.kind === "date"
          ? `date:${row.time}`
          : `gap:${keys[index + 1] ?? ""}`;
  }
  return keys;
}

/** Each row's content, once per row: a row kept stays kept, so it is serialized only when it is new. */
const contents = new WeakMap<DashboardRow, string>();
const contentOf = (row: DashboardRow): string => {
  let content = contents.get(row);
  if (content === undefined) {
    content = JSON.stringify(row);
    contents.set(row, content);
  }
  return content;
};

/**
 * The rows read again, with each row that did not change replaced by the one before it: a list keyed by row (Solid's
 * `For`) keeps those rows as they are and draws only the new and the changed ones. A date row is always new: its label
 * ("Today", "Yesterday") depends on the clock, not on the row.
 */
export function keepUnchangedRows(previous: readonly DashboardRow[], next: DashboardRow[]): DashboardRow[] {
  if (previous.length === 0) return next;
  const before = new Map<string, DashboardRow>();
  const previousKeys = rowKeys(previous);
  for (const [index, row] of previous.entries()) before.set(previousKeys[index] as string, row);
  const nextKeys = rowKeys(next);
  return next.map((row, index) => {
    if (row.kind === "date") return row;
    const kept = before.get(nextKeys[index] as string);
    return kept && contentOf(kept) === contentOf(row) ? kept : row;
  });
}
