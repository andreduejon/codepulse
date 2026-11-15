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

/** The main branch's name as the dashboard shows it: `main` for `origin/main`, the checked-out branch for `HEAD`. */
async function mainBranchName(repo: string, ref: string, signal?: AbortSignal): Promise<string | undefined> {
  if (ref !== "HEAD") return ref.slice(ref.indexOf("/") + 1);
  const head = await runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"], signal);
  const name = head.stdout.trim();
  return head.exitCode === 0 && name && name !== "HEAD" ? name : undefined;
}

/**
 * The branch that holds each commit, as `git name-rev` names it: a remote branch first (`origin/feature/login~2` is
 * `feature/login`), else a local one, for a commit not pushed yet. A commit no branch holds, or one the repository
 * lacks, has none.
 */
async function branchesHolding(repo: string, shas: readonly string[], signal?: AbortSignal) {
  const found = new Map<string, string>();
  const remotes = await runGit(repo, ["remote"], signal);
  const prefixes = remotes.stdout
    .split("\n")
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => `${name}/`);
  const name = async (refs: string[], strip: (ref: string) => string) => {
    const missing = shas.filter(sha => !found.has(sha) && /^[0-9a-f]{40}$/i.test(sha));
    if (missing.length === 0) return;
    const { stdout } = await runGit(repo, ["name-rev", ...refs, ...missing], signal);
    for (const line of stdout.split("\n")) {
      const [sha, ref] = line.trim().split(" ");
      if (!sha || !ref || ref === "undefined") continue;
      const branch = strip(ref.replace(/[~^].*$/, ""));
      if (branch) found.set(sha, branch);
    }
  };
  await name(["--refs=refs/remotes/*", "--exclude=refs/remotes/*/HEAD"], ref => {
    const remoteRef = ref.replace(/^remotes\//, "");
    const prefix = prefixes.find(candidate => remoteRef.startsWith(candidate));
    return prefix ? remoteRef.slice(prefix.length) : remoteRef;
  });
  await name(["--refs=refs/heads/*"], ref => ref.replace(/^heads\//, ""));
  return found;
}

/** What landed on the main branch since `since`: its first-parent commits, at the time they were committed. */
async function mainBranchCommits(
  repo: string,
  since: number,
  signal?: AbortSignal,
): Promise<{ commits: GitCommitEvent[]; branch?: string }[]> {
  const ref = await mainBranch(repo, signal);
  const branch = await mainBranchName(repo, ref, signal);
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
  const commits = stdout.split("\n").flatMap(line => {
    const [hash, seconds, subject] = line.split(FIELD);
    const time = Number(seconds) * 1000;
    return hash && Number.isFinite(time) ? [{ hash, time, subject: subject ?? "" }] : [];
  });
  return [{ commits, ...(branch ? { branch } : {}) }];
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
  const [main, github, jenkins, openshift, snyk] = await Promise.all([
    quietly(() => mainBranchCommits(app, options.since, options.signal)),
    quietly(() => new GitHubCache(root).peekAll(app)),
    quietly(() => new JenkinsCache(root).peekAll(app)),
    quietly(() => new OpenShiftCache(root).peekAll(app)),
    quietly(() => new SnykCache(root).peekAll(app)),
  ]);
  const events = [
    ...main.flatMap(({ commits, branch }) => gitEvents(app, commits, branch)),
    ...githubEvents(app, github),
    ...jenkinsEvents(app, jenkins),
    ...openShiftEvents(app, openshift),
    ...snykEvents(app, snyk),
  ].filter(event => event.time >= options.since);
  // A commit on the main branch's own line is main's, whichever other branch points at it too: its runs and scans
  // name the branch its commit row does.
  const mainLine = new Map<string, string>();
  for (const event of events) if (event.source === "git" && event.branch) mainLine.set(event.sha, event.branch);
  const named = events.map(event => {
    const branch = event.branch ? undefined : mainLine.get(event.sha);
    return branch ? { ...event, branch } : event;
  });
  const unnamed = [...new Set(named.filter(event => !event.branch).map(event => event.sha))];
  if (unnamed.length === 0) return named;
  const branches = await quietly(async () => [await branchesHolding(app, unnamed, options.signal)]);
  const holding = branches[0];
  if (!holding) return named;
  return named.map(event => {
    const branch = event.branch ? undefined : holding.get(event.sha);
    return branch ? { ...event, branch } : event;
  });
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
