import type { Commit, Branch, FileChange, CommitDetail, RefInfo } from "./types";
import { DEFAULT_MAX_COUNT } from "../constants";

/** ASCII Record Separator — safe delimiter that cannot appear in commit fields. */
const RS = "\x1e";
const GIT_LOG_FORMAT = `%H${RS}%h${RS}%P${RS}%D${RS}%s${RS}%an${RS}%ae${RS}%aI${RS}%cn${RS}%ce${RS}%cI`;

/** Shared helper to run a git command and capture its output. */
async function runGit(
  repoPath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
}

/** Fetch the list of configured remote names (e.g. ["origin", "upstream"]). */
async function getRemoteNames(repoPath: string): Promise<Set<string>> {
  const { stdout, exitCode } = await runGit(repoPath, ["remote"]);
  if (exitCode !== 0) return new Set();
  return new Set(
    stdout
      .trim()
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean)
  );
}

function parseRefs(refString: string, remoteNames: Set<string>): RefInfo[] {
  if (!refString.trim()) return [];
  return refString.split(",").map((ref) => {
    ref = ref.trim();
    let isCurrent = false;
    if (ref.startsWith("HEAD -> ")) {
      ref = ref.replace("HEAD -> ", "");
      isCurrent = true;
    }
    if (ref === "HEAD") {
      return { name: "HEAD", type: "head" as const, isCurrent: true };
    }
    if (ref.startsWith("tag: ")) {
      return {
        name: ref.replace("tag: ", ""),
        type: "tag" as const,
        isCurrent: false,
      };
    }
    if (ref.includes("/")) {
      const isRemote =
        ref.startsWith("refs/remotes/") ||
        [...remoteNames].some((r) => ref.startsWith(`${r}/`));
      if (isRemote) {
        return {
          name: ref,
          type: "remote" as const,
          isCurrent: false,
        };
      }
    }
    return { name: ref, type: "branch" as const, isCurrent };
  });
}

function parseCommitLine(line: string, remoteNames: Set<string>): Commit | null {
  const parts = line.split(RS);
  if (parts.length < 11) return null;

  const [hash, shortHash, parentsStr, refsStr, subject, author, authorEmail, authorDate, committer, committerEmail, commitDate] = parts;
  const parents = parentsStr.trim() ? parentsStr.trim().split(" ") : [];
  const refs = parseRefs(refsStr, remoteNames);

  return {
    hash,
    shortHash: shortHash.slice(0, 8),
    parents,
    message: subject,
    subject,
    body: "",
    author,
    authorEmail,
    authorDate,
    committer,
    committerEmail,
    commitDate,
    refs,
  };
}

export async function getCommits(
  repoPath: string,
  options: {
    maxCount?: number;
    branch?: string;
    all?: boolean;
  } = {}
): Promise<Commit[]> {
  const args = [
    "log",
    "--topo-order",
    `--format=${GIT_LOG_FORMAT}`,
    `--max-count=${options.maxCount ?? DEFAULT_MAX_COUNT}`,
  ];

  if (options.all) {
    args.push("--all");
  } else if (options.branch) {
    // Use "--" to prevent branch names starting with "-" being interpreted as flags
    args.push("--", options.branch);
  }

  const [logResult, remoteNames] = await Promise.all([
    runGit(repoPath, args),
    getRemoteNames(repoPath),
  ]);

  const { stdout, stderr, exitCode } = logResult;

  if (exitCode !== 0) {
    throw new Error(`git log failed: ${stderr}`);
  }

  const commits: Commit[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const commit = parseCommitLine(line, remoteNames);
    if (commit) commits.push(commit);
  }

  return commits;
}

export async function getBranches(repoPath: string): Promise<Branch[]> {
  const [branchResult, remoteNames] = await Promise.all([
    runGit(repoPath, [
      "branch", "-a", `--format=%(HEAD)${RS}%(refname:short)${RS}%(objectname:short)`,
    ]),
    getRemoteNames(repoPath),
  ]);

  if (branchResult.exitCode !== 0) return [];

  return branchResult.stdout
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [head, name, lastCommitHash] = line.split(RS);
      const trimmedName = name.trim();
      const isRemote =
        trimmedName.includes("remotes/") ||
        [...remoteNames].some((r) => trimmedName.startsWith(`${r}/`));
      return {
        name: trimmedName,
        isCurrent: head.trim() === "*",
        isRemote,
        lastCommitHash: lastCommitHash?.trim() ?? "",
      };
    });
}

