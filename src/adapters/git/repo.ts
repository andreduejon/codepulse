import { resolve } from "node:path";
import { BANNER, classifyGitFailure, debugError } from "../../core/banner";
import {
  ALL_BRANCH_REVISIONS,
  buildCommitLogArgs,
  type FastForwardResult,
  GIT_LOG_FORMAT,
  parseCommitLine,
  parseStashEntry,
  parseTagLine,
  parseTrackInfo,
  RS,
  STASH_FORMAT,
} from "../../core/git/log";
import { parseDiffTreeOutput } from "../../core/git/status";
import type { Branch, Commit, CommitDetail, TagInfo } from "../../core/git/types";
import { runGit } from "./repo-git";

export { parseBlameOutput, parseUnifiedDiff } from "../../core/git/diff";
export type { WorkingTreeStatus } from "../../core/git/status";
export { parseDiffTreeOutput, parseStatusPorcelain } from "../../core/git/status";
export { getFileBlame, getFileContent, getFileDiff } from "./repo-diff";
export { runGit } from "./repo-git";
export {
  getStagedFiles,
  getStashFiles,
  getUncommittedDetail,
  getUnstagedFiles,
  getUntrackedFiles,
  getWorkingTreeStatus,
} from "./repo-status";

/**
 * The reads of `git remote` under way, by signal: the commits and the branches of one refresh share one. A read with
 * another signal asks Git itself, so an abort elsewhere never leaves it without remotes.
 */
const remoteReads = new WeakMap<AbortSignal, Map<string, Promise<Set<string>>>>();

/** The configured remote names (e.g. ["origin", "upstream"]). */
function getRemoteNames(repoPath: string, signal?: AbortSignal): Promise<Set<string>> {
  if (!signal) return readRemoteNames(repoPath);
  let reads = remoteReads.get(signal);
  if (!reads) {
    reads = new Map();
    remoteReads.set(signal, reads);
  }
  const shared = reads.get(repoPath);
  if (shared) return shared;
  const read = readRemoteNames(repoPath, signal);
  reads.set(repoPath, read);
  const done = reads;
  const forget = () => done.delete(repoPath);
  read.then(forget, forget);
  return read;
}

async function readRemoteNames(repoPath: string, signal?: AbortSignal): Promise<Set<string>> {
  const { stdout, exitCode } = await runGit(repoPath, ["remote"], signal);
  if (exitCode !== 0) return new Set();
  return new Set(
    stdout
      .trim()
      .split("\n")
      .map(r => r.trim())
      .filter(Boolean),
  );
}

export async function getCommits(
  repoPath: string,
  options: {
    maxCount?: number;
    skip?: number;
    branch?: string;
    all?: boolean;
  } = {},
  signal?: AbortSignal,
): Promise<Commit[]> {
  const args = buildCommitLogArgs(options);

  const [logResult, remoteNames] = await Promise.all([
    runGit(repoPath, args, signal),
    getRemoteNames(repoPath, signal),
  ]);

  const { stdout, stderr, exitCode } = logResult;

  if (exitCode !== 0) {
    if (stderr.trim()) debugError("Git", stderr.trim());
    throw new Error(BANNER.git.logFailed);
  }

  const commits: Commit[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const commit = parseCommitLine(line, remoteNames);
    if (commit) commits.push(commit);
  }

  return commits;
}

export async function getBranches(repoPath: string, signal?: AbortSignal): Promise<Branch[]> {
  const [branchResult, remoteNames] = await Promise.all([
    runGit(
      repoPath,
      [
        "branch",
        "-a",
        `--format=%(HEAD)${RS}%(refname:short)${RS}%(objectname)${RS}%(upstream:short)${RS}%(upstream:track,nobracket)${RS}%(symref)`,
      ],
      signal,
    ),
    getRemoteNames(repoPath, signal),
  ]);

  if (branchResult.exitCode !== 0) return [];

  return branchResult.stdout
    .trim()
    .split("\n")
    .filter(l => l.trim())
    .filter(line => {
      // Filter out symbolic refs (e.g. origin/HEAD -> origin/develop)
      const parts = line.split(RS);
      const symref = parts[5]?.trim();
      return !symref;
    })
    .map(line => {
      const [head, name, lastCommitHash, upstream, track] = line.split(RS);
      const trimmedName = name.trim();
      let isRemote = trimmedName.includes("remotes/");
      if (!isRemote) {
        for (const r of remoteNames) {
          if (trimmedName.startsWith(`${r}/`)) {
            isRemote = true;
            break;
          }
        }
      }

      const branch: Branch = {
        name: trimmedName,
        isCurrent: head.trim() === "*",
        isRemote,
        lastCommitHash: lastCommitHash?.trim() ?? "",
      };

      // Upstream tracking info (only meaningful for local branches)
      const trimmedUpstream = upstream?.trim();
      if (trimmedUpstream) {
        branch.upstream = trimmedUpstream;
        const trackInfo = parseTrackInfo(track ?? "");
        if (trackInfo.ahead != null) branch.ahead = trackInfo.ahead;
        if (trackInfo.behind != null) branch.behind = trackInfo.behind;
      }

      return branch;
    });
}

