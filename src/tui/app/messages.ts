/**
 * The message box and the tab notice: what shows, in which order, and what was closed. Git errors and notices come
 * first, then the open provider's problem, then on the Dashboard every provider's failed fetch in one box, and
 * elsewhere a Snyk scan that failed in the background. `:clear` and `✕` close them.
 */
import { createEffect, createMemo, createSignal, type Setter } from "solid-js";
import { BANNER, displayBanner } from "../../core/banner";
import type { FastForwardResult } from "../../core/git/log";
import { isUncommittedHash } from "../../core/git/types";
import type { UIMessage } from "../components/message-box";
import { type AppActions, type AppState, providerIdle, providerStatusMessage } from "../context/state";
import { dashboardFetchMessage, type FetchError, fetchErrorKey } from "../dashboard/fetch-errors";
import { fastForwardMessage } from "../utils/fast-forward-message";
import { isTabNoticeStatus, type TabNotice, tabNoticeFor } from "./app-tab-notice";
import type { ProviderHost } from "./providers";

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
  /** The providers' failures in the background and their tab notices. */
  providers: Pick<ProviderHost, "backgroundErrors" | "tabNotice">;
}): MessageCenter {
  const { state, actions, providers } = opts;
  const names = state.providers.set;

  /** What the last fast-forward did (ctrl+f, `:pull`), or which branches it left behind. */
  const [gitNotice, setGitNotice] = createSignal<UIMessage | null>(null);

  /** The failed fetches and scans of the providers the dashboard shows, on any view: shown on the dashboard. */
  const dashboardErrors = createMemo<FetchError[]>(() => {
    const errors: FetchError[] = [];
    for (const { id } of names.definitions) {
      const status = state.providerStatusFor(id);
      if (status.kind === "error")
        errors.push({ source: names.displayName(id), message: displayBanner(status.message, status.message) });
    }
    // Work that failed in another view (a Snyk scan), unless the provider's status says the same already.
    for (const background of providers.backgroundErrors())
      if (!errors.some(error => error.source === background.source && error.message === background.message))
        errors.push({ source: background.source, message: background.message });
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
    if (names.isProvider(state.activeProviderView()) && message && !isTabNoticeStatus(status))
      return {
        kind: status.kind === "error" || status.kind === "warning" ? status.kind : ("info" as const),
        source: names.displayName(state.activeProviderView()),
        message: displayBanner(message, message),
      };

    // The dashboard fetches for every provider: their failures, in one box.
    if (state.activeProviderView() === "dashboard") {
      const dismissed = dismissedFetchErrors();
      return dashboardFetchMessage(dashboardErrors().filter(error => !dismissed.has(fetchErrorKey(error))));
    }

    // Work keeps running in other views (Snyk's scans); a failure must not pass silently. The view's own problems come
    // first.
    const [background] = providers.backgroundErrors();
    return background ? { kind: "error" as const, source: background.source, message: background.message } : null;
  });

  /** Scan notices closed with `✕` or `:clear`; a rescan changes the key and brings them back. */
  const [dismissedTabNotices, setDismissedTabNotices] = createSignal<ReadonlySet<string>>(new Set());
  const tabNotice = createMemo<TabNotice | null>(() => {
    const view = state.activeProviderView();
    const hash = state.selectedCommit()?.hash ?? "";
    const tab = state.detailActiveTab();
    const notice = tabNoticeFor({
      view,
      source: names.displayName(view),
      status: state.providerStatus(),
      providerNotice: hash && !isUncommittedHash(hash) ? providers.tabNotice(view, hash, tab) : null,
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
    for (const background of providers.backgroundErrors()) background.dismiss();
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
