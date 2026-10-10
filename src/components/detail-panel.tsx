import { MouseButton, type ScrollBoxRenderable } from "@opentui/core";
import { batch, createSignal, For, Show } from "solid-js";
import { isUncommittedHash } from "../constants";
import type { DetailTab, ProviderStatus } from "../context/state";
import { useAppState } from "../context/state";
import type { DiffTarget } from "../git/types";
import { useT } from "../hooks/use-t";
import type {
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubWorkflowRun,
} from "../providers/github-actions/types";
import type { JenkinsCommitData, JenkinsJob, JenkinsJobFetchResult, JenkinsRun } from "../providers/jenkins/types";
import type { OpenShiftCommitData, OpenShiftResource } from "../providers/openshift/types";
import { providerDetailTab } from "../providers/provider";
import type { SnykScanResult } from "../providers/snyk/types";
import { getAvailableTabs } from "../utils/tab-utils";
import CommitDetailView from "./detail";
import type { DetailNavRef } from "./detail-types";
import UncommittedDetailView from "./uncommitted-detail";

export interface DetailPanelProps {
  contentWidth?: number;
  /** Opt-in for mouse actions; false also blocks native scrolling behind modals. */
  mouseEnabled?: boolean;
  /** Focus the sidebar before activating an item; omitted in compact dialogs. */
  onMouseFocus?: () => void;
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
  onOpenJenkinsJobLog?: (job: JenkinsJob, run: JenkinsRun, jobs?: JenkinsJob[]) => void;
  jenkinsProviderStatus?: ProviderStatus;
  openshiftGetCommitData?: (sha: string) => OpenShiftCommitData | null;
  openshiftFetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  openshiftIsLoading?: (sha: string) => boolean;
  openshiftLiveAge?: () => string;
  onOpenOpenShiftResource?: (resource: OpenShiftResource) => void;
  openshiftProviderStatus?: ProviderStatus;
  snykGetCommitData?: (sha: string) => SnykScanResult | null;
  snykIsScanning?: (sha: string) => boolean;
  snykScanCommit?: (sha: string, force?: boolean) => Promise<SnykScanResult | null>;
  snykProviderStatus?: ProviderStatus;
}

/**
 * The detail panel content: tab bar + scrollable detail view + version badge.
 * Used in both:
 *  - Normal mode: right-side panel in two-column layout
 *  - Compact mode: inside a dialog overlay
 */
