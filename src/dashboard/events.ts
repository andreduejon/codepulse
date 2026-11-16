/**
 * The dashboard's events: what each provider did for an app, one event per commit, run, build or scan, at the time it
 * happened. `dashboardRows` lays them out as knots on the app's rope.
 */
import type { GitHubCacheEntry } from "../providers/github-actions/cache";
import type { JenkinsCacheEntry } from "../providers/jenkins/cache";
import type { OpenShiftCacheEntry } from "../providers/openshift/cache";
import type { EventSource } from "../providers/provider";
import { categorize, type StatusCategory } from "../providers/shared/status";
import type { SnykScanResult, SnykSeverity } from "../providers/snyk/types";
import { formatDuration } from "../utils/date";

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
  severity?: SnykSeverity | null;
  /** A scan's findings per severity: the dashboard colors each count. */
  counts?: SnykScanResult["counts"];
  /** What happened, without the commit (shown beside it). */
  text: string;
  /** The branch it happened on: the provider's own (GitHub), else the one Git finds holding the commit. */
  branch?: string;
  sha: string;
  /** Its page (a run, a build), for `o`. */
  url?: string;
  /** What the side panel shows beside the commit. */
  facts?: DashboardFact[];
}

const fact = (label: string, value: string | null | undefined): DashboardFact[] => (value ? [{ label, value }] : []);

const VERBS: Record<StatusCategory, string> = {
  pass: "passed",
  fail: "failed",
  cancelled: "cancelled",
  skipped: "skipped",
  running: "running",
  unknown: "finished",
};

const timeOf = (value: string | null | undefined) => {
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
function runEvents<T extends { id: string | number; updatedAt: string; headSha: string }>(
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
    events.set(id, { id, app, source, time, ...describe(run), sha: run.headSha });
  }
  return [...events.values()];
}

export function githubEvents(
  app: string,
  entries: readonly Pick<GitHubCacheEntry, "sha" | "runs">[],
): DashboardEvent[] {
  return runEvents(
    app,
    "github-actions",
    entries.flatMap(entry => entry.runs),
    run => {
      const status = categorize(run.status, run.conclusion);
      return {
        status,
        text: `${run.name} #${run.runNumber} ${VERBS[status]}`,
        ...(run.url ? { url: run.url } : {}),
        ...(run.headBranch ? { branch: run.headBranch } : {}),
        facts: [
          ...fact("Workflow", run.name),
          ...fact("Run", `#${run.runNumber}`),
          ...fact("Trigger", run.event),
          ...fact("Duration", formatDuration(run.startedAt ?? null, run.updatedAt)),
        ],
      };
    },
  );
}

export function jenkinsEvents(
  app: string,
  entries: readonly Pick<JenkinsCacheEntry, "sha" | "runs">[],
): DashboardEvent[] {
  return runEvents(
    app,
    "jenkins",
    entries.flatMap(entry => entry.runs),
    run => {
      const status = categorize(run.status, run.conclusion);
      const verb = status === "cancelled" ? "aborted" : VERBS[status];
      return {
        status,
        text: `${run.jobLabel || run.name} #${run.runNumber} ${verb}`,
        ...(run.url ? { url: run.url } : {}),
        ...(run.branch ? { branch: run.branch } : {}),
        facts: [
          ...fact("Job", run.jobLabel || run.name),
          ...fact("Build", `#${run.runNumber}`),
          ...fact("Duration", formatDuration(run.startedAt, run.updatedAt)),
        ],
      };
    },
  );
}

export function openShiftEvents(app: string, entries: readonly OpenShiftCacheEntry[]): DashboardEvent[] {
  const events = new Map<string, DashboardEvent>();
  for (const build of entries.flatMap(entry => entry.builds)) {
    // When it finished; its creation time otherwise.
    const objectStatus = (build.object as { status?: Record<string, unknown> } | undefined)?.status ?? {};
    const text = (key: string) => (typeof objectStatus[key] === "string" ? (objectStatus[key] as string) : null);
    const completed = text("completionTimestamp");
    const time = timeOf(completed) ?? timeOf(build.updatedAt);
    const reason = [text("reason"), text("message")].filter(Boolean).join(": ");
    const id = `${app}:openshift:${build.namespace}/${build.id}`;
    if (time === null || events.has(id)) continue;
    const outcome = build.status === "pass" ? "complete" : build.status === "fail" ? "failed" : "running";
    // The Git ref its BuildConfig builds, when it names one (`develop`, `refs/heads/develop`); else Git finds it.
    const spec = (build.object as { spec?: { source?: { git?: { ref?: unknown } } } } | undefined)?.spec;
    const ref = spec?.source?.git?.ref;
    const branch = typeof ref === "string" ? ref.trim().replace(/^refs\/heads\//, "") : "";
    events.set(id, {
      id,
      app,
      source: "openshift",
      time,
      status: build.status,
      text: `build ${build.name} ${outcome} in ${build.namespace}`,
      sha: build.commitSha,
      ...(branch ? { branch } : {}),
      facts: [
        ...fact("Namespace", build.namespace),
        ...fact("Build", build.name),
        ...fact("Reason", build.status === "fail" ? reason : null),
        ...fact("Duration", formatDuration(build.updatedAt ?? null, completed)),
      ],
    });
  }
  return [...events.values()];
}

export function snykEvents(
  app: string,
  scans: readonly (Pick<SnykScanResult, "sha" | "scannedAt" | "counts"> &
    Partial<Pick<SnykScanResult, "partial" | "failedProjects">>)[],
): DashboardEvent[] {
  return scans.flatMap(scan => {
    const time = timeOf(scan.scannedAt);
    if (time === null) return [];
    const { critical, high, medium, low } = scan.counts;
    const bySeverity = [
      ["critical", critical],
      ["high", high],
      ["medium", medium],
      ["low", low],
    ] as const;
    const total = critical + high + medium + low;
    const status: StatusCategory = critical + high > 0 ? "fail" : total > 0 ? "unknown" : "pass";
    const counted = `${total} ${total === 1 ? "vulnerability" : "vulnerabilities"}`;
    return [
      {
        id: `${app}:snyk:${scan.sha}`,
        app,
        source: "snyk" as const,
        time,
        status,
        severity: bySeverity.find(([, count]) => count > 0)?.[0] ?? null,
        // Every severity in order, zeros too, so the counts line up from scan to scan.
        text: `scan · ${total > 0 ? [counted, ...bySeverity.map(([severity, count]) => `${count} ${severity}`)].join(" · ") : "no vulnerabilities"}`,
        ...(total > 0 ? { counts: scan.counts } : {}),
        sha: scan.sha,
        facts: [
          ...fact("Vulnerabilities", `${total} (${critical} critical, ${high} high, ${medium} medium, ${low} low)`),
          ...fact(
            "Partial",
            scan.partial
              ? `${scan.failedProjects ?? 1} ${scan.failedProjects === 1 || scan.failedProjects === undefined ? "project" : "projects"} could not be scanned`
              : null,
          ),
        ],
      },
    ];
  });
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
    const bucket = Math.floor((event.time + offset(event.time)) / options.knotMs);
    const key = `${event.app}\u0000${bucket}`;
    let knot = knots.get(key);
    if (!knot) {
      knot = { key, app: event.app, bucket, events: [] };
      knots.set(key, knot);
    }
    knot.events.push(event);
  }
  const ordered = [...knots.values()].sort(
    (a, b) => b.bucket - a.bucket || (b.events[0]?.time ?? 0) - (a.events[0]?.time ?? 0),
  );
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
