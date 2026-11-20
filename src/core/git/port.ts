import type { CommitInfo, DashboardGit } from "../dashboard/load";
import type { FastForwardResult } from "./log";
import type { WorkingTreeStatus } from "./status";
import type {
  BlameLine,
  Branch,
  Commit,
  CommitDetail,
  DiffSource,
  FileChange,
  FileContent,
  FileDiff,
  TagInfo,
  UncommittedDetail,
} from "./types";

/**
 * Git as the app uses it: the repository's history, refs, working tree and files, fetching and fast-forwarding. The
 * terminal app runs the Git command line (src/adapters/git/git-cli.ts); a test or another front end can answer from elsewhere.
 */
export interface GitPort extends DashboardGit {
  /** An event's commit as the repository knows it, for the Dashboard's side panel; null when it doesn't. */
  getCommitInfo: (repo: string, sha: string, signal?: AbortSignal) => Promise<CommitInfo | null>;
  isGitAvailable: () => Promise<boolean>;
  isGitRepo: (path: string) => Promise<boolean>;
  /** The repository's top folder for a path inside it, or null. */
  getRepoRoot: (repoPath: string, signal?: AbortSignal) => Promise<string | null>;
  /** A page of history: `maxCount` commits after `skip`, of one branch or of all of them. */
  getCommits: (
    repoPath: string,
    options?: { maxCount?: number; skip?: number; branch?: string; all?: boolean },
    signal?: AbortSignal,
  ) => Promise<Commit[]>;
  getBranches: (repoPath: string, signal?: AbortSignal) => Promise<Branch[]>;
  getCurrentBranch: (repoPath: string, signal?: AbortSignal) => Promise<string>;
  getTagDetails: (repoPath: string, signal?: AbortSignal) => Promise<Map<string, TagInfo>>;
  getStashList: (repoPath: string, signal?: AbortSignal) => Promise<Commit[]>;
  getRemoteUrl: (repoPath: string, signal?: AbortSignal) => Promise<string>;
  /** When the repository last fetched, or null. */
  getLastFetchTime: (repoPath: string) => Promise<Date | null>;
  getWorkingTreeStatus: (repoPath: string, signal?: AbortSignal) => Promise<WorkingTreeStatus | null>;
  /** A commit with its files; `existingCommit` saves reading what the graph already has. */
  getCommitDetail: (
    repoPath: string,
    hash: string,
    existingCommit?: Commit,
    signal?: AbortSignal,
  ) => Promise<CommitDetail | null>;
  getUncommittedDetail: (repoPath: string, signal?: AbortSignal) => Promise<UncommittedDetail>;
  getStashFiles: (repoPath: string, stashHash: string, signal?: AbortSignal) => Promise<FileChange[]>;
  /**
   * What a branch changed since it left another, as a pull request shows it: the files between the commits' merge base
   * and `head`, and that base. Null when Git hasn't both commits (not fetched) or they share no history.
   */
  getRangeFiles: (
    repoPath: string,
    base: string,
    head: string,
    signal?: AbortSignal,
  ) => Promise<{ mergeBase: string; files: FileChange[] } | null>;
  /** The commits that touch a path. */
  getPathMatchingHashes: (
    repoPath: string,
    pathspec: string,
    options?: { branch?: string; all?: boolean },
    signal?: AbortSignal,
  ) => Promise<Set<string>>;
  getFileDiff: (
    repoPath: string,
    commitHash: string,
    filePath: string,
    source: DiffSource,
    signal?: AbortSignal,
    /** A `range`'s base: `commitHash` against it. */
    base?: string,
  ) => Promise<FileDiff>;
  getFileContent: (
    repoPath: string,
    commitHash: string,
    filePath: string,
    source: DiffSource,
    signal?: AbortSignal,
    /** A `range`'s base: `commitHash` against it. */
    base?: string,
  ) => Promise<FileContent>;
  getFileBlame: (
    repoPath: string,
    commitHash: string,
    filePath: string,
    source: DiffSource,
    signal?: AbortSignal,
    /** A `range`'s base: `commitHash` against it. */
    base?: string,
  ) => Promise<BlameLine[]>;
  fetchRemote: (repoPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Fetches a GitHub pull request's head and target branch only (its files need both); true when either arrived. */
  fetchPullRequest: (repoPath: string, number: number, baseRef: string, signal?: AbortSignal) => Promise<boolean>;
  /** Moves the local branches their remote branches are ahead of, where Git can without a merge. */
  fastForwardBranches: (repoPath: string) => Promise<FastForwardResult>;
}