export async function getCommitDetail(
  repoPath: string,
  hash: string,
  existingCommit?: Commit
): Promise<CommitDetail | null> {
  // Get full commit message
  const msgProc = runGit(repoPath, ["log", "-1", "--format=%B", hash]);

  // Get file changes with stats
  const statProc = runGit(repoPath, [
    "diff-tree", "--no-commit-id", "-r", "--numstat", hash,
  ]);

  // Get file changes with status letters (A/M/D/R/C/T)
  const statusProc = runGit(repoPath, [
    "diff-tree", "--no-commit-id", "-r", "--name-status", hash,
  ]);

  // Get the diff
  const diffProc = runGit(repoPath, [
    "diff-tree", "-p", "--no-commit-id", hash,
  ]);

  const [msgResult, statResult, statusResult, diffResult] = await Promise.all([
    msgProc, statProc, statusProc, diffProc,
  ]);

  const fullMessage = msgResult.stdout;
  const statOutput = statResult.stdout;
  const diff = diffResult.stdout;

  // Build a map from file path → status letter
  const statusMap = new Map<string, string>();
  for (const line of statusResult.stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const [statusCode, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t");
    // Status codes like R100, C080 — extract just the leading letter
    statusMap.set(filePath, (statusCode?.[0] ?? "M") as string);
  }

  const files: FileChange[] = statOutput
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [additions, deletions, ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t");
      const status = (statusMap.get(filePath) ?? "M") as FileChange["status"];
      return {
        path: filePath,
        additions: additions === "-" ? 0 : parseInt(additions, 10),
        deletions: deletions === "-" ? 0 : parseInt(deletions, 10),
        status,
      };
    });

  // Use existing commit info if provided (avoids a redundant git log subprocess)
  let commit: Commit;
  if (existingCommit) {
    commit = existingCommit;
  } else {
    const commits = await getCommits(repoPath, { maxCount: 1, branch: hash });
    if (commits.length === 0) return null;
    commit = commits[0];
  }

  const lines = fullMessage.trim().split("\n");

  return {
    ...commit,
    body: lines.slice(1).join("\n").trim(),
    files,
    diff,
  };
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await runGit(repoPath, [
    "rev-parse", "--abbrev-ref", "HEAD",
  ]);
  return stdout.trim();
}

export async function getRemoteUrl(repoPath: string): Promise<string> {
  try {
    const { stdout, exitCode } = await runGit(repoPath, [
      "remote", "get-url", "origin",
    ]);
    if (exitCode !== 0) return "";
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function isGitRepo(path: string): Promise<boolean> {
  const { exitCode } = await runGit(path, [
    "rev-parse", "--is-inside-work-tree",
  ]);
  return exitCode === 0;
}

/**
 * Fetch from all remotes, pruning deleted remote branches.
 * This is the only network operation in gittree — safe and read-only.
 */
export async function fetchRemote(
  repoPath: string
): Promise<{ ok: boolean; error?: string }> {
  const { stderr, exitCode } = await runGit(repoPath, [
    "fetch", "--all", "--prune",
  ]);

  if (exitCode !== 0) {
    return { ok: false, error: stderr.trim() };
  }
  return { ok: true };
}

/**
 * Get the last fetch time by reading the mtime of FETCH_HEAD.
 * Returns null if the file doesn't exist (never fetched).
 */
export async function getLastFetchTime(
  repoPath: string
): Promise<Date | null> {
  try {
    const { stdout, exitCode } = await runGit(repoPath, [
      "rev-parse", "--git-dir",
    ]);
    if (exitCode !== 0) return null;

    const gitDir = stdout.trim();
    const fetchHeadPath = `${repoPath}/${gitDir}/FETCH_HEAD`;
    const file = Bun.file(fetchHeadPath);
    const exists = await file.exists();
    if (!exists) return null;

    // Bun.file().lastModified returns a unix timestamp in ms
    return new Date(file.lastModified);
  } catch {
    return null;
  }
}
