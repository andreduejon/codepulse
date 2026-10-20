import { isUncommittedHash } from "../constants";
import type { DetailTab } from "../context/state";
import type { Commit, CommitDetail, UncommittedDetail } from "../git/types";
import { isProviderDetailView, type ProviderView, providerDisplayName } from "../providers/provider";

interface TabAvailabilityInput {
  commit: Commit | null;
  uncommittedDetail: UncommittedDetail | null;
  commitDetail: CommitDetail | null;
  stashByParent: Map<string, Commit[]>;
  /**
   * The active provider view.
   */
  activeProviderView?: ProviderView;
  /** Optional snapshot getter supplied by provider-aware callers. */
  getCommitData?: (sha: string) => unknown;
  /**
   * True while the initial provider fetch is in-flight. When loading, the
   * tab is kept in the available set so the user is not switched to the
   * info tab before the request completes.
   */
  providerLoading?: boolean;
}

/** Returns the initial detail tab for normal (non-jump) navigation. */
export function getDefaultDetailTab(commit: Commit, activeProviderView: ProviderView): DetailTab {
  if (isUncommittedHash(commit.hash)) return "unstaged";
  if (isProviderDetailView(activeProviderView)) return activeProviderView;
  return "files";
}

export function getUncommittedProviderNotice(activeProviderView: ProviderView): string | null {
  if (!isProviderDetailView(activeProviderView)) return null;
  return `${providerDisplayName(activeProviderView)} data unavailable for uncommitted changes.`;
}

/**
 * Returns the list of available tabs for the current commit.
 * Each provider takes the first position and no files tab is shown. The
 * info tab is always shown. In Git view, stashes on the commit are
 * presented in an additional tab.
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
    if (activeProviderView === "snyk") tabs.push("snyk-deps");
  } else if (commitDetail?.files.length) {
    tabs.push("files");
  }

  if (!isProviderDetailView(activeProviderView ?? "git") && stashByParent.has(commit?.hash ?? "")) {
    tabs.push("stashes");
  }

  tabs.push("info");

  return tabs;
}
