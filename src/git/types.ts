export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  authorDate: string;
  refs: RefInfo[];
}

export interface RefInfo {
  name: string;
  type: "branch" | "tag" | "remote" | "head";
  isCurrent: boolean;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommitHash: string;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "A" | "M" | "D" | "R" | "C" | "T" | "U";
}

export interface CommitDetail extends Commit {
  files: FileChange[];
  diff: string;
}

export interface GraphRow {
  commit: Commit;
  columns: GraphColumn[];
  nodeColumn: number;
  connectors: Connector[];
  /** Whether this commit is on the current branch's first-parent chain */
  isOnCurrentBranch: boolean;
  /** The column index of the current branch tip (for consistent focus color) */
  currentBranchTipColumn: number;
  /** Debug: the branch this commit belongs to (first-parent chain from nearest tip) */
  branchName: string;
  /** Whether this commit's lane belongs to a remote-only branch */
  isRemoteOnly: boolean;
  /** Set of remote branch names that are remote-only (no local counterpart) */
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
  /** Whether this column's lane is tracking a current-branch hash */
  isFocused?: boolean;
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
  /** Whether this connector belongs to the focused (current) branch path */
  isFocused?: boolean;
  /** Whether this connector belongs to a remote-only branch */
  isRemoteOnly?: boolean;
}
