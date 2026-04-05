import type { ScrollBoxRenderable } from "@opentui/core";
import { For, Show } from "solid-js";
import packageJson from "../../package.json";
import { UNCOMMITTED_HASH } from "../constants";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import type { DiffTarget } from "../git/types";
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
}

/**
 * The detail panel content: tab bar + scrollable detail view + version badge.
 * Used in both:
 *  - Normal mode: right-side panel in two-column layout
 *  - Compact mode: inside a dialog overlay
 */
export default function DetailPanel(props: Readonly<DetailPanelProps>) {
  const { state } = useAppState();
  const { theme: t } = useTheme();

  const tabs = () => {
    const commit = state.selectedCommit();
    const isUncommitted = commit?.hash === UNCOMMITTED_HASH;
    const ud = state.uncommittedDetail();
    const cd = state.commitDetail();
    if (isUncommitted) {
      return [
        {
          id: "unstaged",
          label: `Unstaged${ud ? ` (${ud.unstaged.length})` : ""}`,
          disabled: ud ? ud.unstaged.length === 0 : false,
        },
        {
          id: "staged",
          label: `Staged${ud ? ` (${ud.staged.length})` : ""}`,
          disabled: ud ? ud.staged.length === 0 : false,
        },
        {
          id: "untracked",
          label: `Untracked${ud ? ` (${ud.untracked.length})` : ""}`,
          disabled: ud ? ud.untracked.length === 0 : false,
        },
      ];
    }
    return [
      {
        id: "files",
        label: `Files${cd?.files ? ` (${cd.files.length})` : ""}`,
        disabled: cd ? cd.files.length === 0 : false,
      },
      ...(state.stashByParent().has(commit?.hash ?? "")
        ? [
            {
              id: "stashes",
              label: `Stashes (${state.stashByParent().get(commit?.hash ?? "")?.length ?? 0})`,
              disabled: false,
            },
          ]
        : []),
      { id: "detail", label: "Details", disabled: false },
    ];
  };

  return (
    <>
      {/* Tab bar with top accent line per selected tab */}
      <box flexDirection="row" width="100%" flexShrink={0}>
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

      {/* Muted separator below tabs */}
      <box width="100%" border={["top"]} borderStyle="single" borderColor={t().border} />

      <scrollbox
        ref={props.scrollboxRef}
        flexGrow={1}
        scrollY
        scrollX={false}
        verticalScrollbarOptions={{ visible: false }}
      >
        <Show
          when={state.selectedCommit()?.hash !== UNCOMMITTED_HASH}
          fallback={
            <UncommittedDetailView
              onJumpToCommit={props.onJumpToCommit}
              onOpenDiff={props.onOpenDiff}
              navRef={props.navRef}
            />
          }
        >
          <CommitDetailView onJumpToCommit={props.onJumpToCommit} onOpenDiff={props.onOpenDiff} navRef={props.navRef} />
        </Show>
      </scrollbox>

      {/* Version — bottom-right, subtle */}
      <box flexDirection="row" width="100%">
        <box flexGrow={1} />
        <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {`v${packageJson.version}`}
        </text>
      </box>
    </>
  );
}
