import { join } from "node:path";
import {
  bytesAreBinary,
  MAX_FILE_BYTES,
  parseBlameOutput,
  parseUnifiedDiff,
  textToFileContent,
} from "../../core/git/diff";
import type { BlameLine, DiffSource, FileContent, FileDiff } from "../../core/git/types";
import { runGit } from "./repo-git";

/** Read at most MAX_FILE_BYTES of a working-tree file; null when it does not exist. */
async function readWorktreeFile(repoPath: string, filePath: string): Promise<FileContent | null> {
  const file = Bun.file(join(repoPath, filePath));
  if (!(await file.exists())) return null;
  const cut = file.size > MAX_FILE_BYTES;
  const view = new Uint8Array(await (cut ? file.slice(0, MAX_FILE_BYTES) : file).arrayBuffer());
  if (bytesAreBinary(view)) return { filePath, lines: [], isBinary: true };
  return textToFileContent(filePath, new TextDecoder().decode(view), cut);
}

/**
 * Fetch the unified diff for a specific file.
 * The git command varies based on the diff source:
 * - commit: `git diff-tree -p <hash>^1 <hash> -- <path>` (or `--root <hash>` for root commits)
 * - stash: `git diff -p <hash>^1 <hash> -- <path>`
 * - staged: `git diff --cached -p -- <path>`
 * - unstaged: `git diff -p -- <path>`
 * - untracked: reads the file directly and presents as all-added
 */
export async function getFileDiff(
  repoPath: string,
  commitHash: string,
  filePath: string,
  source: DiffSource,
  signal?: AbortSignal,
): Promise<FileDiff> {
  // Untracked files have no git diff — read the file and synthesize an all-added diff
  if (source === "untracked") {
    return getUntrackedFileDiff(repoPath, filePath);
  }

  let args: string[];
  switch (source) {
    case "commit":
      // First parent, like the commit's file list (merges included); root commits fall back below.
      args = ["diff-tree", "-p", "--no-commit-id", `${commitHash}^1`, commitHash, "--", filePath];
      break;
    case "stash":
      args = ["diff", "-p", `${commitHash}^1`, commitHash, "--", filePath];
      break;
    case "staged":
      args = ["diff", "--cached", "-p", "--", filePath];
      break;
    case "unstaged":
      args = ["diff", "-p", "--", filePath];
      break;
  }

  let result = await runGit(repoPath, args, signal, MAX_FILE_BYTES);

  // Root commits have no ^1: diff against the empty tree instead.
  if (result.exitCode !== 0 && source === "commit" && /bad revision|unknown revision/.test(result.stderr)) {
    result = await runGit(
      repoPath,
      ["diff-tree", "-p", "--no-commit-id", "--root", commitHash, "--", filePath],
      signal,
      MAX_FILE_BYTES,
    );
  }

  if ((result.exitCode !== 0 && !result.truncated) || !result.stdout.trim()) {
    return { filePath, hunks: [], isBinary: false };
  }

  return parseUnifiedDiff(result.stdout, filePath, result.truncated);
}

/** Read an untracked file and present as an all-added diff. */
async function getUntrackedFileDiff(repoPath: string, filePath: string): Promise<FileDiff> {
  try {
    const content = await readWorktreeFile(repoPath, filePath);
    if (!content || content.isBinary) return { filePath, hunks: [], isBinary: content?.isBinary ?? false };
    const displayLines = content.lines;

    const diffLines: import("../../core/git/types").DiffLine[] = displayLines.map((line, idx) => ({
      type: "add" as const,
      content: line,
      newLineNo: idx + 1,
    }));

    return {
      filePath,
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: displayLines.length,
          header: `@@ -0,0 +1,${displayLines.length} @@ (new file)`,
          lines: diffLines,
        },
      ],
      isBinary: false,
      ...(content.truncated ? { truncated: true } : {}),
    };
  } catch {
    return { filePath, hunks: [], isBinary: false };
  }
}

/**
 * Fetch full-file content for a diff target.
 * Uses the target/right side of the diff when possible; deleted commit files
 * fall back to the first parent so the removed file can still be inspected.
 */
export async function getFileContent(
  repoPath: string,
  commitHash: string,
  filePath: string,
  source: DiffSource,
  signal?: AbortSignal,
): Promise<FileContent> {
  if (source === "unstaged" || source === "untracked")
    return (await readWorktreeFile(repoPath, filePath)) ?? { filePath, lines: [], isBinary: false };

  const specs = (() => {
    switch (source) {
      case "commit":
        return [`${commitHash}:${filePath}`, `${commitHash}^:${filePath}`];
      case "stash":
        return [`${commitHash}:${filePath}`, `${commitHash}^1:${filePath}`];
      case "staged":
        return [`:${filePath}`];
    }
  })();

  for (const spec of specs) {
    const { stdout, exitCode, stderr, truncated } = await runGit(repoPath, ["show", spec], signal, MAX_FILE_BYTES);
    if (exitCode === 0 || truncated) {
      // Git emits this for binary blobs through stdout; keep behavior conservative.
      if (stdout.includes("\0")) return { filePath, lines: [], isBinary: true };
      return textToFileContent(filePath, stdout, truncated);
    }
    if (stderr.includes("exists on disk, but not in")) continue;
  }

  return { filePath, lines: [], isBinary: false };
}

/**
 * Fetch blame annotations for a specific file.
 * - commit: `git blame --porcelain <hash> -- <path>`
 * - stash/staged/unstaged/untracked: blame against HEAD as approximation
 */
export async function getFileBlame(
  repoPath: string,
  commitHash: string,
  filePath: string,
  source: DiffSource,
  signal?: AbortSignal,
): Promise<BlameLine[]> {
  // For non-commit sources, blame against HEAD
  const ref = source === "commit" ? commitHash : "HEAD";

  const { stdout, exitCode, truncated } = await runGit(
    repoPath,
    ["blame", "--porcelain", ref, "--", filePath],
    signal,
    MAX_FILE_BYTES,
  );

  if ((exitCode !== 0 && !truncated) || !stdout.trim()) return [];
  const lines = parseBlameOutput(stdout);
  // A byte cut can end inside the last entry.
  return truncated ? lines.slice(0, -1) : lines;
}
