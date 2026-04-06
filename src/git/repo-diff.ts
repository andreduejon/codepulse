import { join } from "node:path";
import { runGit } from "./repo-git";
import type { BlameLine, DiffSource, FileDiff } from "./types";

/** Maximum number of diff lines before truncation. */
const MAX_DIFF_LINES = 5000;

/**
 * @internal Exported for testing.
 * Parse unified diff output (`git diff -p`) for a single file into a structured FileDiff.
 */
export function parseUnifiedDiff(stdout: string, filePath: string): FileDiff {
  if (!stdout.trim()) {
    return { filePath, hunks: [], isBinary: false };
  }

  // Detect binary files
  if (stdout.includes("Binary files") && stdout.includes("differ")) {
    return { filePath, hunks: [], isBinary: true };
  }

  const lines = stdout.split("\n");
  const hunks: import("./types").DiffHunk[] = [];
  let currentHunk: import("./types").DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let totalLines = 0;
  let truncated = false;

  for (const line of lines) {
    // Once we hit the line limit, stop parsing
    if (totalLines >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }

    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/);
    if (hunkMatch) {
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
        header: line,
        lines: [],
      };
      hunks.push(currentHunk);
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }

    // Skip diff header lines (diff --git, index, ---, +++)
    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        newLineNo: newLine,
      });
      newLine++;
      totalLines++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "delete",
        content: line.slice(1),
        oldLineNo: oldLine,
      });
      oldLine++;
      totalLines++;
    } else if (line.startsWith(" ")) {
      // Context line
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNo: oldLine,
        newLineNo: newLine,
      });
      oldLine++;
      newLine++;
      totalLines++;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — skip
    }
  }

  return {
    filePath,
    hunks,
    isBinary: false,
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * @internal Exported for testing.
 * Parse `git blame --porcelain` output into structured BlameLine[].
 */
export function parseBlameOutput(stdout: string): BlameLine[] {
  if (!stdout.trim()) return [];

  const result: BlameLine[] = [];
  const lines = stdout.split("\n");
  let i = 0;

  while (i < lines.length) {
    const headerLine = lines[i];
    // Blame header: <40-char hash> <orig-line> <final-line> [<num-lines>]
    const headerMatch = headerLine.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (!headerMatch) {
      i++;
      continue;
    }

    const commitHash = headerMatch[1];
    const lineNo = parseInt(headerMatch[2], 10);
    let author = "";
    i++;

    // Read key-value pairs until the content line (starts with \t)
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const kv = lines[i];
      if (kv.startsWith("author ")) {
        author = kv.slice(7);
      }
      i++;
    }

    // The content line starts with a tab
    let content = "";
    if (i < lines.length && lines[i].startsWith("\t")) {
      content = lines[i].slice(1);
      i++;
    }

    result.push({
      commitHash,
      shortHash: commitHash.slice(0, 7),
      author,
      lineNo,
      content,
    });
  }

  return result;
}

/**
 * Fetch the unified diff for a specific file.
 * The git command varies based on the diff source:
 * - commit: `git diff-tree -p <hash>^! -- <path>` (or just `<hash>` for root commits)
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
    case "commit": {
      // Check if this is a root commit (no parents) by using just the hash
      // For non-root commits, use ^! which means "commit vs its first parent"
      args = ["diff-tree", "-p", "--no-commit-id", `${commitHash}^!`, "--", filePath];
      break;
    }
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

  const { stdout, exitCode, stderr } = await runGit(repoPath, args, signal);

  // Root commits: ^! fails, fall back to show <hash> -- <path>
  if (exitCode !== 0 && source === "commit" && stderr.includes("unknown revision")) {
    const fallback = await runGit(
      repoPath,
      ["diff-tree", "-p", "--no-commit-id", "--root", commitHash, "--", filePath],
      signal,
    );
    if (fallback.exitCode === 0) {
      return parseUnifiedDiff(fallback.stdout, filePath);
    }
  }

  if (exitCode !== 0 || !stdout.trim()) {
    return { filePath, hunks: [], isBinary: false };
  }

  return parseUnifiedDiff(stdout, filePath);
}

/** Read an untracked file and present as an all-added diff. */
async function getUntrackedFileDiff(repoPath: string, filePath: string): Promise<FileDiff> {
  try {
    const fullPath = join(repoPath, filePath);
    const file = Bun.file(fullPath);
    const exists = await file.exists();
    if (!exists) return { filePath, hunks: [], isBinary: false };

    // Check if binary by looking at the first chunk
    const bytes = await file.arrayBuffer();
    const view = new Uint8Array(bytes);
    // Simple binary detection: check for null bytes in the first 8KB
    const checkLen = Math.min(view.length, 8192);
    for (let i = 0; i < checkLen; i++) {
      if (view[i] === 0) {
        return { filePath, hunks: [], isBinary: true };
      }
    }

    const content = new TextDecoder().decode(view);
    const lines = content.split("\n");
    // Remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    const truncated = lines.length > MAX_DIFF_LINES;
    const displayLines = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;

    const diffLines: import("./types").DiffLine[] = displayLines.map((line, idx) => ({
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
      ...(truncated ? { truncated: true } : {}),
    };
  } catch {
    return { filePath, hunks: [], isBinary: false };
  }
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

  const { stdout, exitCode } = await runGit(repoPath, ["blame", "--porcelain", ref, "--", filePath], signal);

  if (exitCode !== 0 || !stdout.trim()) return [];
  return parseBlameOutput(stdout);
}
