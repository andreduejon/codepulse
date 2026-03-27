import type { Commit, Branch, FileChange, CommitDetail, RefInfo, TagInfo } from "./types";
import { DEFAULT_MAX_COUNT } from "../constants";

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
    const onAbort = () => { try { proc.kill(); } catch {} };
    signal.addEventListener("abort", onAbort, { once: true });
    proc.exited.then(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
  }

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
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
      .map((r) => r.trim())
      .filter(Boolean)
  );
}

/** @internal Exported for testing. Parse a git ref decoration string into structured RefInfo[]. */
export function parseRefs(refString: string, remoteNames: Set<string>): RefInfo[] {
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

/** @internal Exported for testing. Parse a single git log output line into a Commit. */
export function parseCommitLine(line: string, remoteNames: Set<string>): Commit | null {
  const parts = line.split(RS);
  if (parts.length < 11) return null;

  const [hash, shortHash, parentsStr, refsStr, subject, author, authorEmail, authorDate, committer, committerEmail, commitDate] = parts;
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
    args.push("--all");
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
export function parseTrackInfo(track: string): { ahead?: number; behind?: number } {
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
    runGit(repoPath, [
      "branch", "-a",
      `--format=%(HEAD)${RS}%(refname:short)${RS}%(objectname:short)${RS}%(upstream:short)${RS}%(upstream:track,nobracket)${RS}%(symref)`,
    ], signal),
    getRemoteNames(repoPath, signal),
  ]);

  if (branchResult.exitCode !== 0) return [];

  return branchResult.stdout
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .filter((line) => {
      // Filter out symbolic refs (e.g. origin/HEAD -> origin/develop)
      const parts = line.split(RS);
      const symref = parts[5]?.trim();
      return !symref;
    })
    .map((line) => {
      const [head, name, lastCommitHash, upstream, track] = line.split(RS);
      const trimmedName = name.trim();
      const isRemote =
        trimmedName.includes("remotes/") ||
        [...remoteNames].some((r) => trimmedName.startsWith(`${r}/`));

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

export async function getTagDetails(
  repoPath: string,
  signal?: AbortSignal,
): Promise<Map<string, TagInfo>> {
  const format = `%(refname)${RS}%(objecttype)${RS}%(taggername)${RS}%(taggerdate:iso-strict)${RS}%(contents:subject)`;
  const { stdout, exitCode } = await runGit(
    repoPath,
    ["for-each-ref", `--format=${format}`, "refs/tags/"],
    signal,
  );

  const result = new Map<string, TagInfo>();
  if (exitCode !== 0) return result;

  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const tag = parseTagLine(line);
    if (tag) result.set(tag.name, tag);
  }

  return result;
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
  const diffProc = runGit(repoPath, [
    "diff-tree", "--no-commit-id", "-r", "--raw", "--numstat", hash, "--",
  ], signal);

  const [msgResult, diffResult] = await Promise.all([msgProc, diffProc]);
  if (signal?.aborted) return null;

  const fullMessage = msgResult.stdout;

  // Parse the combined --raw / --numstat output.
  // Raw lines start with ":" (e.g. ":100644 100644 ... M\tfile.ts")
  // Numstat lines are "adds\tdels\tpath"
  const statusMap = new Map<string, string>();
  const statMap = new Map<string, { additions: number; deletions: number }>();

  for (const line of diffResult.stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith(":")) {
      // Raw format: :old_mode new_mode old_hash new_hash status\tpath[\tnew_path]
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) continue;
      const meta = line.slice(0, tabIdx);
      const pathPart = line.slice(tabIdx + 1);
      // Status is the last token before the tab (e.g. "M", "R100", "C080")
      const statusCode = meta.split(" ").pop() ?? "M";
      const filePath = pathPart.split("\t")[0]; // first path for renames
      statusMap.set(filePath, statusCode[0]);
    } else if (line.includes("\t")) {
      // Numstat format: additions\tdeletions\tpath
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

  // Use existing commit info if provided (avoids a redundant git log subprocess)
  let commit: Commit;
  if (existingCommit) {
    commit = existingCommit;
  } else {
    // Fetch metadata for a single commit by its hash.
    // Place hash before "--" so git treats it as a revision, not a path.
    const [lookupResult, remoteNames] = await Promise.all([
      runGit(repoPath, [
        "log", "-1", "--topo-order", `--format=${GIT_LOG_FORMAT}`, hash, "--",
      ], signal),
      getRemoteNames(repoPath),
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
  const { stdout, exitCode } = await runGit(repoPath, [
    "rev-parse", "--abbrev-ref", "HEAD",
  ], signal);
  if (exitCode !== 0) return "";
  return stdout.trim();
}

export async function getRemoteUrl(repoPath: string, signal?: AbortSignal): Promise<string> {
  try {
    // Try "origin" first (most common), then fall back to the first available remote
    const { stdout, exitCode } = await runGit(repoPath, [
      "remote", "get-url", "origin",
    ], signal);
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
    // git rev-parse --git-dir returns a relative path for normal repos
    // but an absolute path for linked worktrees — handle both
    const fetchHeadPath = gitDir.startsWith("/")
      ? `${gitDir}/FETCH_HEAD`
      : `${repoPath}/${gitDir}/FETCH_HEAD`;
    const file = Bun.file(fetchHeadPath);
    const exists = await file.exists();
    if (!exists) return null;

    // Bun.file().lastModified returns a unix timestamp in ms
    return new Date(file.lastModified);
  } catch {
    return null;
  }
}
