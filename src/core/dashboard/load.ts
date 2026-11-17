/**
 * One app's Dashboard events, without any UI framework or runtime: the commits on its main branch and the finished runs,
 * builds and scans its providers stored, each with the branch it was made on. Git and the stored events come in
 * through ports; src/dashboard/load.ts gives the terminal app's (the Git command line and the provider caches).
 */
import type { GitHubCacheEntry } from "../github/merge";
import type { JenkinsCacheEntry } from "../jenkins/merge";
import type { OpenShiftCacheEntry } from "../openshift/merge";
import type { SnykScanResult } from "../snyk/types";
import {
  type DashboardEvent,
  type GitCommitEvent,
  gitEvents,
  githubEvents,
  jenkinsEvents,
  openShiftEvents,
  snykEvents,
} from "./events";

/** A branch's tip: its commit, its name as the Dashboard shows it (without the remote), its full ref name. */
export interface BranchTip {
  sha: string;
  name: string;
  refname: string;
}

/** Every branch's recent first-parent history: each commit's first parent, and the branches' tips. */
export interface BranchWalk {
  firstParent: ReadonlyMap<string, string | undefined>;
  tips: readonly BranchTip[];
}

/** The main branch: the remote's default branch (`origin/main`), else the checked-out one (`HEAD`). */
export interface MainBranch {
  ref: string;
  /** Its name as the Dashboard shows it (`main`); none for a detached HEAD. */
  name?: string;
}

/** What an event's side panel shows about its commit. */
export interface CommitInfo {
  author: string;
  email: string;
  /** ISO 8601, as Git wrote it. */
  date: string;
  subject: string;
  body: string;
}

/** The Git the Dashboard reads (the app's Git port has it). */
export interface DashboardGit {
  getMainBranch: (repo: string, signal?: AbortSignal) => Promise<MainBranch>;
  /** The main branch's first-parent commits since a time (ms), newest first. */
  getMainBranchCommits: (
    repo: string,
    branch: MainBranch,
    since: number,
    signal?: AbortSignal,
  ) => Promise<GitCommitEvent[]>;
  /** Every branch's recent first-parent history; null when Git can't read it. */
  getBranchWalk: (repo: string, signal?: AbortSignal) => Promise<BranchWalk | null>;
  /** A ref's commit, or "". */
  resolveCommit: (repo: string, ref: string, signal?: AbortSignal) => Promise<string>;
}

/** What the providers stored for an app: finished runs, builds and scans, as fresh as when the app was last open. */
export interface DashboardSources {
  github: (app: string) => Promise<GitHubCacheEntry[]>;
  jenkins: (app: string) => Promise<JenkinsCacheEntry[]>;
  openshift: (app: string) => Promise<OpenShiftCacheEntry[]>;
  snyk: (app: string) => Promise<SnykScanResult[]>;
}

/** What a read of an app's events covers: from `since` (ms), until `signal` stops it. */
export interface ReadOptions {
  since: number;
  signal?: AbortSignal;
}

/** Reads an app's Dashboard events; the terminal app's reads Git and the provider caches. */
export interface DashboardReader {
  readEvents: (app: string, options: ReadOptions) => Promise<DashboardEvent[]>;
}

/** An event's commit hash as the side panel may ask Git about it: hex only, so it is never read as an option. */
export const isCommitHash = (sha: string): boolean => /^[0-9a-f]{7,40}$/i.test(sha);

/**
 * The branch each commit was made on, the way the graph tells: a branch owns the commits on its first-parent line.
 * The main branch owns its own line, whichever other branch points into it. Any other commit belongs to the branch
 * whose tip reaches it in the fewest first-parent steps: a commit made on develop and merged into main is develop's.
 * A commit no branch's recent history holds has none.
 */
export function branchOwners(
  wanted: ReadonlySet<string>,
  walk: BranchWalk,
  main: { name?: string; tip: string },
): Map<string, string> {
  const owners = new Map<string, string>();
  const { firstParent, tips } = walk;
  // The main branch's own line first: it is main's, and the walks below stop where they reach it.
  const mainLine = new Set<string>();
  let walked: string | undefined = main.tip;
  while (walked && firstParent.has(walked) && !mainLine.has(walked)) {
    mainLine.add(walked);
    walked = firstParent.get(walked);
  }
  if (main.name) for (const sha of wanted) if (mainLine.has(sha)) owners.set(sha, main.name);

  const best = new Map<string, { name: string; steps: number }>();
  for (const tip of [...tips].sort((a, b) => a.name.localeCompare(b.name))) {
    let steps = 0;
    for (let sha: string | undefined = tip.sha; sha && firstParent.has(sha) && !mainLine.has(sha); steps++) {
      if (wanted.has(sha)) {
        const current = best.get(sha);
        if (!current || steps < current.steps) best.set(sha, { name: tip.name, steps });
      }
      sha = firstParent.get(sha);
    }
  }
  for (const [sha, { name }] of best) if (!owners.has(sha)) owners.set(sha, name);
  return owners;
}

/** Never fails the Dashboard: a missing folder or an unreadable cache gives nothing for that part. */
const quietly = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await read();
  } catch {
    return [];
  }
};

/**
 * One app's events since the window starts (`since`, ms): the commits on its main branch, and the finished runs,
 * builds and scans its providers stored. Nothing is fetched.
 */
export async function readAppEvents(
  app: string,
  options: ReadOptions,
  ports: { git: DashboardGit; sources: DashboardSources },
): Promise<DashboardEvent[]> {
  const { git, sources } = ports;
  const { since, signal } = options;
  const [main, github, jenkins, openshift, snyk] = await Promise.all([
    quietly(async () => {
      const branch = await git.getMainBranch(app, signal);
      return [{ branch, commits: await git.getMainBranchCommits(app, branch, since, signal) }];
    }),
    quietly(() => sources.github(app)),
    quietly(() => sources.jenkins(app)),
    quietly(() => sources.openshift(app)),
    quietly(() => sources.snyk(app)),
  ]);
  const events = [
    ...main.flatMap(({ commits, branch }) => gitEvents(app, commits, branch.name)),
    ...githubEvents(app, github),
    ...jenkinsEvents(app, jenkins),
    ...openShiftEvents(app, openshift),
    ...snykEvents(app, snyk),
  ].filter(event => event.time >= since);
  const unnamed = new Set(events.filter(event => !event.branch).map(event => event.sha));
  if (unnamed.size === 0) return events;
  const [owners] = await quietly(async () => {
    const [walk, branch] = await Promise.all([git.getBranchWalk(app, signal), git.getMainBranch(app, signal)]);
    if (!walk) return [new Map<string, string>()];
    const mainRefname = branch.ref === "HEAD" ? null : `refs/remotes/${branch.ref}`;
    const tip =
      walk.tips.find(candidate => candidate.refname === mainRefname)?.sha ??
      (await git.resolveCommit(app, branch.ref, signal));
    return [branchOwners(unnamed, walk, { name: branch.name, tip })];
  });
  if (!owners) return events;
  return events.map(event => {
    const branch = event.branch ? undefined : owners.get(event.sha);
    return branch ? { ...event, branch } : event;
  });
}
