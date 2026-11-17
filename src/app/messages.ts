/**
 * The message box and the tab notice: what shows, in which order, and what was closed. Git errors and notices come
 * first, then the open provider's problem, then on the Dashboard every provider's failed fetch in one box, and
 * elsewhere a Snyk scan that failed in the background. `:clear` and `✕` close them.
 */
import { createEffect, createMemo, createSignal, type Setter } from "solid-js";
import { isTabNoticeStatus, type TabNotice, tabNoticeFor } from "../app-tab-notice";
import type { UIMessage } from "../components/message-box";
import { isUncommittedHash } from "../constants";
import { type AppActions, type AppState, providerIdle, providerStatusMessage } from "../context/state";
import {
  DASHBOARD_FETCHING_PROVIDERS,
  dashboardFetchMessage,
  type FetchError,
  fetchErrorKey,
} from "../dashboard/fetch-errors";
import { BANNER, displayBanner } from "../debug/banner";
import type { FastForwardResult } from "../git/repo";
import { isProviderDetailView, providerDisplayName } from "../providers/provider";
import type { UseSnykResult } from "../providers/snyk/use-snyk";
import { fastForwardMessage } from "../utils/fast-forward-message";

export interface MessageCenter {
  /** The message box's message, or none. */
  screenMessage: () => UIMessage | null;
  /** The notice on the details' tab (a Snyk scan's or a provider's warning), or none. */
  tabNotice: () => TabNotice | null;
  /** A Git notice: what a fast-forward did, a commit the Dashboard couldn't show. */
  setGitNotice: Setter<UIMessage | null>;
  /** After a fetch: what moved, or which branches stayed behind (`explicit` for ctrl+f and `:pull`). */
  showFastForward: (result: FastForwardResult, explicit: boolean) => void;
  /** Another repository: the branches the last fetch left behind are not its own. */
  forgetFastForward: () => void;
  /** `✕` on the box and `:clear`. */
  clearScreenMessage: () => void;
  /** `✕` on the tab notice and `:clear`. */
  dismissTabNotice: () => void;
}

export function useMessageCenter(opts: {
  state: AppState;
  actions: AppActions;
  snyk: Pick<UseSnykResult, "backgroundError" | "dismissBackgroundError" | "getCommitData">;
}): MessageCenter {
  const { state, actions, snyk } = opts;

  /** What the last fast-forward did (ctrl+f, `:pull`), or which branches it left behind. */
  const [gitNotice, setGitNotice] = createSignal<UIMessage | null>(null);

  /** The failed fetches and scans of the providers the dashboard shows, on any view: shown on the dashboard. */
  const dashboardErrors = createMemo<FetchError[]>(() => {
    const errors: FetchError[] = [];
    for (const view of DASHBOARD_FETCHING_PROVIDERS) {
      const status = state.providerStatusFor(view);
      if (status.kind === "error")
        errors.push({ source: providerDisplayName(view), message: displayBanner(status.message, status.message) });
    }
    // A scan that failed in another view, unless Snyk's status says the same already.
    const scan = snyk.backgroundError();
    if (scan && !errors.some(error => error.source === "Snyk" && error.message === scan))
      errors.push({ source: "Snyk", message: scan });
    return errors;
  });
  /** Errors closed on the dashboard; one that goes away is forgotten, so its next failure shows again. */
  const [dismissedFetchErrors, setDismissedFetchErrors] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(() => {
    const current = new Set(dashboardErrors().map(fetchErrorKey));
    setDismissedFetchErrors(dismissed => {
      const kept = [...dismissed].filter(key => current.has(key));
      return kept.length === dismissed.size ? dismissed : new Set(kept);
    });
  });

  const screenMessage = createMemo<UIMessage | null>(() => {
    const err = state.error();
    if (err) return { kind: "error" as const, source: "Git", message: displayBanner(err, BANNER.git.fetchFailed) };
    const notice = gitNotice();
    if (notice) return notice;

    const status = state.providerStatus();
    const message = providerStatusMessage(status);
    if (isProviderDetailView(state.activeProviderView()) && message && !isTabNoticeStatus(status))
      return {
        kind: status.kind === "error" || status.kind === "warning" ? status.kind : ("info" as const),
        source: providerDisplayName(state.activeProviderView()),
        message: displayBanner(message, message),
      };

    // The dashboard fetches for every provider: their failures, in one box.
    if (state.activeProviderView() === "dashboard") {
      const dismissed = dismissedFetchErrors();
      return dashboardFetchMessage(dashboardErrors().filter(error => !dismissed.has(fetchErrorKey(error))));
    }

    // Snyk scans keep running in other views; a failure must not pass silently. The view's own problems come first.
    const background = snyk.backgroundError();
    return background ? { kind: "error" as const, source: "Snyk", message: background } : null;
  });

  /** Scan notices closed with `✕` or `:clear`; a rescan changes the key and brings them back. */
  const [dismissedTabNotices, setDismissedTabNotices] = createSignal<ReadonlySet<string>>(new Set());
  const tabNotice = createMemo<TabNotice | null>(() => {
    const view = state.activeProviderView();
    const hash = state.selectedCommit()?.hash ?? "";
    const notice = tabNoticeFor({
      view,
      source: providerDisplayName(view),
      status: state.providerStatus(),
      tab: state.detailActiveTab(),
      snykScan: hash && !isUncommittedHash(hash) ? snyk.getCommitData(hash) : null,
    });
    return notice && !dismissedTabNotices().has(notice.key) ? notice : null;
  });
  /** Closes the tab notice: provider warnings clear the status, scan notices are remembered by key. */
  const dismissTabNotice = () => {
    const notice = tabNotice();
    if (!notice) return;
    if (notice.fromStatus) actions.setProviderStatus(state.activeProviderView(), providerIdle());
    else setDismissedTabNotices(keys => new Set([...keys, notice.key]));
  };

  /** Dismisses the banner: `:clear` (which also clears Debug and the tab notice) or its `✕`. */
  const clearScreenMessage = () => {
    if (state.activeProviderView() === "dashboard")
      setDismissedFetchErrors(dismissed => new Set([...dismissed, ...dashboardErrors().map(fetchErrorKey)]));
    actions.setError(null);
    setGitNotice(null);
    snyk.dismissBackgroundError();
    // Only a status the banner showed; a loading provider keeps its spinner.
    if (providerStatusMessage(state.providerStatus()))
      actions.setProviderStatus(state.activeProviderView(), providerIdle());
  };

  /**
   * The branches the last fetch left behind, so Auto fetch doesn't bring back a warning that was closed while nothing
   * changed. A mutable ref: it outlives the effects and timers that fetch.
   */
  const fastForwardNotice = { skipped: "" };
  const showFastForward = (result: FastForwardResult, explicit: boolean) => {
    const message = fastForwardMessage(result, explicit);
    const skipped = JSON.stringify(result.skipped);
    const repeated = skipped === fastForwardNotice.skipped;
    fastForwardNotice.skipped = result.skipped.length > 0 ? skipped : "";
    if (explicit) {
      setGitNotice(message);
      return;
    }
    // After f or Auto fetch: a warning shows once, and goes once every branch it named moved.
    if (!message) {
      if (gitNotice()?.kind === "warning" && gitNotice()?.source === "Git") setGitNotice(null);
      return;
    }
    if (!repeated) setGitNotice(message);
  };

  return {
    screenMessage,
    tabNotice,
    setGitNotice,
    showFastForward,
    forgetFastForward: () => {
      fastForwardNotice.skipped = "";
    },
    clearScreenMessage,
    dismissTabNotice,
  };
}
