import { For, Show } from "solid-js";
import type { ProviderDetailView } from "../../core/provider-model";
import { type DetailTab, type ProviderStatus, useAppState } from "../context/state";
import { DETAIL_ENTRIES, detailEntryFor, type ProviderDetailSources } from "../providers/detail-entries";
import type { DetailEntryContext } from "../providers/shared/detail-entry";
import type { DetailMemory } from "./detail-memory";
import type { DetailNavRef, DetailViewProps } from "./detail-types";

/**
 * One provider tab for a commit, with the detail cursor: the graph's details render the active one, the dashboard's
 * the selected event's.
 */
export function ProviderTab(
  props: Readonly<{
    tab: DetailTab;
    sha: string;
    providers: Partial<ProviderDetailSources>;
    navRef?: DetailNavRef;
    mouseEnabled?: boolean;
    onMouseFocus?: () => void;
    contentWidth?: number;
    /** Tab state while a tab is not shown (owned by the app, which outlives both layouts). */
    memory: DetailMemory;
    /** The entry to open and mark (the dashboard's event), and its color. */
    target?: string;
    targetColor?: string;
  }>,
) {
  const { state, actions } = useAppState();
  const context: DetailEntryContext = {
    get sha() {
      return props.sha;
    },
    cursor: {
      get navRef() {
        return props.navRef;
      },
      detailCursorIndex: () => state.detailCursorIndex(),
      detailFocused: () => state.detailFocused(),
      setDetailCursorAction: actions.setDetailCursorAction,
      setDetailCursorIndex: actions.setDetailCursorIndex,
      setDetailCursorShortcut: actions.setDetailCursorShortcut,
    },
    get mouseEnabled() {
      return props.mouseEnabled;
    },
    get onMouseFocus() {
      return props.onMouseFocus;
    },
    get contentWidth() {
      return props.contentWidth;
    },
    unavailable: (view: ProviderDetailView, status: ProviderStatus | undefined): string | null => {
      if (status?.kind === "unavailable") return status.message;
      state.providers.getVersion();
      return state.providers.get(view)?.isAvailable() === false ? "Setup incomplete." : null;
    },
    get memory() {
      return props.memory;
    },
    get target() {
      return props.target;
    },
    get targetColor() {
      return props.targetColor;
    },
  };
  return <>{detailEntryFor(props.tab)?.render(props.providers, context)}</>;
}

/** The provider tabs of a committed commit's detail view: the active one, from its provider's entry. */
export function ProviderDetailTabs(
  props: Readonly<{
    view: DetailViewProps;
    sha: string;
    /** Tab state while a tab is not shown (owned by the app, which outlives both layouts). */
    memory: DetailMemory;
  }>,
) {
  const { state } = useAppState();
  return (
    <For each={DETAIL_ENTRIES}>
      {([tab]) => (
        <Show when={state.detailActiveTab() === tab}>
          <ProviderTab
            tab={tab}
            sha={props.sha}
            providers={props.view.providers ?? {}}
            navRef={props.view.navRef}
            mouseEnabled={props.view.mouseEnabled}
            onMouseFocus={props.view.onMouseFocus}
            contentWidth={props.view.contentWidth}
            memory={props.memory}
          />
        </Show>
      )}
    </For>
  );
}
