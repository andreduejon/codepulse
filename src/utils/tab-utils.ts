import { isUncommittedHash } from "../constants";
import type { DetailTab } from "../context/state";
import type { Commit, CommitDetail, UncommittedDetail } from "../git/types";
import type { ProviderView } from "../providers/provider";

interface TabAvailabilityInput {
  commit: Commit | null;
  uncommittedDetail: UncommittedDetail | null;
  commitDetail: CommitDetail | null;
  stashByParent: Map<string, Commit[]>;
  /** The active provider view — when "github-actions", Actions tab replaces Files tab. */
  activeProviderView?: ProviderView;
}

/**
 * Returns the list of non-empty (navigable) tabs for the current commit.
 *
 * When `activeProviderView` is `"github-actions"`, the "github-actions" (Actions) tab
 * takes the first position and the "files" tab is hidden — CI status is more
 * relevant when the user has explicitly switched to the GitHub Actions view.
 *
 * The CI tab is never shown outside of github-actions provider mode.
 *
 * This is the single source of truth shared by:
 *  - keyboard navigation (left/right tab switching)
 *  - auto-switch-away-from-empty-tab effect
 *  - detail panel tab bar (to determine which tabs are disabled)
 */
export function getAvailableTabs(input: TabAvailabilityInput): DetailTab[] {
  const { commit, uncommittedDetail, commitDetail, stashByParent, activeProviderView } = input;

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

  if (isCIMode) {
    // In CI mode: Actions tab always takes first position (may show "no data"
    // for commits with no runs). Files tab is hidden — CI status is the focus.
    tabs.push("github-actions");
  } else {
    if (commitDetail && commitDetail.files.length > 0) {
      tabs.push("files");
    }
  }

  if (stashByParent.has(commit?.hash ?? "")) {
    tabs.push("stashes");
  }
  tabs.push("detail");

  return tabs;
}