export async function getTagDetails(repoPath: string, signal?: AbortSignal): Promise<Map<string, TagInfo>> {
  const format = `%(refname)${RS}%(objecttype)${RS}%(taggername)${RS}%(taggerdate:iso-strict)${RS}%(contents:subject)`;
  const { stdout, exitCode } = await runGit(repoPath, ["for-each-ref", `--format=${format}`, "refs/tags/"], signal);

  const result = new Map<string, TagInfo>();
  if (exitCode !== 0) return result;

  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const tag = parseTagLine(line);
    if (tag) result.set(tag.name, tag);
  }

  return result;
}

// ── Stash support ─────────────────────────────────────────────────────

/**
 * Fetch all stash entries as synthetic Commit objects.
 * Each stash commit's parents[0] is the HEAD commit at the time of stashing,
 * which allows buildGraph to connect the stash to the correct point in history.
 */
export async function getStashList(repoPath: string, signal?: AbortSignal): Promise<Commit[]> {
  const { stdout, exitCode } = await runGit(repoPath, ["stash", "list", `--format=${STASH_FORMAT}`], signal);

  if (exitCode !== 0 || !stdout.trim()) return [];

  const stashes: Commit[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const entry = parseStashEntry(line);
    if (entry) stashes.push(entry);
  }

  return stashes;
}

export async function getCommitDetail(
  repoPath: string,
  hash: string,
  existingCommit?: Commit,
  signal?: AbortSignal,
): Promise<CommitDetail | null> {
  // Get full commit message ("--" after the revision prevents the hash
  // from being mistaken for a path if it matches a filename)
  const msgProc = runGit(repoPath, ["log", "-1", "--format=%B", hash, "--"], signal);

  // Use existing commit info if provided (avoids a redundant git log subprocess)
  let commit: Commit;
  if (existingCommit) {
    commit = existingCommit;
  } else {
    // Fetch metadata for a single commit by its hash.
    // Place hash before "--" so git treats it as a revision, not a path.
    const [lookupResult, remoteNames] = await Promise.all([
      runGit(repoPath, ["log", "-1", "--topo-order", `--format=${GIT_LOG_FORMAT}`, hash, "--"], signal),
      getRemoteNames(repoPath, signal),
    ]);
    if (signal?.aborted) return null;
    if (lookupResult.exitCode !== 0 || !lookupResult.stdout.trim()) return null;
    const parsed = parseCommitLine(lookupResult.stdout.trim().split("\n")[0], remoteNames);
    if (!parsed) return null;
    commit = parsed;
  }

  // Single diff-tree call: --raw gives status letters, --numstat gives +/- stats.
  // Git outputs the raw lines first, then a blank separator, then numstat lines.
  // --root lists the initial commit's files; merges diff against their first parent
  // (one-revision diff-tree prints nothing for merges).
  const revisions = commit.parents.length > 1 ? [`${hash}^1`, hash] : [hash];
  const [msgResult, diffResult] = await Promise.all([
    msgProc,
    runGit(
      repoPath,
      ["diff-tree", "--root", "--no-commit-id", "-r", "--raw", "--numstat", "-z", ...revisions, "--"],
      signal,
    ),
  ]);
  if (signal?.aborted) return null;
  // A failed read is an error, not a commit without a message or files.
  const failed = [msgResult, diffResult].find(result => result.exitCode !== 0);
  if (failed) throw new Error(failed.stderr.trim() || "git could not read the commit");

  const fullMessage = msgResult.stdout;
  const files = parseDiffTreeOutput(diffResult.stdout);

  const lines = fullMessage.trim().split("\n");

  return {
    ...commit,
    body: lines.slice(1).join("\n").trim(),
    files,
  };
}

export async function getCurrentBranch(repoPath: string, signal?: AbortSignal): Promise<string> {
  const { stdout, exitCode } = await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"], signal);
  if (exitCode !== 0) return "";
  return stdout.trim();
}

