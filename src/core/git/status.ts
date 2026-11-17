/** The working tree's state and the files of a commit or stash, read from Git's output. */
import type { FileChange } from "./types";

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
