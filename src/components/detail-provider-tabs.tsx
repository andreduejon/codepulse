import { For, Show } from "solid-js";
import { type ProviderStatus, useAppState } from "../context/state";
import { DETAIL_ENTRIES } from "../providers/detail-entries";
import type { ProviderDetailView } from "../providers/provider";
import type { DetailEntryContext } from "../providers/shared/detail-entry";
import type { DetailViewProps } from "./detail-types";

/** The provider tabs of a committed commit's detail view: the active one, from its provider's entry. */
export function ProviderDetailTabs(
  props: Readonly<{
    view: DetailViewProps;
    sha: string;
    /** Tab state across tab switches (owned by the detail view, which outlives its tabs). */
    memory: <T>(key: string, create: () => T) => T;
  }>,
) {
  const { state, actions } = useAppState();
  const context: DetailEntryContext = {
    get sha() {
      return props.sha;
    },
    cursor: {
      navRef: props.view.navRef,
      detailCursorIndex: () => state.detailCursorIndex(),
      detailFocused: () => state.detailFocused(),
      setDetailCursorAction: actions.setDetailCursorAction,
      setDetailCursorIndex: actions.setDetailCursorIndex,
      setDetailCursorShortcut: actions.setDetailCursorShortcut,
    },
    get mouseEnabled() {
      return props.view.mouseEnabled;
    },
    get onMouseFocus() {
      return props.view.onMouseFocus;
    },
    get contentWidth() {
      return props.view.contentWidth;
    },
    unavailable: (view: ProviderDetailView, status: ProviderStatus | undefined): string | null => {
      if (status?.kind === "unavailable") return status.message;
      state.providers.getVersion();
      return state.providers.get(view)?.isAvailable() === false ? "Setup incomplete." : null;
    },
    memory: (key, create) => props.memory(key, create),
  };

  return (
    <For each={DETAIL_ENTRIES}>
      {([tab, entry]) => (
        <Show when={state.detailActiveTab() === tab}>{entry.render(props.view.providers ?? {}, context)}</Show>
      )}
    </For>
  );
}
