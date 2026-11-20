import { parseDiffTreeOutput, parseStatusPorcelain, type WorkingTreeStatus } from "../../core/git/status";
import type { FileChange, UncommittedDetail } from "../../core/git/types";
import { runGit } from "./repo-git";

/** Git saying a revision doesn't exist (a stash's third parent without -u), not that it couldn't read one. */
export const NO_REVISION = /unknown revision|bad revision|ambiguous argument/i;

/** A read's output; a failed one (not cancelled) is an error, not a clean working tree. */
function succeeded(result: { stdout: string; exitCode: number; stderr: string }, signal?: AbortSignal): string {
  if (result.exitCode !== 0 && !signal?.aborted)
    throw new Error(result.stderr.trim() || "git could not read the working tree");
  return result.stdout;
}

/**
 * Check if the working tree has uncommitted changes.
 * Returns null if the tree is clean (no staged, unstaged, or untracked files).
 */
export async function getWorkingTreeStatus(repoPath: string, signal?: AbortSignal): Promise<WorkingTreeStatus | null> {
  const result = await runGit(repoPath, ["status", "--porcelain=v1"], signal);
  const stdout = succeeded(result, signal);
  if (!stdout.trim()) return null;
  return parseStatusPorcelain(stdout);
}

/**
 * Fetch file changes for a specific stash entry.
 * Uses `git diff-tree` against the stash's parent to get the diff.
 * Returns the same FileChange[] format as CommitDetail.files.
 */
export async function getStashFiles(repoPath: string, stashHash: string, signal?: AbortSignal): Promise<FileChange[]> {
  // Stash commits are merges (2-3 parents). diff-tree on a merge commit
  // with just one revision produces no output. We must explicitly diff
  // against the first parent (the HEAD at time of stash).
  // `git stash -u` keeps the untracked files in a third parent of their own: each one is added.
  const [tracked, untracked] = await Promise.all([
    runGit(
      repoPath,
      ["diff-tree", "--no-commit-id", "-r", "--raw", "--numstat", "-z", `${stashHash}^1`, stashHash, "--"],
      signal,
    ),
    runGit(
      repoPath,
      ["diff-tree", "--root", "--no-commit-id", "-r", "--raw", "--numstat", "-z", `${stashHash}^3`, "--"],
      signal,
    ),
  ]);
  // The untracked part is optional (a stash without -u has no third parent); a failure beside that is one.
  return [
    ...parseDiffTreeOutput(succeeded(tracked, signal)),
    ...(NO_REVISION.test(untracked.stderr) ? [] : parseDiffTreeOutput(succeeded(untracked, signal))),
  ];
}

/** What `head` changed since it left `base`: the files between their merge base and `head`, and that base. */
export async function getRangeFiles(
  repoPath: string,
  base: string,
  head: string,
  signal?: AbortSignal,
): Promise<{ mergeBase: string; files: FileChange[] } | null> {
  // Names from GitHub: one that starts with `-` would be read as an option.
  if (base.startsWith("-") || head.startsWith("-")) return null;
  const found = await runGit(repoPath, ["merge-base", base, head], signal);
  const mergeBase = found.stdout.trim();
  if (found.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(mergeBase)) return null;
  const { stdout, exitCode } = await runGit(
    repoPath,
    ["diff-tree", "--no-commit-id", "-r", "--raw", "--numstat", "-z", mergeBase, head, "--"],
    signal,
  );
  if (exitCode !== 0) return null;
  return { mergeBase, files: stdout.trim() ? parseDiffTreeOutput(stdout) : [] };
}

/**
 * Fetch staged file changes (index vs HEAD).
 * Uses `git diff --cached --raw --numstat` to get files staged for commit.
 */
export async function getStagedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  // --no-renames: numstat would print "dir/{old => new}", which is not a real path.
  const result = await runGit(repoPath, ["diff", "--cached", "--no-renames", "--raw", "--numstat", "-z", "--"], signal);
  return parseDiffTreeOutput(succeeded(result, signal));
}

/**
 * Fetch unstaged file changes (working tree vs index).
 * Uses `git diff --raw --numstat` (no HEAD, no --cached) to get modified tracked files.
 */
export async function getUnstagedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  const result = await runGit(repoPath, ["diff", "--no-renames", "--raw", "--numstat", "-z", "--"], signal);
  return parseDiffTreeOutput(succeeded(result, signal));
}

/**
 * Fetch untracked files (files not tracked by git, excluding ignored).
 * Returns FileChange[] with status "A" and zero stats (no diff available).
 */
export async function getUntrackedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  // -z: exact NUL-separated names (no trimming, quoting, or newline splitting).
  const result = await runGit(repoPath, ["ls-files", "-z", "--others", "--exclude-standard"], signal);
  const stdout = succeeded(result, signal);
  if (!stdout) return [];

  const files: FileChange[] = [];
  for (const path of stdout.split("\0")) {
    if (!path) continue;
    files.push({ path, additions: 0, deletions: 0, status: "A" });
  }
  return files;
}

/**
 * Load all three uncommitted file categories in parallel.
 * Returns an UncommittedDetail with staged, unstaged, and untracked file lists.
 */
export async function getUncommittedDetail(repoPath: string, signal?: AbortSignal): Promise<UncommittedDetail> {
  const [staged, unstaged, untracked] = await Promise.all([
    getStagedFiles(repoPath, signal),
    getUnstagedFiles(repoPath, signal),
    getUntrackedFiles(repoPath, signal),
  ]);
  return { staged, unstaged, untracked };
}
