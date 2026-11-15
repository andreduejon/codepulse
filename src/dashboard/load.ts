import { runGit } from "../git/repo-git";
import { GitHubCache } from "../providers/github-actions/cache";
import { JenkinsCache } from "../providers/jenkins/cache";
import { OpenShiftCache } from "../providers/openshift/cache";
import { SnykCache } from "../providers/snyk/cache";
import {
  type DashboardEvent,
  type GitCommitEvent,
  gitEvents,
  githubEvents,
  jenkinsEvents,
  openShiftEvents,
  snykEvents,
} from "./events";

export interface LoadOptions {
  /** The window's start: older events are left out. */
  since: number;
  /** The provider caches' folder (tests); the app's own otherwise. */
  cacheRoot?: string;
  signal?: AbortSignal;
}

const FIELD = "\u001f";

/** The branch an app's rope follows: the remote's default branch, else the checked-out one. */
export async function mainBranch(repo: string, signal?: AbortSignal): Promise<string> {
  const remote = await runGit(repo, ["rev-parse", "--abbrev-ref", "origin/HEAD"], signal);
  const name = remote.stdout.trim();
  return remote.exitCode === 0 && name && name !== "origin/HEAD" ? name : "HEAD";
}

/** What landed on the main branch since `since`: its first-parent commits, at the time they were committed. */
async function mainBranchCommits(repo: string, since: number, signal?: AbortSignal): Promise<GitCommitEvent[]> {
  const ref = await mainBranch(repo, signal);
  const { stdout, exitCode } = await runGit(
    repo,
    [
      "log",
      ref,
      "--first-parent",
      `--since=${new Date(since).toISOString()}`,
      `--format=%H${FIELD}%ct${FIELD}%s`,
      "-n",
      "1000",
    ],
    signal,
  );
  if (exitCode !== 0) return [];
  return stdout.split("\n").flatMap(line => {
    const [hash, seconds, subject] = line.split(FIELD);
    const time = Number(seconds) * 1000;
    return hash && Number.isFinite(time) ? [{ hash, time, subject: subject ?? "" }] : [];
  });
}

/** Never fails the dashboard: a missing folder or an unreadable cache gives nothing for that part. */
const quietly = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await read();
  } catch {
    return [];
  }
};

/**
 * One app's events since the window starts: the commits on its main branch, and the finished runs, builds and scans
 * its provider caches hold. Nothing is fetched here: the dashboard's sync and the app's own views fill the caches.
 */
export async function loadAppEvents(app: string, options: LoadOptions): Promise<DashboardEvent[]> {
  const root = options.cacheRoot === undefined ? {} : { root: options.cacheRoot };
  const [commits, github, jenkins, openshift, snyk] = await Promise.all([
    quietly(() => mainBranchCommits(app, options.since, options.signal)),
    quietly(() => new GitHubCache(root).peekAll(app)),
    quietly(() => new JenkinsCache(root).peekAll(app)),
    quietly(() => new OpenShiftCache(root).peekAll(app)),
    quietly(() => new SnykCache(root).peekAll(app)),
  ]);
  return [
    ...gitEvents(app, commits),
    ...githubEvents(app, github),
    ...jenkinsEvents(app, jenkins),
    ...openShiftEvents(app, openshift),
    ...snykEvents(app, snyk),
  ].filter(event => event.time >= options.since);
}

/** What the side panel shows about an event's commit. */
export interface CommitInfo {
  author: string;
  email: string;
  /** ISO 8601, as Git wrote it. */
  date: string;
  subject: string;
  body: string;
}

/** An event's commit as the app's repository knows it; null when it does not (a commit only CI saw). */
export async function loadCommitInfo(app: string, sha: string, signal?: AbortSignal): Promise<CommitInfo | null> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  try {
    const { stdout, exitCode } = await runGit(
      app,
      ["show", "-s", `--format=%an${FIELD}%ae${FIELD}%aI${FIELD}%s${FIELD}%b`, sha, "--"],
      signal,
    );
    if (exitCode !== 0) return null;
    const [author = "", email = "", date = "", subject = "", body = ""] = stdout.split(FIELD);
    return { author, email, date: date.replace(/\+00:00$/, "Z"), subject, body: body.trim() };
  } catch {
    return null;
  }
}
