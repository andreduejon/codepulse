import { MouseButton, type ScrollBoxRenderable } from "@opentui/core";
import { batch, createSignal, For, onCleanup, Show } from "solid-js";
import type { TabNotice } from "../app-tab-notice";
import { isUncommittedHash } from "../constants";
import type { DetailTab } from "../context/state";
import { useAppState } from "../context/state";
import type { DiffTarget } from "../git/types";
import { useT } from "../hooks/use-t";
import { detailEntryFor, type ProviderDetailSources } from "../providers/detail-entries";
import { providerDetailTab } from "../providers/provider";
import { DetailLegend } from "../providers/shared/detail-legend";
import { scheduleScrollIntoView, scrollElementIntoView } from "../utils/scroll";
import { getAvailableTabs } from "../utils/tab-utils";
import CommitDetailView from "./detail";
import type { DetailNavRef } from "./detail-types";
import MessageBox from "./message-box";
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
  /** What each provider hands its detail tabs (see `providers/detail-entries.ts`). */
  providers?: Partial<ProviderDetailSources>;
  /** Notice pinned under the tab content ("works, but incomplete"); see `tabNoticeFor`. */
  tabNotice?: TabNotice | null;
  onDismissTabNotice?: () => void;
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
  const scrollToCursor = () =>
    scheduleScrollIntoView(props.navRef, () => {
      const row = props.navRef.itemRefs[state.detailCursorIndex()];
      return !!scrollbox && !!row && scrollElementIntoView(scrollbox, row, 1);
    });
  props.navRef.scrollToCursor = scrollToCursor;
  onCleanup(() => {
    if (props.navRef.scrollToCursor === scrollToCursor) {
      delete props.navRef.scrollToCursor;
      if (props.navRef.scrollTimer) clearTimeout(props.navRef.scrollTimer);
    }
  });

  /** The active provider's source, if it has one (not in the Git view). */
  const providerSource = () => {
    const view = state.activeProviderView();
    return view === "git" ? undefined : props.providers?.[view];
  };

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
        getCommitData: providerSource()?.getCommitData,
        providerLoading: providerSource()?.status?.kind === "loading",
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
      ...(available.has("snyk-deps") ? [{ id: "snyk-deps" as const, label: "Dependencies", disabled: false }] : []),
      ...(available.has("stashes")
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

  /**
   * Snyk Vulnerabilities: fix and exploit markers; Dependencies: severity triangles; OpenShift, Jenkins and GitHub:
   * status marks. Only when there is something to explain (findings, resources, builds).
   */
  const legend = () => {
    const hash = state.selectedCommit()?.hash ?? "";
    if (isUncommittedHash(hash)) return null;
    const items = detailEntryFor(state.detailActiveTab())?.legend(props.providers ?? {}, hash);
    return items ? { items } : null;
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
                flexBasis={tab.label.length + 2}
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
              contentWidth={props.contentWidth}
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
            providers={props.providers}
          />
        </Show>
      </scrollbox>
      <Show when={props.tabNotice}>
        {notice => (
          <>
            <box height={1} flexShrink={0} />
            <box flexShrink={0}>
              <MessageBox
                kind={notice().kind}
                variant="inset"
                title={notice().title}
                message={notice().detail.join("\n")}
                entries={notice().entries}
                detail={notice().footer}
                mouseEnabled={props.mouseEnabled}
                onDismiss={props.onDismissTabNotice}
              />
            </box>
          </>
        )}
      </Show>
      <Show when={legend()}>
        {legend => (
          <>
            <box height={1} flexShrink={0} />
            <DetailLegend items={legend().items} />
          </>
        )}
      </Show>
    </box>
  );
}
