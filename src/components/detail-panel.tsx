import type { ScrollBoxRenderable } from "@opentui/core";
import { For, Show } from "solid-js";
import { isUncommittedHash } from "../constants";
import type { ProviderStatus } from "../context/state";
import { useAppState } from "../context/state";
import type { DiffTarget } from "../git/types";
import { useT } from "../hooks/use-t";
import type {
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubWorkflowRun,
} from "../providers/github-actions/types";
import type { JenkinsCommitData, JenkinsJobFetchResult, JenkinsRun } from "../providers/jenkins/types";
import { getAvailableTabs } from "../utils/tab-utils";
import CommitDetailView from "./detail";
import type { DetailNavRef } from "./detail-types";
import UncommittedDetailView from "./uncommitted-detail";

export interface DetailPanelProps {
  /** Ref callback for programmatic scrollbox control */
  scrollboxRef?: (el: ScrollBoxRenderable) => void;
  /** Navigation ref for interactive items */
  navRef: DetailNavRef;
  /** Whether search is currently focused (dims tab focus indicators) */
  searchFocused: boolean;
  onJumpToCommit: (hash: string, from: "child" | "parent") => void;
  onOpenDiff: (target: DiffTarget) => void;
  /** CI data getter from the GitHub Actions provider (optional). */
  githubGetCommitData?: (sha: string) => GitHubCommitData | null;
  /** CI job fetcher from the GitHub Actions provider (optional). */
  githubFetchJobsForRun?: (run: GitHubWorkflowRun) => Promise<GitHubJobFetchResult>;
  /** CI data fetcher for one selected SHA (optional). */
  githubFetchCommitData?: (sha: string) => Promise<void>;
  /** CI job log fetcher from the GitHub Actions provider (optional). */
  githubFetchJobLog?: (jobId: number, signal?: AbortSignal) => Promise<string>;
  /**
   * Current provider status string.  Non-null when the provider is unavailable
   * (e.g. missing token / remote) — forwarded to CommitDetailView for setup
   * guidance in the Actions tab.
   */
  githubProviderStatus?: ProviderStatus;
  /** Open the job log dialog for a specific job. */
  onOpenJobLog?: (job: GitHubJob, run: GitHubWorkflowRun, jobs?: GitHubJob[]) => void;
  jenkinsGetCommitData?: (sha: string) => JenkinsCommitData | null;
  jenkinsFetchJobsForRun?: (run: JenkinsRun) => Promise<JenkinsJobFetchResult>;
  jenkinsFetchCommitData?: (sha: string) => Promise<void>;
  jenkinsProviderStatus?: ProviderStatus;
}

/**
 * The detail panel content: tab bar + scrollable detail view + version badge.
 * Used in both:
 *  - Normal mode: right-side panel in two-column layout
 *  - Compact mode: inside a dialog overlay
 */
