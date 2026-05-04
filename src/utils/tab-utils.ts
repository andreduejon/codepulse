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
  /**
   * CI data getter — used to determine whether the Actions tab has data for
   * the current commit.  When omitted the Actions tab is always included
   * (backwards-compatible default for callers that don't have access to CI state).
   */
  getCommitData?: (sha: string) => unknown;
  /**
   * True while the initial CI fetch is in-flight.  When loading, the Actions
   * tab is kept in the available set so the user isn't switched to Info
   * before the request completes.
   */
  providerLoading?: boolean;
}

/**
 * Returns the list of non-empty (navigable) tabs for the current commit.
 *
 * When `activeProviderView` is `"github-actions"`, the "github-actions" (Actions) tab
 * takes the first position and the "files" tab is hidden — CI status is more
 * relevant when the user has explicitly switched to the GitHub Actions view.
 *
 * The Actions tab is only included when:
 *   - CI data is present for the commit (`getCommitData(sha)` returns non-null), OR
 *   - The CI fetch is still in-flight (`providerLoading === true`), OR
 *   - `getCommitData` was not provided (backwards-compatible: always include).
 *
 * The CI tab is never shown outside of github-actions provider mode.
 *
 * This is the single source of truth shared by:
 *  - keyboard navigation (left/right tab switching)
 *  - auto-switch-away-from-empty-tab effect
 *  - detail panel tab bar (to determine which tabs are disabled)
 */
export function getAvailableTabs(input: TabAvailabilityInput): DetailTab[] {
  const { commit, uncommittedDetail, commitDetail, stashByParent, activeProviderView, getCommitData, providerLoading } =
    input;

  if (commit && isUncommittedHash(commit.hash)) {
    const ud = uncommittedDetail;
    const tabs: DetailTab[] = [];
    if (ud && ud.unstaged.length > 0) tabs.push("unstaged");
    if (ud && ud.staged.length > 0) tabs.push("staged");
    if (ud && ud.untracked.length > 0) tabs.push("untracked");
    return tabs;
  }

  const isProviderMode = activeProviderView === "github-actions";
  const tabs: DetailTab[] = [];

  if (isProviderMode) {
    // Actions tab is available when:
    //  - no getCommitData provided (backwards-compatible, always include)
    //  - provider is still loading (don't switch away prematurely)
    //  - CI data exists for this commit
    const hasData = !getCommitData || providerLoading || (commit && !!getCommitData(commit.hash));
    if (hasData) {
      tabs.push("github-actions");
    }
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
