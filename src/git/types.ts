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
}

export interface GraphColumn {
  color: number;
  active: boolean;
}

export type ConnectorType =
  | "straight" // │
  | "merge-left" // ╱ or /
  | "merge-right" // ╲ or \
  | "branch-left" // going left from node
  | "branch-right" // going right from node
  | "horizontal" // ─
  | "node" // ●
  | "empty"; // space

export interface Connector {
  type: ConnectorType;
  color: number;
  column: number;
}