export default function DetailPanel(props: Readonly<DetailPanelProps>) {
  const { state, actions } = useAppState();
  const t = useT();
  const [hoveredTab, setHoveredTab] = createSignal<string | null>(null);
  let scrollbox: ScrollBoxRenderable | undefined;

  const tabs = (): { id: DetailTab; label: string; disabled: boolean }[] => {
    const commit = state.selectedCommit();
    const commitHash = commit?.hash ?? "";
    const isUncommitted = isUncommittedHash(commitHash);
    const ud = state.uncommittedDetail();
    const cd = state.commitDetail();
    const stashMap = state.stashByParent();
    const providerView = state.activeProviderView();
    const providerTab = providerDetailTab(providerView);
    const isProviderMode = providerTab != null;
    const available = new Set(
      getAvailableTabs({
        commit,
        uncommittedDetail: ud,
        commitDetail: cd,
        stashByParent: stashMap,
        activeProviderView: providerView,
        getCommitData: (() => {
          switch (providerView) {
            case "github-actions":
              return props.githubGetCommitData;
            case "jenkins":
              return props.jenkinsGetCommitData;
            case "openshift":
              return props.openshiftGetCommitData;
            case "snyk":
              return props.snykGetCommitData;
            case "git":
              return undefined;
          }
        })(),
        providerLoading: (() => {
          switch (providerView) {
            case "github-actions":
              return props.githubProviderStatus?.kind === "loading";
            case "jenkins":
              return props.jenkinsProviderStatus?.kind === "loading";
            case "openshift":
              return props.openshiftProviderStatus?.kind === "loading";
            case "snyk":
              return props.snykProviderStatus?.kind === "loading";
            case "git":
              return false;
          }
        })(),
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
    const providerTabEntry = providerTab
      ? [
          {
            id: providerTab.id,
            label: providerTab.label,
            disabled: !available.has(providerTab.id),
          },
        ]
      : [];
    return [
      // In provider mode the provider tab always takes the first position. Files tab is hidden.
      ...(isProviderMode
        ? providerTabEntry
        : [
            {
              id: "files" as const,
              label: `Files${cd?.files ? ` (${cd.files.length})` : ""}`,
              disabled: cd ? !available.has("files") : false,
            },
          ]),
      ...(stashMap.has(commitHash)
        ? [
            {
              id: "stashes" as const,
              label: `Stashes (${stashMap.get(commitHash)?.length ?? 0})`,
              disabled: false,
            },
          ]
        : []),
      { id: "info", label: "Info", disabled: false },
    ];
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI panel focus also supports keyboard navigation.
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseDown={event => {
        if (props.mouseEnabled && event.button === MouseButton.LEFT) props.onMouseFocus?.();
      }}
    >
      {/* Tab bar: each tab has its own top accent line; wrapper provides continuous bottom border */}
      <box flexDirection="row" width="100%" flexShrink={0}>
        <For each={tabs()}>
          {tab => {
            const isActive = () => state.detailActiveTab() === tab.id;
            const detailActive = () => isActive() && state.detailFocused() && !props.searchFocused;
            const hovered = () => props.mouseEnabled && !tab.disabled && hoveredTab() === tab.id;
            const lineColor = () =>
              tab.disabled
                ? t().border
                : detailActive()
                  ? t().accent
                  : hovered()
                    ? t().foreground
                    : isActive()
                      ? t().foregroundMuted
                      : t().border;
            const textColor = () =>
              tab.disabled
                ? t().border
                : detailActive()
                  ? t().accent
                  : hovered()
                    ? t().foreground
                    : t().foregroundMuted;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: TUI tabs also support Left/Right.
              // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard-selected tabs already use accent colors.
              <box
                flexGrow={1}
                flexBasis={0}
                flexDirection="column"
                onMouseOver={() => setHoveredTab(tab.id)}
                onMouseOut={() => setHoveredTab(null)}
                onMouseDown={event => {
                  if (!props.mouseEnabled || event.button !== MouseButton.LEFT) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (tab.disabled) return;
                  props.onMouseFocus?.();
                  if (isActive()) return;
                  batch(() => {
                    actions.setDetailCursorAction(null);
                    actions.setDetailActiveTab(tab.id);
                    actions.setDetailCursorIndex(0);
                  });
                  scrollbox?.scrollTo(0);
                }}
              >
                <box border={["top"]} borderStyle="single" borderColor={lineColor()} flexShrink={0} />
                <box flexDirection="row" justifyContent="center" flexShrink={0}>
                  <text selectable={false} flexShrink={0} wrapMode="none" fg={textColor()}>
                    <strong>{tab.label}</strong>
                  </text>
                </box>
                <box border={["top"]} borderStyle="single" borderColor={t().border} flexShrink={0} />
              </box>
            );
          }}
        </For>
      </box>

      <scrollbox
        ref={el => {
          scrollbox = el;
          props.scrollboxRef?.(el);
        }}
        flexGrow={1}
        scrollY
        scrollX={false}
        verticalScrollbarOptions={{ visible: false }}
        viewportOptions={{
          onMouse: event => {
            if (props.mouseEnabled === false) {
              event.preventDefault();
              event.stopPropagation();
            }
          },
        }}
      >
        <Show
          when={!isUncommittedHash(state.selectedCommit()?.hash ?? "")}
          fallback={
            <UncommittedDetailView
              mouseEnabled={props.mouseEnabled}
              onMouseFocus={props.onMouseFocus}
              onJumpToCommit={props.onJumpToCommit}
              onOpenDiff={props.onOpenDiff}
              navRef={props.navRef}
            />
          }
        >
          <CommitDetailView
            contentWidth={props.contentWidth}
            mouseEnabled={props.mouseEnabled}
            onMouseFocus={props.onMouseFocus}
            onJumpToCommit={props.onJumpToCommit}
            onOpenDiff={props.onOpenDiff}
            navRef={props.navRef}
            githubGetCommitData={props.githubGetCommitData}
            githubFetchJobsForRun={props.githubFetchJobsForRun}
            githubFetchCommitData={props.githubFetchCommitData}
            githubProviderStatus={props.githubProviderStatus}
            onOpenJobLog={props.onOpenJobLog}
            jenkinsGetCommitData={props.jenkinsGetCommitData}
            jenkinsFetchJobsForRun={props.jenkinsFetchJobsForRun}
            jenkinsFetchCommitData={props.jenkinsFetchCommitData}
            onOpenJenkinsJobLog={props.onOpenJenkinsJobLog}
            jenkinsProviderStatus={props.jenkinsProviderStatus}
            openshiftGetCommitData={props.openshiftGetCommitData}
            openshiftFetchCommitData={props.openshiftFetchCommitData}
            openshiftIsLoading={props.openshiftIsLoading}
            openshiftLiveAge={props.openshiftLiveAge}
            onOpenOpenShiftResource={props.onOpenOpenShiftResource}
            openshiftProviderStatus={props.openshiftProviderStatus}
            snykGetCommitData={props.snykGetCommitData}
            snykIsScanning={props.snykIsScanning}
            snykScanCommit={props.snykScanCommit}
            snykProviderStatus={props.snykProviderStatus}
          />
        </Show>
      </scrollbox>
    </box>
  );
}