export default function DetailPanel(props: Readonly<DetailPanelProps>) {
  const { state } = useAppState();
  const t = useT();

  const tabs = () => {
    const commit = state.selectedCommit();
    const commitHash = commit?.hash ?? "";
    const isUncommitted = isUncommittedHash(commitHash);
    const ud = state.uncommittedDetail();
    const cd = state.commitDetail();
    const stashMap = state.stashByParent();
    const providerView = state.activeProviderView();
    const isProviderMode = providerView === "github-actions" || providerView === "jenkins";
    const available = new Set(
      getAvailableTabs({
        commit,
        uncommittedDetail: ud,
        commitDetail: cd,
        stashByParent: stashMap,
        activeProviderView: providerView,
        getCommitData: providerView === "jenkins" ? props.jenkinsGetCommitData : props.githubGetCommitData,
        providerLoading:
          providerView === "jenkins"
            ? props.jenkinsProviderStatus?.kind === "loading"
            : props.githubProviderStatus?.kind === "loading",
      }),
    );
    if (isUncommitted) {
      return [
        {
          id: "unstaged",
          label: `Unstaged${ud ? ` (${ud.unstaged.length})` : ""}`,
          disabled: ud ? !available.has("unstaged") : false,
        },
        {
          id: "staged",
          label: `Staged${ud ? ` (${ud.staged.length})` : ""}`,
          disabled: ud ? !available.has("staged") : false,
        },
        {
          id: "untracked",
          label: `Untracked${ud ? ` (${ud.untracked.length})` : ""}`,
          disabled: ud ? !available.has("untracked") : false,
        },
      ];
    }
    return [
      // In provider mode the Actions tab always takes the first position (shows "no data"
      // for commits with no runs). Files tab is hidden in provider mode.
      ...(isProviderMode
        ? [
            {
              id: providerView === "jenkins" ? "jenkins" : "github-actions",
              label: providerView === "jenkins" ? "Jenkins" : "Actions",
              disabled: !available.has(providerView === "jenkins" ? "jenkins" : "github-actions"),
            },
          ]
        : [
            {
              id: "files",
              label: `Files${cd?.files ? ` (${cd.files.length})` : ""}`,
              disabled: cd ? !available.has("files") : false,
            },
          ]),
      ...(stashMap.has(commitHash)
        ? [
            {
              id: "stashes",
              label: `Stashes (${stashMap.get(commitHash)?.length ?? 0})`,
              disabled: false,
            },
          ]
        : []),
      { id: "detail", label: "Info", disabled: false },
    ];
  };

  return (
    <>
      {/* Tab bar: each tab has its own top accent line; wrapper provides continuous bottom border */}
      <box
        flexDirection="row"
        width="100%"
        flexShrink={0}
        border={["bottom"]}
        borderStyle="single"
        borderColor={t().border}
      >
        <For each={tabs()}>
          {tab => {
            const isActive = () => state.detailActiveTab() === tab.id;
            const detailActive = () => isActive() && state.detailFocused() && !props.searchFocused;
            const lineColor = () =>
              tab.disabled ? t().border : detailActive() ? t().accent : isActive() ? t().foregroundMuted : t().border;
            const textColor = () => (tab.disabled ? t().border : detailActive() ? t().accent : t().foregroundMuted);
            return (
              <box
                flexGrow={1}
                justifyContent="center"
                flexDirection="row"
                border={["top"]}
                borderStyle="single"
                borderColor={lineColor()}
              >
                <text flexShrink={0} wrapMode="none" fg={textColor()}>
                  <strong>{tab.label}</strong>
                </text>
              </box>
            );
          }}
        </For>
      </box>

      <scrollbox
        ref={props.scrollboxRef}
        flexGrow={1}
        scrollY
        scrollX={false}
        verticalScrollbarOptions={{ visible: false }}
      >
        <Show
          when={!isUncommittedHash(state.selectedCommit()?.hash ?? "")}
          fallback={
            <UncommittedDetailView
              onJumpToCommit={props.onJumpToCommit}
              onOpenDiff={props.onOpenDiff}
              navRef={props.navRef}
            />
          }
        >
          <CommitDetailView
            onJumpToCommit={props.onJumpToCommit}
            onOpenDiff={props.onOpenDiff}
            navRef={props.navRef}
            githubGetCommitData={props.githubGetCommitData}
            githubFetchJobsForRun={props.githubFetchJobsForRun}
            githubFetchCommitData={props.githubFetchCommitData}
            githubFetchJobLog={props.githubFetchJobLog}
            githubProviderStatus={props.githubProviderStatus}
            onOpenJobLog={props.onOpenJobLog}
            jenkinsGetCommitData={props.jenkinsGetCommitData}
            jenkinsFetchJobsForRun={props.jenkinsFetchJobsForRun}
            jenkinsFetchCommitData={props.jenkinsFetchCommitData}
            jenkinsProviderStatus={props.jenkinsProviderStatus}
          />
        </Show>
      </scrollbox>
    </>
  );
}
