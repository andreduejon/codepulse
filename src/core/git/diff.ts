/** Diffs, file contents and blame, read from Git's output, with the limits that keep a large file from filling memory. */
import type { BlameLine, FileContent, FileDiff } from "./types";

/** Maximum number of diff lines before truncation. */
const MAX_DIFF_LINES = 5000;

/** Byte cap for loading file content into memory; far more than MAX_DIFF_LINES of typical text. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function bytesAreBinary(view: Uint8Array): boolean {
  const checkLen = Math.min(view.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (view[i] === 0) return true;
  }
  return false;
}

/** `cut` = content was stopped at MAX_FILE_BYTES, so its last line may be partial. */
export function textToFileContent(filePath: string, content: string, cut = false): FileContent {
  const lines = content.split("\n");
  if (cut || (lines.length > 0 && lines[lines.length - 1] === "")) lines.pop();
  const truncated = cut || lines.length > MAX_DIFF_LINES;
  return {
    filePath,
    lines: truncated ? lines.slice(0, MAX_DIFF_LINES) : lines,
    isBinary: false,
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * @internal Exported for testing.
 * Parse unified diff output (`git diff -p`) for a single file into a structured FileDiff.
 * `cut` = output was stopped at MAX_FILE_BYTES, so its last line may be partial.
 */
export function parseUnifiedDiff(stdout: string, filePath: string, cut = false): FileDiff {
  if (!stdout.trim()) {
    return { filePath, hunks: [], isBinary: false };
  }

  // Detect binary files
  if (stdout.includes("Binary files") && stdout.includes("differ")) {
    return { filePath, hunks: [], isBinary: true };
  }

  const lines = stdout.split("\n");
  if (cut) lines.pop();
  const hunks: import("./types").DiffHunk[] = [];
  let currentHunk: import("./types").DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let totalLines = 0;
  let truncated = cut;

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
