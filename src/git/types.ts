export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  authorDate: string;
  committer: string;
  committerEmail: string;
  commitDate: string;
  refs: RefInfo[];
}

export interface RefInfo {
  name: string;
  type: "branch" | "tag" | "remote" | "head" | "stash" | "uncommitted";
  isCurrent: boolean;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommitHash: string;
  /** Upstream tracking branch (e.g. "origin/main"). Only set for local branches. */
  upstream?: string;
  /** Commits ahead of upstream. Only set when upstream is configured. */
  ahead?: number;
  /** Commits behind upstream. Only set when upstream is configured. */
  behind?: number;
}

export interface TagInfo {
  name: string;
  type: "annotated" | "lightweight";
  /** Tag message (annotated tags only). */
  message?: string;
  /** Tagger name (annotated tags only). */
  tagger?: string;
  /** Tagger date in ISO 8601 format (annotated tags only). */
  taggerDate?: string;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "A" | "M" | "D" | "R" | "C" | "T" | "U";
}

export interface CommitDetail extends Commit {
  files: FileChange[];
}

/** Separate file lists for the uncommitted-changes synthetic node. */
export interface UncommittedDetail {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
}

// ── Diff + Blame types ──────────────────────────────────────────────

/** A single line in a unified diff hunk. */
export interface DiffLine {
  type: "add" | "delete" | "context";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** A hunk from a unified diff (one @@ block). */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** The full @@ header line. */
  header: string;
  lines: DiffLine[];
}

/** Parsed unified diff for a single file. */
export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
  isBinary: boolean;
}

/** A single blame annotation line from `git blame --porcelain`. */
export interface BlameLine {
  commitHash: string;
  shortHash: string;
  author: string;
  lineNo: number;
  content: string;
}

/** Identifies the source of a diff request — determines which git command variant to use. */
export type DiffSource = "commit" | "stash" | "staged" | "unstaged" | "untracked";

/** Target for opening the diff+blame dialog. */
export interface DiffTarget {
  commitHash: string;
  filePath: string;
  source: DiffSource;
  /** All file paths in the same commit/section, for left/right navigation. */
  fileList: string[];
  /** Index of `filePath` within `fileList`. */
  fileIndex: number;
}

export interface GraphRow {
  commit: Commit;
  columns: GraphColumn[];
  nodeColumn: number;
  connectors: Connector[];
  /** Whether this commit is on the current branch's first-parent chain */
  isOnCurrentBranch: boolean;
  /** The lane color index of this commit's node (decoupled from column position) */
  nodeColor: number;
  /** Debug: the branch this commit belongs to (first-parent chain from nearest tip) */
  branchName: string;
  /** For merge commits: branch name of parents[1] (merged FROM) */
  mergeBranch?: string;
  /** For merge commits: branch name of parents[0] (merged INTO) */
  mergeTarget?: string;
  /** Lane color index of the merge source branch (parents[1]'s lane) */
  mergeSourceColor?: number;
  /** Parent commit hashes, sorted: same-branch first, then by row order */
  parentHashes: string[];
  /** Branch name for each parent (from branchNameMap), parallel to parentHashes */
  parentBranches: string[];
  /** Lane color index for each parent, parallel to parentHashes */
  parentColors: number[];
  /** Child commit hashes (commits whose parents include this commit) */
  children: string[];
  /** Branch name for each child (from branchNameMap), parallel to children */
  childBranches: string[];
  /** Lane color index for each child, parallel to children */
  childColors: number[];
  /** Whether this commit's lane belongs to a remote-only branch */
  isRemoteOnly: boolean;
  /**
   * Set of remote branch names that are remote-only (no local counterpart).
   * This is the same shared Set reference across all rows in a graph result —
   * it is graph-level data attached to each row for convenient access.
   */
  remoteOnlyBranches: Set<string>;
  /**
   * Fan-out connector rows: when this commit has multiple lanes pointing to it
   * (multiple children branched off from it), each extra lane gets its own
   * connector row showing a branch-off corner from the node column.
   * Each entry is a set of connectors for one fan-out row.
   * Rendered as separate rows ABOVE the commit row (graph flows bottom-to-top:
   * children are above, parent is below, fan-out connects them going up).
   */
  fanOutRows?: Connector[][];
}

export interface GraphColumn {
  color: number;
  active: boolean;
  /** Whether this column's lane belongs to a remote-only branch (no local counterpart) */
  isRemoteOnly?: boolean;
}

export type ConnectorType =
  | "straight" // │
  | "horizontal" // ──
  | "tee-left" // ├─ (T-junction: existing vertical lane, merge/branch joins from right)
  | "tee-right" // ─┤ (T-junction: existing vertical lane, merge/branch joins from left)
  | "corner-top-right" // ╮ (new lane starts, line comes from left, turns down)
  | "corner-top-left" // ╭ (new lane starts, line comes from right, turns down)
  | "corner-bottom-right" // ╯ (lane ends, line comes from left, turns up)
  | "corner-bottom-left" // ╰ (lane ends, line comes from right, turns up)
  | "node" // ●
  | "empty"; // space

export interface Connector {
  type: ConnectorType;
  color: number;
  column: number;
  /** Whether this connector belongs to a remote-only branch */
  isRemoteOnly?: boolean;
}
