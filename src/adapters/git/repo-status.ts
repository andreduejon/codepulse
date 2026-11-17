import { parseDiffTreeOutput, parseStatusPorcelain, type WorkingTreeStatus } from "../../core/git/status";
import type { FileChange, UncommittedDetail } from "../../core/git/types";
import { runGit } from "./repo-git";

/**
 * Check if the working tree has uncommitted changes.
 * Returns null if the tree is clean (no staged, unstaged, or untracked files).
 */
export async function getWorkingTreeStatus(repoPath: string, signal?: AbortSignal): Promise<WorkingTreeStatus | null> {
  const { stdout, exitCode } = await runGit(repoPath, ["status", "--porcelain=v1"], signal);
  if (exitCode !== 0 || !stdout.trim()) return null;
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
  const { stdout, exitCode } = await runGit(
    repoPath,
    ["diff-tree", "--no-commit-id", "-r", "--raw", "--numstat", `${stashHash}^1`, stashHash, "--"],
    signal,
  );

  if (exitCode !== 0 || !stdout.trim()) return [];
  return parseDiffTreeOutput(stdout);
}

/**
 * Fetch staged file changes (index vs HEAD).
 * Uses `git diff --cached --raw --numstat` to get files staged for commit.
 */
export async function getStagedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  // --no-renames: numstat would print "dir/{old => new}", which is not a real path.
  const { stdout, exitCode } = await runGit(
    repoPath,
    ["diff", "--cached", "--no-renames", "--raw", "--numstat", "--"],
    signal,
  );
  if (exitCode !== 0 || !stdout.trim()) return [];
  return parseDiffTreeOutput(stdout);
}

/**
 * Fetch unstaged file changes (working tree vs index).
 * Uses `git diff --raw --numstat` (no HEAD, no --cached) to get modified tracked files.
 */
export async function getUnstagedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  const { stdout, exitCode } = await runGit(repoPath, ["diff", "--no-renames", "--raw", "--numstat", "--"], signal);
  if (exitCode !== 0 || !stdout.trim()) return [];
  return parseDiffTreeOutput(stdout);
}

/**
 * Fetch untracked files (files not tracked by git, excluding ignored).
 * Returns FileChange[] with status "A" and zero stats (no diff available).
 */
export async function getUntrackedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  // -z: exact NUL-separated names (no trimming, quoting, or newline splitting).
  const { stdout, exitCode } = await runGit(repoPath, ["ls-files", "-z", "--others", "--exclude-standard"], signal);
  if (exitCode !== 0 || !stdout) return [];

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
