import { runGit } from "./repo-git";
import type { FileChange, UncommittedDetail } from "./types";

export interface WorkingTreeStatus {
  staged: number;
  unstaged: number;
  untracked: number;
}

/**
 * @internal Exported for testing. Parse `git status --porcelain=v1` output
 * into a WorkingTreeStatus. Returns null if the working tree is clean.
 */
export function parseStatusPorcelain(output: string): WorkingTreeStatus | null {
  let staged = 0,
    unstaged = 0,
    untracked = 0;
  for (const line of output.split("\n")) {
    if (!line || line.length < 2) continue;
    const x = line[0]; // index (staged) status
    const y = line[1]; // worktree (unstaged) status
    if (x === "?" && y === "?") {
      untracked++;
      continue;
    }
    if (x !== " " && x !== "?") staged++;
    if (y !== " " && y !== "?") unstaged++;
  }
  if (staged === 0 && unstaged === 0 && untracked === 0) return null;
  return { staged, unstaged, untracked };
}

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
 * @internal Exported for testing. Parse combined `git diff-tree --raw --numstat` output
 * into FileChange[]. Both getStashFiles and getCommitDetail use this format.
 *
 * Raw lines start with ":" (e.g. ":100644 100644 ... M\tfile.ts") — they provide status.
 * Numstat lines are "adds\tdels\tpath" — they provide +/- stats.
 */
export function parseDiffTreeOutput(output: string): FileChange[] {
  const statusMap = new Map<string, string>();
  const statMap = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.split("\n")) {
    if (!line) continue;
    if (line.startsWith(":")) {
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) continue;
      const meta = line.slice(0, tabIdx);
      const pathPart = line.slice(tabIdx + 1);
      const statusCode = meta.split(" ").pop() ?? "M";
      const filePath = pathPart.split("\t")[0];
      statusMap.set(filePath, statusCode[0]);
    } else if (line.includes("\t")) {
      const [additions, deletions, ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t");
      statMap.set(filePath, {
        additions: additions === "-" ? 0 : parseInt(additions, 10),
        deletions: deletions === "-" ? 0 : parseInt(deletions, 10),
      });
    }
  }

  const files: FileChange[] = [];
  for (const [filePath, stat] of statMap) {
    files.push({
      path: filePath,
      additions: stat.additions,
      deletions: stat.deletions,
      status: (statusMap.get(filePath) ?? "M") as FileChange["status"],
    });
  }

  return files;
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
  const { stdout, exitCode } = await runGit(repoPath, ["diff", "--cached", "--raw", "--numstat", "--"], signal);
  if (exitCode !== 0 || !stdout.trim()) return [];
  return parseDiffTreeOutput(stdout);
}

/**
 * Fetch unstaged file changes (working tree vs index).
 * Uses `git diff --raw --numstat` (no HEAD, no --cached) to get modified tracked files.
 */
export async function getUnstagedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  const { stdout, exitCode } = await runGit(repoPath, ["diff", "--raw", "--numstat", "--"], signal);
  if (exitCode !== 0 || !stdout.trim()) return [];
  return parseDiffTreeOutput(stdout);
}

/**
 * Fetch untracked files (files not tracked by git, excluding ignored).
 * Returns FileChange[] with status "A" and zero stats (no diff available).
 */
export async function getUntrackedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  const { stdout, exitCode } = await runGit(repoPath, ["ls-files", "--others", "--exclude-standard"], signal);
  if (exitCode !== 0 || !stdout.trim()) return [];

  const files: FileChange[] = [];
  for (const line of stdout.split("\n")) {
    const path = line.trim();
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
