/** The app port a provider service gets (core/provider-ports.ts), built from the app's state and actions. */
import type { Accessor } from "solid-js";
import type { ProviderView } from "../../../core/provider-model";
import type { ProviderAppPort } from "../../../core/provider-ports";
import type { AppActions, AppState } from "../../context/state";

export function providerAppPort(
  state: AppState,
  actions: AppActions,
  id: ProviderView,
  suspended?: Accessor<boolean>,
): ProviderAppPort {
  return {
    repoPath: state.repoPath,
    graphRows: state.graphRows,
    badges: () => state.graphBadgesFor(id),
    status: () => state.providerStatusFor(id),
    setStatus: status => actions.setProviderStatus(id, status),
    setBadges: badges => actions.setGraphBadges(id, badges),
    noteSuccess: () => actions.setProviderLastSuccessfulRefresh(id, new Date()),
    suspended: () => suspended?.() ?? false,
    view: state.activeProviderView,
  };
}
