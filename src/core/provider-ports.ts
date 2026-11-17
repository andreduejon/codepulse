/**
 * What every provider service gets from the app, and the part of the fetch lifecycle it uses. Plain types: the Solid
 * side builds them (providers/shared/app-port.ts).
 */

import type { GraphRow } from "../git/types";
import type { FetchLifecycle } from "./fetch-lifecycle";
import type { GraphBadge } from "./provider-model";
import type { ProviderStatus } from "./provider-status";

/** The app, as one provider sees it. */
export interface ProviderAppPort {
  repoPath: () => string;
  graphRows: () => readonly GraphRow[];
  /** The provider's own badges (on the dashboard, the shown view's are none). */
  badges: () => ReadonlyMap<string, GraphBadge>;
  status: () => ProviderStatus;
  setStatus: (status: ProviderStatus) => void;
  setBadges: (badges: Map<string, GraphBadge>) => void;
  /** A fetch that worked: the menu's Last refresh. */
  noteSuccess: () => void;
  suspended: () => boolean;
  view: () => string;
}

/** What of the lifecycle a provider service uses while it fetches. */
export type ProviderLifecycle = Pick<
  FetchLifecycle,
  | "getEpoch"
  | "isCurrent"
  | "noteFetchStarted"
  | "noteRefreshSettled"
  | "noteFetchResult"
  | "runRequest"
  | "trackFetch"
  | "fetchInitial"
  | "fetchRefresh"
  | "startAutoRefresh"
>;
