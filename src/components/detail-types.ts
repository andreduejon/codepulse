import type { Renderable } from "@opentui/core";
import type { DiffTarget } from "../git/types";
import type { GitHubCommitData, GitHubJob, GitHubWorkflowRun } from "../providers/github-actions/types";

/** Mutable ref populated by a detail view for app.tsx to call */
export interface DetailNavRef {
  /** Number of interactive items currently visible */
  itemCount: number;
  /** Activate the item at the current cursor index. Returns true if it was a jump-to-commit action. */
  activateCurrentItem: () => boolean;
  /** Direction of the last jump: "child" means we selected a child entry, "parent" means we selected a parent entry */
  lastJumpFrom: "child" | "parent" | null;
  /** Pending jump direction — persists across interactiveItems recomputations.
   *  Set by handleJumpToCommit, cleared by app.tsx commit-change effect on non-jump navigation. */
  pendingJumpDirection: "child" | "parent" | null;
  /** Move the detail cursor to the file with the given path (if visible in the current tab). */
  scrollToFile: (filePath: string) => void;
  /** Element refs for all interactive items, indexed by item position in the flat list. */
  itemRefs: Renderable[];
}

export interface DetailViewProps {
  onJumpToCommit?: (hash: string, from: "child" | "parent") => void;
  /** Open the diff+blame dialog for a file. */
  onOpenDiff?: (target: DiffTarget) => void;
  /** Mutable ref object populated by the detail view with navigation callbacks */
  navRef?: DetailNavRef;
  /** Get CI data for a commit SHA (from the GitHub Actions provider). Optional. */
  githubGetCommitData?: (sha: string) => GitHubCommitData | null;
  /** Fetch full job details (with steps) for a CI run on demand. Optional. */
  githubFetchJobsForRun?: (run: GitHubWorkflowRun) => Promise<GitHubJob[]>;
  /**
   * Current provider status string (from state.providerStatus).
   * Non-null when the provider is unavailable (e.g. missing token / remote).
   * Passed to ActionsDetailTab to show setup guidance.
   */
  githubProviderStatus?: string | null;
}

/** Layout constants shared between committed and uncommitted detail views */
/** Horizontal padding (paddingX=2 each side) subtracted from panel width. */
export const PANEL_PADDING_X = 4;
/** Width of the abbreviated commit hash (7 hex chars). */
export const SHORT_HASH_LEN = 7;
/** Space between hash and badge in child/parent entry rows. */
export const HASH_BADGE_GAP = 1;
/** Badge inner padding (1 space each side of the text). */
export const BADGE_PADDING = 2;
/** Left indent for child/parent/file entry rows. */
export const ENTRY_PADDING_LEFT = 2;
/** Width of the directory collapse indicator ("▸ " / "▾ "). */
export const DIR_INDICATOR_WIDTH = 2;
/** Padding before the status letter in file rows. */
export const STAT_PADDING_LEFT = 1;
/** Width of the status letter column (padding + letter). */
export const STATUS_COL_WIDTH = 2;
/** Padding between the stat columns (status→+, +→-). */
export const STAT_GAP = 1;

/** Compute column widths for file change stats (total determines column width). */
export function computeFileWidths(files: readonly { additions: number; deletions: number }[]) {
  const totalAdd = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = files.reduce((sum, f) => sum + f.deletions, 0);
  return {
    totalAdd,
    totalDel,
    addColWidth: `+${totalAdd}`.length,
    delColWidth: `-${totalDel}`.length,
  };
}
