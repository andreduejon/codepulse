/** The Git the Dashboard reads: the main branch and its commits, every branch's recent history, a commit's author. */

import type { GitCommitEvent } from "../core/dashboard/events";
import type { BranchTip, BranchWalk, CommitInfo, MainBranch } from "../core/dashboard/load";
import { isCommitHash } from "../core/dashboard/load";
import { runGit } from "./repo-git";

const FIELD = "\u001f";

/** How far back the branch walk reads: every branch's recent first-parent history, at most this many commits. */
const BRANCH_WALK_COMMITS = 20000;

/** The remote's default branch, else the checked-out one, with its name as the Dashboard shows it. */
export async function getMainBranch(repo: string, signal?: AbortSignal): Promise<MainBranch> {
  const remote = await runGit(repo, ["rev-parse", "--abbrev-ref", "origin/HEAD"], signal);
  const remoteName = remote.stdout.trim();
  if (remote.exitCode === 0 && remoteName && remoteName !== "origin/HEAD") {
    return { ref: remoteName, name: remoteName.slice(remoteName.indexOf("/") + 1) };
  }
  const head = await runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"], signal);
  const headName = head.stdout.trim();
  return head.exitCode === 0 && headName && headName !== "HEAD" ? { ref: "HEAD", name: headName } : { ref: "HEAD" };
}

/** What landed on the main branch since `since`: its first-parent commits, at the time they were committed. */
export async function getMainBranchCommits(
  repo: string,
  branch: MainBranch,
  since: number,
  signal?: AbortSignal,
): Promise<GitCommitEvent[]> {
  const { stdout, exitCode } = await runGit(
    repo,
    [
      "log",
      branch.ref,
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

/** Every branch's (local and remote) recent first-parent history and tips. */
export async function getBranchWalk(repo: string, signal?: AbortSignal): Promise<BranchWalk | null> {
  const [refs, remotes, log] = await Promise.all([
    runGit(repo, ["for-each-ref", `--format=%(objectname)${FIELD}%(refname)`, "refs/heads", "refs/remotes"], signal),
    runGit(repo, ["remote"], signal),
    runGit(
      repo,
      ["log", "--first-parent", "--branches", "--remotes", "--format=%H %P", "-n", String(BRANCH_WALK_COMMITS)],
      signal,
    ),
  ]);
  if (log.exitCode !== 0) return null;
  const firstParent = new Map<string, string | undefined>();
  for (const line of log.stdout.split("\n")) {
    const [sha, parent] = line.trim().split(" ");
    if (sha) firstParent.set(sha, parent);
  }
  const remoteNames = remotes.stdout
    .split("\n")
    .map(name => name.trim())
    .filter(Boolean);
  const tips = refs.stdout.split("\n").flatMap((line): BranchTip[] => {
    const [sha = "", refname = ""] = line.split(FIELD);
    if (!sha || refname.endsWith("/HEAD")) return [];
    if (refname.startsWith("refs/heads/")) return [{ sha, name: refname.slice("refs/heads/".length), refname }];
    const remoteRef = refname.slice("refs/remotes/".length);
    const remote = remoteNames.find(name => remoteRef.startsWith(`${name}/`));
    return [{ sha, name: remote ? remoteRef.slice(remote.length + 1) : remoteRef, refname }];
  });
  return { firstParent, tips };
}

/** A ref's commit, or "". */
export async function resolveCommit(repo: string, ref: string, signal?: AbortSignal): Promise<string> {
  return (await runGit(repo, ["rev-parse", "--verify", `${ref}^{commit}`], signal)).stdout.trim();
}

/** An event's commit as the repository knows it; null when it does not (a commit only CI saw). */
export async function getCommitInfo(repo: string, sha: string, signal?: AbortSignal): Promise<CommitInfo | null> {
  if (!isCommitHash(sha)) return null;
  try {
    const { stdout, exitCode } = await runGit(
      repo,
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