/** Resolve any path inside a repo to its git top-level directory. */
export async function getRepoRoot(repoPath: string, signal?: AbortSignal): Promise<string | null> {
  const { stdout, exitCode } = await runGit(repoPath, ["rev-parse", "--show-toplevel"], signal);
  if (exitCode !== 0) return null;
  const root = stdout.trim();
  return root || null;
}

export async function getRemoteUrl(repoPath: string, signal?: AbortSignal): Promise<string> {
  try {
    // Try "origin" first (most common), then fall back to the first available remote
    const { stdout, exitCode } = await runGit(repoPath, ["remote", "get-url", "origin"], signal);
    if (exitCode === 0 && stdout.trim()) return stdout.trim();

    // Fallback: pick the first remote name and get its URL
    const remoteNames = await getRemoteNames(repoPath, signal);
    for (const name of remoteNames) {
      const result = await runGit(repoPath, ["remote", "get-url", name], signal);
      if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim();
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Check whether the `git` binary is available on PATH.
 * Distinguishes "git not installed" from "not a git repo".
 */
export async function isGitAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "--version"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return (proc.exitCode ?? 1) === 0;
  } catch {
    // ENOENT — git binary not found on PATH
    return false;
  }
}

/**
 * Return the set of commit hashes that touch the given pathspec.
 * Runs `git log --format=%H [all branches | branch] -- <path>` to get the full list
 * of hashes matching the path, without loading commit metadata.
 *
 * Used for display-level path filtering: the set is stored in state and used
 * to dim non-matching rows while keeping the full graph topology intact.
 */
export async function getPathMatchingHashes(
  repoPath: string,
  pathspec: string,
  options: { branch?: string; all?: boolean } = {},
  signal?: AbortSignal,
): Promise<Set<string>> {
  const args = ["log", "--format=%H"];

  if (options.all) {
    args.push(...ALL_BRANCH_REVISIONS);
  } else if (options.branch) {
    args.push(options.branch);
  }

  args.push("--", pathspec);

  const { stdout, exitCode } = await runGit(repoPath, args, signal);
  if (exitCode !== 0) return new Set();

  const hashes = new Set<string>();
  for (const line of stdout.trim().split("\n")) {
    const h = line.trim();
    if (h) hashes.add(h);
  }
  return hashes;
}

export async function isGitRepo(path: string): Promise<boolean> {
  const { exitCode } = await runGit(path, ["rev-parse", "--is-inside-work-tree"]);
  return exitCode === 0;
}

/**
 * Fetch from all remotes, pruning deleted remote branches.
 * This is the only git operation in codepulse that updates local remote refs.
 */
export async function fetchRemote(repoPath: string): Promise<{ ok: boolean; error?: string }> {
  const { stderr, exitCode } = await runGit(repoPath, ["fetch", "--all", "--prune"]);

  if (exitCode !== 0) {
    if (stderr.trim()) debugError("Git", stderr.trim());
    return { ok: false, error: classifyGitFailure(stderr) };
  }
  return { ok: true };
}

/**
 * Fetches one GitHub pull request's commits from the remote GitHub is read from (origin, else the first remote): its
 * head (`refs/pull/N/head`, which GitHub keeps for a fork's too) and its target branch, into that remote's branch. No
 * local branch moves. True when either arrived.
 */
export async function fetchPullRequest(
  repoPath: string,
  number: number,
  baseRef: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!Number.isSafeInteger(number) || number <= 0) return false;
  const remotes = await getRemoteNames(repoPath, signal);
  const remote = remotes.has("origin") ? "origin" : [...remotes][0];
  if (!remote) return false;
  const specs = [`refs/pull/${number}/head`];
  // The target's name is GitHub's: only a valid branch name goes into a refspec.
  if (baseRef && (await runGit(repoPath, ["check-ref-format", `refs/heads/${baseRef}`], signal)).exitCode === 0)
    specs.push(`+refs/heads/${baseRef}:refs/remotes/${remote}/${baseRef}`);
  let fetched = false;
  // One at a time: one that is gone (a deleted target) doesn't keep the other out.
  for (const spec of specs) {
    const { exitCode, stderr } = await runGit(repoPath, ["fetch", "--no-tags", remote, spec], signal);
    if (exitCode === 0) fetched = true;
    else if (stderr.trim()) debugError("Git", stderr.trim());
  }
  return fetched;
}

/**
 * Moves each local branch that is only behind its remote branch up to it, like `git pull --ff-only`, after a fetch.
 * The checked-out branch moves with its files (`git merge --ff-only`), and only while no tracked file has changes.
 * Other branches move with `git update-ref`, unless another worktree has them checked out. Nothing is merged or
 * rebased, so a branch with commits of its own stays.
 */
