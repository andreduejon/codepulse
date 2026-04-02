import { DEFAULT_MAX_COUNT } from "../constants";
import type {
  BlameLine,
  Branch,
  Commit,
  CommitDetail,
  DiffSource,
  FileChange,
  FileDiff,
  RefInfo,
  TagInfo,
  UncommittedDetail,
} from "./types";

/** ASCII Record Separator — safe delimiter that cannot appear in commit fields. */
export const RS = "\x1e";
const GIT_LOG_FORMAT = `%H${RS}%h${RS}%P${RS}%D${RS}%s${RS}%an${RS}%ae${RS}%aI${RS}%cn${RS}%ce${RS}%cI`;

/** Shared helper to run a git command and capture its output. */
async function runGit(
  repoPath: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Bail out before spawning if already cancelled
  if (signal?.aborted) {
    return { stdout: "", stderr: "aborted", exitCode: 1 };
  }

  const proc = Bun.spawn(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  // If the caller aborts, kill the subprocess immediately
  if (signal) {
    const onAbort = () => {
      try {
        proc.kill();
      } catch {}
    };
    signal.addEventListener("abort", onAbort, { once: true });
    proc.exited.then(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
  }

  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
  } catch {
    // Process was killed — pipes may throw
    return { stdout: "", stderr: "aborted", exitCode: 1 };
  }
}

/** Fetch the list of configured remote names (e.g. ["origin", "upstream"]). */
async function getRemoteNames(repoPath: string, signal?: AbortSignal): Promise<Set<string>> {
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

/** @internal Exported for testing. Parse a git ref decoration string into structured RefInfo[]. */
export function parseRefs(refString: string, remoteNames: Set<string>): RefInfo[] {
  if (!refString.trim()) return [];
  return refString.split(",").map(ref => {
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
    if (ref === "refs/stash" || ref.startsWith("stash@{")) {
      return { name: ref, type: "stash" as const, isCurrent: false };
    }
    if (ref.includes("/")) {
      const isRemote = ref.startsWith("refs/remotes/") || [...remoteNames].some(r => ref.startsWith(`${r}/`));
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

/** @internal Exported for testing. Parse a single git log output line into a Commit. */
export function parseCommitLine(line: string, remoteNames: Set<string>): Commit | null {
  const parts = line.split(RS);
  if (parts.length < 11) return null;

  const [
    hash,
    shortHash,
    parentsStr,
    refsStr,
    subject,
    author,
    authorEmail,
    authorDate,
    committer,
    committerEmail,
    commitDate,
  ] = parts;
  const parents = parentsStr.trim() ? parentsStr.trim().split(" ") : [];
  const refs = parseRefs(refsStr, remoteNames);

  return {
    hash,
    shortHash,
    parents,
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
  } = {},
  signal?: AbortSignal,
): Promise<Commit[]> {
  const args = [
    "log",
    "--topo-order",
    `--format=${GIT_LOG_FORMAT}`,
    `--max-count=${options.maxCount ?? DEFAULT_MAX_COUNT}`,
  ];

  if (options.all) {
    // Exclude stash refs so their internal commits (index, untracked) don't
    // leak into the log.  We inject stash entries separately via getStashList().
    args.push("--exclude=refs/stash*", "--all");
  } else if (options.branch) {
    // Place branch before "--" so git treats it as a revision, not a path.
    // The "--" prevents ambiguity if a file exists with the same name as the branch.
    args.push(options.branch, "--");
  }

  const [logResult, remoteNames] = await Promise.all([
    runGit(repoPath, args, signal),
    getRemoteNames(repoPath, signal),
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

/**
 * @internal Exported for testing. Parse git upstream track string into ahead/behind counts.
 * Input examples: "ahead 3", "behind 2", "ahead 3, behind 2", "" (no tracking).
 */
export function parseTrackInfo(track: string): {
  ahead?: number;
  behind?: number;
} {
  if (!track.trim()) return {};
  const result: { ahead?: number; behind?: number } = {};
  const aheadMatch = track.match(/ahead (\d+)/);
  if (aheadMatch) result.ahead = parseInt(aheadMatch[1], 10);
  const behindMatch = track.match(/behind (\d+)/);
  if (behindMatch) result.behind = parseInt(behindMatch[1], 10);
  return result;
}

export async function getBranches(repoPath: string, signal?: AbortSignal): Promise<Branch[]> {
  const [branchResult, remoteNames] = await Promise.all([
    runGit(
      repoPath,
      [
        "branch",
        "-a",
        `--format=%(HEAD)${RS}%(refname:short)${RS}%(objectname:short)${RS}%(upstream:short)${RS}%(upstream:track,nobracket)${RS}%(symref)`,
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
      const isRemote = trimmedName.includes("remotes/") || [...remoteNames].some(r => trimmedName.startsWith(`${r}/`));

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

/**
 * Fetch details for all tags in the repository.
 * Uses `git for-each-ref refs/tags/` to distinguish annotated from lightweight tags
 * and to retrieve tagger/message info for annotated tags.
 *
 * @internal parseTagLine is exported for testing.
 */
export function parseTagLine(line: string): TagInfo | null {
  const parts = line.split(RS);
  if (parts.length < 5) return null;

  const [refname, objecttype, taggername, taggerdate, contents] = parts;
  const name = refname.replace(/^refs\/tags\//, "");
  if (!name) return null;

  // objecttype is "commit" for lightweight tags, "tag" for annotated tags
  if (objecttype === "tag") {
    return {
      name,
      type: "annotated",
      message: contents.trim() || undefined,
      tagger: taggername.trim() || undefined,
      taggerDate: taggerdate.trim() || undefined,
    };
  }

  return { name, type: "lightweight" };
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

/** Format string for `git stash list`: hash, short hash, first parent, subject, author info, dates. */
const STASH_FORMAT = `%H${RS}%h${RS}%P${RS}%gd${RS}%s${RS}%an${RS}%ae${RS}%aI${RS}%cn${RS}%ce${RS}%cI`;

/**
 * @internal Exported for testing. Parse a single stash list line into a Commit
 * with a synthetic "stash" ref. Returns null for malformed lines.
 *
 * Format fields: hash, shortHash, parents, stashRef (e.g. "stash@{0}"), subject,
 * author, authorEmail, authorDate, committer, committerEmail, commitDate.
 */
export function parseStashEntry(line: string): Commit | null {
  const parts = line.split(RS);
  if (parts.length < 11) return null;

  const [
    hash,
    shortHash,
    parentsStr,
    stashRef,
    subject,
    author,
    authorEmail,
    authorDate,
    committer,
    committerEmail,
    commitDate,
  ] = parts;
  if (!hash?.trim()) return null;

  // Stash commits have 2-3 parents: [0]=HEAD, [1]=index, [2]=untracked (optional).
  // For graph placement we only use parents[0] (the commit the stash was based on).
  const allParents = parentsStr.trim() ? parentsStr.trim().split(" ") : [];
  const graphParent = allParents[0];
  if (!graphParent) return null;

  // Use just the first parent for graph topology — we want a single line to the base commit
  const parents = [graphParent];

  // Use the stash ref (e.g. "stash@{0}") as the label for display in the detail panel
  const label = stashRef || "stash";

  return {
    hash,
    shortHash,
    parents,
    subject,
    body: "",
    author,
    authorEmail,
    authorDate,
    committer,
    committerEmail,
    commitDate,
    refs: [{ name: label, type: "stash" as const, isCurrent: false }],
  };
}

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
 * Fetch file changes for the uncommitted-changes synthetic node.
 * Combines `git diff HEAD --raw --numstat` (staged + unstaged tracked changes)
 * with `git ls-files --others --exclude-standard` (untracked files).
 * Returns the same FileChange[] format as CommitDetail.files.
 */
export async function getUncommittedFiles(repoPath: string, signal?: AbortSignal): Promise<FileChange[]> {
  const diffProc = runGit(repoPath, ["diff", "HEAD", "--raw", "--numstat", "--"], signal);
  const untrackedProc = runGit(repoPath, ["ls-files", "--others", "--exclude-standard"], signal);

  const [diffResult, untrackedResult] = await Promise.all([diffProc, untrackedProc]);
  if (signal?.aborted) return [];

  const files = diffResult.exitCode === 0 && diffResult.stdout.trim() ? parseDiffTreeOutput(diffResult.stdout) : [];

  // Append untracked files as "Added" with zero stats
  if (untrackedResult.exitCode === 0 && untrackedResult.stdout.trim()) {
    for (const line of untrackedResult.stdout.split("\n")) {
      const path = line.trim();
      if (!path) continue;
      // Skip if already covered by the diff (shouldn't happen, but be safe)
      if (files.some(f => f.path === path)) continue;
      files.push({ path, additions: 0, deletions: 0, status: "A" });
    }
  }

  return files;
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

export async function getCommitDetail(
  repoPath: string,
  hash: string,
  existingCommit?: Commit,
  signal?: AbortSignal,
): Promise<CommitDetail | null> {
  // Get full commit message ("--" after the revision prevents the hash
  // from being mistaken for a path if it matches a filename)
  const msgProc = runGit(repoPath, ["log", "-1", "--format=%B", hash, "--"], signal);

  // Single diff-tree call: --raw gives status letters, --numstat gives +/- stats.
  // Git outputs the raw lines first, then a blank separator, then numstat lines.
  const diffProc = runGit(repoPath, ["diff-tree", "--no-commit-id", "-r", "--raw", "--numstat", hash, "--"], signal);

  const [msgResult, diffResult] = await Promise.all([msgProc, diffProc]);
  if (signal?.aborted) return null;

  const fullMessage = msgResult.stdout;
  const files = parseDiffTreeOutput(diffResult.stdout);

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

export async function isGitRepo(path: string): Promise<boolean> {
  const { exitCode } = await runGit(path, ["rev-parse", "--is-inside-work-tree"]);
  return exitCode === 0;
}

/**
 * Fetch from all remotes, pruning deleted remote branches.
 * This is the only network operation in codepulse — safe and read-only.
 */
export async function fetchRemote(repoPath: string): Promise<{ ok: boolean; error?: string }> {
  const { stderr, exitCode } = await runGit(repoPath, ["fetch", "--all", "--prune"]);

  if (exitCode !== 0) {
    return { ok: false, error: stderr.trim() };
  }
  return { ok: true };
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
    const fetchHeadPath = gitDir.startsWith("/") ? `${gitDir}/FETCH_HEAD` : `${repoPath}/${gitDir}/FETCH_HEAD`;
    const file = Bun.file(fetchHeadPath);
    const exists = await file.exists();
    if (!exists) return null;

    // Bun.file().lastModified returns a unix timestamp in ms
    return new Date(file.lastModified);
  } catch {
    return null;
  }
}

// ── Diff + Blame ────────────────────────────────────────────────────

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
    const fullPath = `${repoPath}/${filePath}`;
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

    if (truncated) {
      diffLines.push({
        type: "context",
        content: `... (file truncated at ${MAX_DIFF_LINES} lines)`,
      });
    }

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
