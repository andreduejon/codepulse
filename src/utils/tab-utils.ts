import { isUncommittedHash } from "../constants";
import type { DetailTab } from "../context/state";
import type { Commit, CommitDetail, UncommittedDetail } from "../git/types";
import type { ProviderView } from "../providers/provider";

interface TabAvailabilityInput {
  commit: Commit | null;
  uncommittedDetail: UncommittedDetail | null;
  commitDetail: CommitDetail | null;
  stashByParent: Map<string, Commit[]>;
  /** Whether the active CI provider has data for this commit. */
  hasCIData?: boolean;
  /** The active provider view — when "github-actions", CI tab replaces Files tab. */
  activeProviderView?: ProviderView;
}

/**
 * Returns the list of non-empty (navigable) tabs for the current commit.
 *
 * When `activeProviderView` is `"github-actions"` and CI data is available,
 * the "ci" tab takes the first position (replacing "files").  The "files"
 * tab is hidden in that mode — CI status is more relevant than raw file lists
 * when the user has explicitly switched to the GitHub Actions provider view.
 *
 * This is the single source of truth shared by:
 *  - keyboard navigation (left/right tab switching)
 *  - auto-switch-away-from-empty-tab effect
 *  - detail panel tab bar (to determine which tabs are disabled)
 */
export function getAvailableTabs(input: TabAvailabilityInput): DetailTab[] {
  const { commit, uncommittedDetail, commitDetail, stashByParent, hasCIData, activeProviderView } = input;

  if (commit && isUncommittedHash(commit.hash)) {
    const ud = uncommittedDetail;
    const tabs: DetailTab[] = [];
    if (ud && ud.unstaged.length > 0) tabs.push("unstaged");
    if (ud && ud.staged.length > 0) tabs.push("staged");
    if (ud && ud.untracked.length > 0) tabs.push("untracked");
    return tabs;
  }

  const isCIMode = activeProviderView === "github-actions";
  const tabs: DetailTab[] = [];

  if (isCIMode && hasCIData) {
    // In CI mode: CI tab takes first position, files tab hidden
    tabs.push("ci");
  } else if (commitDetail && commitDetail.files.length > 0) {
    // Normal mode: show files tab when there are files
    tabs.push("files");
  }

  if (stashByParent.has(commit?.hash ?? "")) {
    tabs.push("stashes");
  }
  tabs.push("detail");

  if (!isCIMode && hasCIData) {
    // Normal mode: CI tab appended at end (original behaviour)
    tabs.push("ci");
  }

  return tabs;
}
