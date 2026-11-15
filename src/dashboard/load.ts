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

/** How far back the branch walk reads: every branch's recent first-parent history, at most this many commits. */
const BRANCH_WALK_COMMITS = 20000;

/**
 * The branch each commit was made on, the way the graph tells: a branch owns the commits on its first-parent line.
 * The main branch owns its own line, whichever other branch points into it. Any other commit belongs to the branch
 * whose tip reaches it in the fewest first-parent steps: a commit made on develop and merged into main is develop's.
 * Local branches count too, for commits not pushed yet. A commit no branch's recent history holds has none.
 */
async function branchesOwning(repo: string, shas: readonly string[], signal?: AbortSignal) {
  const owners = new Map<string, string>();
  const wanted = new Set(shas);
  const [refs, remotes, log, ref] = await Promise.all([
    runGit(repo, ["for-each-ref", `--format=%(objectname)${FIELD}%(refname)`, "refs/heads", "refs/remotes"], signal),
    runGit(repo, ["remote"], signal),
    runGit(
      repo,
      ["log", "--first-parent", "--branches", "--remotes", "--format=%H %P", "-n", String(BRANCH_WALK_COMMITS)],
      signal,
    ),
    mainBranch(repo, signal),
  ]);
  if (log.exitCode !== 0) return owners;
  const firstParent = new Map<string, string | undefined>();
  for (const line of log.stdout.split("\n")) {
    const [sha, parent] = line.trim().split(" ");
    if (sha) firstParent.set(sha, parent);
  }
  const remoteNames = remotes.stdout
    .split("\n")
    .map(name => name.trim())
    .filter(Boolean);
  const tips = refs.stdout.split("\n").flatMap(line => {
    const [sha = "", refname = ""] = line.split(FIELD);
    if (!sha || refname.endsWith("/HEAD")) return [];
    if (refname.startsWith("refs/heads/")) return [{ sha, name: refname.slice("refs/heads/".length), refname }];
    const remoteRef = refname.slice("refs/remotes/".length);
    const remote = remoteNames.find(name => remoteRef.startsWith(`${name}/`));
    return [{ sha, name: remote ? remoteRef.slice(remote.length + 1) : remoteRef, refname }];
  });

  // The main branch's own line first: it is main's, and the walks below stop where they reach it.
  const mainName = await mainBranchName(repo, ref, signal);
  const mainRefname = ref === "HEAD" ? null : `refs/remotes/${ref}`;
  const mainTip =
    tips.find(tip => tip.refname === mainRefname)?.sha ??
    (await runGit(repo, ["rev-parse", "--verify", `${ref}^{commit}`], signal)).stdout.trim();
  const mainLine = new Set<string>();
  let walked: string | undefined = mainTip;
  while (walked && firstParent.has(walked) && !mainLine.has(walked)) {
    mainLine.add(walked);
    walked = firstParent.get(walked);
  }
  if (mainName) for (const sha of wanted) if (mainLine.has(sha)) owners.set(sha, mainName);

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
  const unnamed = [...new Set(events.filter(event => !event.branch).map(event => event.sha))];
  if (unnamed.length === 0) return events;
  const [owners] = await quietly(async () => [await branchesOwning(app, unnamed, options.signal)]);
  if (!owners) return events;
  return events.map(event => {
    const branch = event.branch ? undefined : owners.get(event.sha);
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
