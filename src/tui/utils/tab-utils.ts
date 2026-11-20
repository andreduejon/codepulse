import type { Commit, CommitDetail, UncommittedDetail } from "../../core/git/types";
import { isUncommittedHash } from "../../core/git/types";
import type { ProviderView } from "../../core/provider-model";
import type { ProviderSet } from "../../core/provider-set";
import type { DetailTab } from "../context/state";

interface TabAvailabilityInput {
  commit: Commit | null;
  uncommittedDetail: UncommittedDetail | null;
  commitDetail: CommitDetail | null;
  stashByParent: Map<string, Commit[]>;
  /** The app's providers: a provider's view shows its tabs. */
  providers: ProviderSet;
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
  /** A provider tab's label for a commit: null hides a tab only some commits have (GitHub's Pull requests). */
  tabLabel?: (tab: string, sha: string) => string | null | undefined;
}

/** Returns the initial detail tab for normal (non-jump) navigation. */
export function getDefaultDetailTab(
  commit: Commit,
  activeProviderView: ProviderView,
  providers: ProviderSet,
): DetailTab {
  if (isUncommittedHash(commit.hash)) return "unstaged";
  if (providers.isProvider(activeProviderView)) return activeProviderView;
  return "files";
}

export function getUncommittedProviderNotice(activeProviderView: ProviderView, providers: ProviderSet): string | null {
  if (!providers.isProvider(activeProviderView)) return null;
  return `No ${providers.displayName(activeProviderView)} data for uncommitted changes.`;
}

/**
 * Returns the list of available tabs for the current commit.
 * Each provider takes the first position and no files tab is shown. The
 * info tab is always shown. In Git view, stashes on the commit are
 * presented in an additional tab.
 */
export function getAvailableTabs(input: TabAvailabilityInput): DetailTab[] {
  const { commit, uncommittedDetail, commitDetail, stashByParent, activeProviderView, providers } = input;

  if (commit && isUncommittedHash(commit.hash)) {
    const ud = uncommittedDetail;
    return [
      ...(ud?.unstaged.length ? ["unstaged" as const] : []),
      ...(ud?.staged.length ? ["staged" as const] : []),
      ...(ud?.untracked.length ? ["untracked" as const] : []),
    ];
  }

  const tabs: DetailTab[] = [];

  if (activeProviderView && providers.isProvider(activeProviderView)) {
    // Its own tab, and the ones it adds (Snyk's Dependencies) that this commit has.
    providers.tabsOf(activeProviderView).forEach((tab, index) => {
      if (index === 0 || input.tabLabel?.(tab.id, commit?.hash ?? "") !== null) tabs.push(tab.id);
    });
  } else if (commitDetail?.files.length) {
    tabs.push("files");
  }

  if (!providers.isProvider(activeProviderView ?? "git") && stashByParent.has(commit?.hash ?? "")) {
    tabs.push("stashes");
  }

  tabs.push("info");

  return tabs;
}