export async function fastForwardBranches(repoPath: string): Promise<FastForwardResult> {
  const result: FastForwardResult = { moved: [], skipped: [] };
  const { stdout, exitCode } = await runGit(repoPath, [
    "for-each-ref",
    `--format=%(HEAD)${RS}%(refname)${RS}%(refname:short)${RS}%(objectname)${RS}%(upstream)${RS}%(upstream:trackshort)`,
    "refs/heads/",
  ]);
  if (exitCode !== 0) return result;
  const branches = stdout
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [head, ref = "", name = "", sha = "", upstream = "", track = ""] = line.split(RS);
      return { current: head === "*", ref, name, sha, upstream, track };
    })
    .filter(branch => branch.upstream && (branch.track === "<" || branch.track === "<>"));
  if (branches.length === 0) return result;

  const worktrees = await runGit(repoPath, ["worktree", "list", "--porcelain"]);
  const checkedOut = new Set(
    worktrees.stdout
      .split("\n")
      .filter(line => line.startsWith("branch "))
      .map(line => line.slice("branch ".length)),
  );

  for (const branch of branches) {
    if (branch.track === "<>") {
      result.skipped.push({ branch: branch.name, reason: "diverged" });
      continue;
    }
    if (!branch.current && checkedOut.has(branch.ref)) {
      result.skipped.push({ branch: branch.name, reason: "other-worktree" });
      continue;
    }
    const count = await runGit(repoPath, ["rev-list", "--count", `${branch.ref}..${branch.upstream}`]);
    const commits = Number.parseInt(count.stdout.trim(), 10) || 0;
    if (branch.current) {
      const status = await runGit(repoPath, ["status", "--porcelain", "--untracked-files=no"]);
      if (status.exitCode !== 0 || status.stdout.trim()) {
        result.skipped.push({ branch: branch.name, reason: "local-changes" });
        continue;
      }
      // Git overwrites ignored files by default: a file the upstream starts tracking (a local `.env`) must stay.
      const merge = await runGit(repoPath, ["merge", "--ff-only", "--no-overwrite-ignore", "--quiet", branch.upstream]);
      if (merge.exitCode !== 0) {
        const detail = merge.stderr.trim();
        if (detail) debugError("Git", detail);
        if (detail.includes("untracked working tree files would be overwritten")) {
          const files = detail
            .split("\n")
            .filter(line => line.startsWith("\t"))
            .map(line => line.trim());
          result.skipped.push({ branch: branch.name, reason: "untracked", files });
          continue;
        }
        const first = detail.split("\n").find(line => line.trim()) ?? "Git refused the fast-forward";
        result.skipped.push({ branch: branch.name, reason: "failed", detail: first.replace(/^(error|fatal): /, "") });
        continue;
      }
    } else {
      const target = await runGit(repoPath, ["rev-parse", "--verify", `${branch.upstream}^{commit}`]);
      // The old value makes it a no-op if the branch moved since it was read.
      const update = await runGit(repoPath, [
        "update-ref",
        "-m",
        "codepulse: fast-forward",
        branch.ref,
        target.stdout.trim(),
        branch.sha,
      ]);
      if (target.exitCode !== 0 || update.exitCode !== 0) {
        const detail = (update.stderr || target.stderr).trim();
        if (detail) debugError("Git", detail);
        result.skipped.push({
          branch: branch.name,
          reason: "failed",
          detail: (detail.split("\n")[0] ?? "").replace(/^(error|fatal): /, "") || "Git refused the fast-forward",
        });
        continue;
      }
    }
    result.moved.push({ branch: branch.name, commits });
  }
  return result;
}

/**
 * Get the last fetch time by reading the mtime of FETCH_HEAD.
 * Returns null if the file doesn't exist (never fetched).
 */
export async function getLastFetchTime(repoPath: string): Promise<Date | null> {
  try {
    const { stdout, exitCode } = await runGit(repoPath, ["rev-parse", "--git-dir"]);
    if (exitCode !== 0) return null;

    const gitDir = stdout.trim();
    // git rev-parse --git-dir returns a relative path for normal repos
    // but an absolute path for linked worktrees — handle both
    const fetchHeadPath = resolve(repoPath, gitDir, "FETCH_HEAD");
    const file = Bun.file(fetchHeadPath);
    const exists = await file.exists();
    if (!exists) return null;

    // Bun.file().lastModified returns a unix timestamp in ms
    return new Date(file.lastModified);
  } catch {
    return null;
  }
}
