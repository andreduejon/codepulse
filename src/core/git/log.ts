/** What codepulse asks Git for (log arguments and formats) and how it reads the answers: commits, refs, branches, tags, stashes, numstat, fast-forward results. */
import { DEFAULT_MAX_COUNT } from "../settings/config";
import type { Branch, Commit, FileChange, RefInfo, TagInfo } from "./types";

/** ASCII Record Separator — safe delimiter that cannot appear in commit fields. */
export const RS = "\x1e";

export const GIT_LOG_FORMAT = `%H${RS}%h${RS}%P${RS}%D${RS}%s${RS}%an${RS}%ae${RS}%aI${RS}%cn${RS}%ce${RS}%cI`;

/** @internal Exported for testing. Parse a git ref decoration string into structured RefInfo[]. */
export function parseRefs(refString: string, remoteNames: Set<string>): RefInfo[] {
  if (!refString.trim()) return [];
  // Git puts ", " between refs; a ref name may hold a comma but never a space.
  return refString.split(", ").map(rawRef => {
    const trimmed = rawRef.trim();
    let isCurrent = false;
    let ref = trimmed;
    if (trimmed.startsWith("HEAD -> ")) {
      ref = trimmed.slice("HEAD -> ".length);
      isCurrent = true;
    }
    if (ref === "HEAD") {
      return { name: "HEAD", type: "head" as const, isCurrent: true };
    }
    if (ref.startsWith("tag: ")) {
      return {
        name: ref.slice("tag: ".length),
        type: "tag" as const,
        isCurrent: false,
      };
    }
    if (ref === "refs/stash" || ref.startsWith("stash@{")) {
      return { name: ref, type: "stash" as const, isCurrent: false };
    }
    if (ref.includes("/")) {
      let isRemote = ref.startsWith("refs/remotes/");
      if (!isRemote) {
        for (const r of remoteNames) {
          if (ref.startsWith(`${r}/`)) {
            isRemote = true;
            break;
          }
        }
      }
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

/**
 * "All branches": local and remote branches, tags, and HEAD (also detached). Tool-private refs such as T3
 * checkpoints (`refs/t3/`) or `git maintenance` prefetches (`refs/prefetch/`) stay out, like in Git's own
 * decorations, and so do stash internals. `--ignore-missing` keeps an unborn HEAD from failing the log.
 */
export const ALL_BRANCH_REVISIONS = ["--branches", "--remotes", "--tags", "--ignore-missing", "HEAD"];

/**
 * @internal Exported for testing. Build the git-log argument array from options.
 * Pure function — no I/O.
 */
export function buildCommitLogArgs(options: {
  maxCount?: number;
  skip?: number;
  branch?: string;
  all?: boolean;
}): string[] {
  const args = [
    "log",
    "--topo-order",
    `--format=${GIT_LOG_FORMAT}`,
    `--max-count=${options.maxCount ?? DEFAULT_MAX_COUNT}`,
  ];

  if (options.skip && options.skip > 0) {
    args.push(`--skip=${options.skip}`);
  }

  if (options.all) {
    // Stash entries are injected separately via getStashList(); "--" keeps a file named HEAD from being a path.
    args.push(...ALL_BRANCH_REVISIONS, "--");
  } else if (options.branch) {
    // Place branch before "--" so git treats it as a revision, not a path.
    // The "--" prevents ambiguity if a file exists with the same name as the branch.
    args.push(options.branch, "--");
  }

  return args;
}

/**
 * The checked-out branch from the branch list, as `git rev-parse --abbrev-ref HEAD` names it: `HEAD` when detached or
 * mid-rebase (Git lists "(HEAD detached at …)" or "(no branch, rebasing …)" as current), "" before the first commit.
 * A branch name may start with "(" but holds no space, so only Git's own rows match.
 */
export function currentBranchOf(branches: readonly Branch[]): string {
  const current = branches.find(branch => branch.isCurrent && !branch.isRemote);
  if (!current) return "";
  return current.name.startsWith("(") && current.name.includes(" ") ? "HEAD" : current.name;
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

/** Format string for `git stash list`: hash, short hash, first parent, subject, author info, dates. */
export const STASH_FORMAT = `%H${RS}%h${RS}%P${RS}%gd${RS}%s${RS}%an${RS}%ae${RS}%aI${RS}%cn${RS}%ce${RS}%cI`;

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

/** Why a branch behind its remote branch stayed where it was. */
export type FastForwardSkip =
  /** It's checked out, and the working tree has changes to tracked files. */
  | { branch: string; reason: "local-changes" }
  /** It has commits its remote branch doesn't have. */
  | { branch: string; reason: "diverged" }
  /** Another worktree has it checked out: moving it would leave that worktree's files behind. */
  | { branch: string; reason: "other-worktree" }
  /** It's checked out, and the commits bring files that are untracked here: Git won't overwrite them. */
  | { branch: string; reason: "untracked"; files: string[] }
  /** Git refused (an untracked file in the way, a hook); `detail` is Git's first line. */
  | { branch: string; reason: "failed"; detail: string };

export interface FastForwardResult {
  moved: { branch: string; commits: number }[];
  skipped: FastForwardSkip[];
}

/**
 * Resolve git's compact rename format to the destination path.
 * Handles patterns like:
 *   `dir/{old.txt => new.txt}`        → `dir/new.txt`
 *   `{src/old => dst/new}/file.txt`   → `dst/new/file.txt`
 *   `{old.txt => new.txt}`            → `new.txt`
 *   `plain/path.txt`                  → `plain/path.txt` (no-op)
 *
 * @internal Exported for testing.
 */
export function resolveRenamePath(rawPath: string): string {
  const braceOpen = rawPath.indexOf("{");
  if (braceOpen === -1) return rawPath;
  const braceClose = rawPath.indexOf("}", braceOpen);
  if (braceClose === -1) return rawPath;
  const arrow = rawPath.indexOf(" => ", braceOpen);
  if (arrow === -1 || arrow > braceClose) return rawPath;

  const prefix = rawPath.slice(0, braceOpen);
  const newPart = rawPath.slice(arrow + 4, braceClose);
  const suffix = rawPath.slice(braceClose + 1);

  // Combine and clean up double/trailing slashes from empty parts
  const result = prefix + newPart + suffix;
  return result.replace(/\/\//g, "/").replace(/^\/|\/$/g, "");
}

/**
 * Parse `git diff --numstat` output (no raw lines — just numstat).
 * Format per line: `<additions>\t<deletions>\t<path>`
 *
 * Renames appear in compact `{old => new}` format; resolved to the destination path.
 *
 * @internal Exported for testing.
 */
export function parseNumstatOutput(stdout: string): FileChange[] {
  const files: FileChange[] = [];
  for (const line of stdout.split("\n")) {
    if (!line?.includes("\t")) continue;
    const [additions, deletions, ...pathParts] = line.split("\t");
    const rawPath = pathParts.join("\t");
    if (!rawPath) continue;
    files.push({
      path: resolveRenamePath(rawPath),
      additions: additions === "-" ? 0 : parseInt(additions, 10),
      deletions: deletions === "-" ? 0 : parseInt(deletions, 10),
      status: "M", // numstat alone doesn't provide status — default to Modified
    });
  }
  return files;
}
