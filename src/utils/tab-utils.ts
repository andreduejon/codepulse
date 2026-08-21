import { isUncommittedHash } from "../constants";
import type { DetailTab } from "../context/state";
import type { Commit, CommitDetail, UncommittedDetail } from "../git/types";
import { isProviderDetailView, type ProviderView } from "../providers/provider";

interface TabAvailabilityInput {
  commit: Commit | null;
  uncommittedDetail: UncommittedDetail | null;
  commitDetail: CommitDetail | null;
  stashByParent: Map<string, Commit[]>;
  /**
   * The active provider view.
   */
  activeProviderView?: ProviderView;
  /**
   * Provider data getter — used to determine whether the provider tab has
   * data for the current commit. When omitted the Actions tab is always included
   * (backwards-compatible default for callers that don't have access to CI state).
   */
  getCommitData?: (sha: string) => unknown;
  /**
   * True while the initial provider fetch is in-flight. When loading, the
   * tab is kept in the available set so the user is not switched to the
   * info tab before the request completes.
   */
  providerLoading?: boolean;
}

/**
 * Returns the list of available tabs for the current commit.
 * Each provider takes the first position and no files tab is shown. The
 * info tab is always shown. If there are stashes on the commit, they are
 * also presented in the details section in an additional tab.
 */
export function getAvailableTabs(input: TabAvailabilityInput): DetailTab[] {
  const { commit, uncommittedDetail, commitDetail, stashByParent, activeProviderView } = input;

  if (commit && isUncommittedHash(commit.hash)) {
    const ud = uncommittedDetail;
    return [
      ...(ud?.unstaged.length ? ["unstaged" as const] : []),
      ...(ud?.staged.length ? ["staged" as const] : []),
      ...(ud?.untracked.length ? ["untracked" as const] : []),
    ];
  }

  const tabs: DetailTab[] = [];

  if (activeProviderView && isProviderDetailView(activeProviderView)) {
    tabs.push(activeProviderView);
  } else if (commitDetail?.files.length) {
    tabs.push("files");
  }

  if (stashByParent.has(commit?.hash ?? "")) {
    tabs.push("stashes");
  }

  tabs.push("info");

  return tabs;
}
