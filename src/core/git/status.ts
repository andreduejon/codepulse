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
 * @internal Exported for testing. Parse combined `git diff-tree --raw --numstat -z` output (or `git diff`'s) into
 * FileChange[]. Commits, stashes, the working tree and pull requests all read their files this way.
 *
 * With -z every name is exact, NUL-ended and never quoted (a tab, a newline or a quote in it stays as it is):
 * raw entries are ":<modes> <shas> <status>\0<path>\0" (a rename or copy: "\0<old>\0<new>\0"), numstat entries
 * "<adds>\t<dels>\t<path>\0" (a rename or copy: "<adds>\t<dels>\t\0<old>\0<new>\0"). A rename is its new path.
 */
export function parseDiffTreeOutput(output: string): FileChange[] {
  const statusMap = new Map<string, string>();
  const statMap = new Map<string, { additions: number; deletions: number }>();
  const tokens = output.split("\0");
  for (let i = 0; i < tokens.length; ) {
    // Git ends a commit's header line with a newline before the first entry (diff-tree with one commit).
    const token = tokens[i].replace(/^\n+/, "");
    if (token.startsWith(":")) {
      const status = token.split(" ").pop()?.[0] ?? "M";
      const twoPaths = status === "R" || status === "C";
      statusMap.set(tokens[i + (twoPaths ? 2 : 1)] ?? "", status);
      i += twoPaths ? 3 : 2;
    } else if (/^(\d+|-)\t(\d+|-)\t/.test(token)) {
      const [additions, deletions] = token.split("\t");
      const named = token.slice(additions.length + deletions.length + 2);
      const path = named || (tokens[i + 2] ?? "");
      statMap.set(path, {
        additions: additions === "-" ? 0 : parseInt(additions, 10),
        deletions: deletions === "-" ? 0 : parseInt(deletions, 10),
      });
      i += named ? 1 : 3;
    } else i++;
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
