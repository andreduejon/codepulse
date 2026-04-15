import { isUncommittedHash } from "../constants";
import type { DetailTab } from "../context/state";
import type { Commit, CommitDetail, UncommittedDetail } from "../git/types";

interface TabAvailabilityInput {
  commit: Commit | null;
  uncommittedDetail: UncommittedDetail | null;
  commitDetail: CommitDetail | null;
  stashByParent: Map<string, Commit[]>;
  /** Whether the active CI provider has data for this commit. */
  hasCIData?: boolean;
}

/**
 * Returns the list of non-empty (navigable) tabs for the current commit.
 *
 * This is the single source of truth shared by:
 *  - keyboard navigation (left/right tab switching)
 *  - auto-switch-away-from-empty-tab effect
 *  - detail panel tab bar (to determine which tabs are disabled)
 */
export function getAvailableTabs(input: TabAvailabilityInput): DetailTab[] {
  const { commit, uncommittedDetail, commitDetail, stashByParent, hasCIData } = input;

  if (commit && isUncommittedHash(commit.hash)) {
    const ud = uncommittedDetail;
    const tabs: DetailTab[] = [];
    if (ud && ud.unstaged.length > 0) tabs.push("unstaged");
    if (ud && ud.staged.length > 0) tabs.push("staged");
    if (ud && ud.untracked.length > 0) tabs.push("untracked");
    return tabs;
  }

  const tabs: DetailTab[] = [];
  if (commitDetail && commitDetail.files.length > 0) {
    tabs.push("files");
  }
  if (stashByParent.has(commit?.hash ?? "")) {
    tabs.push("stashes");
  }
  tabs.push("detail");
  if (hasCIData) {
    tabs.push("ci");
  }
  return tabs;
}
