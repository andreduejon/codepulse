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
async function mainBranch(repo: string, signal?: AbortSignal): Promise<string> {
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
 * its provider caches hold. Nothing is fetched: the caches are as fresh as the last time the app was open.
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
