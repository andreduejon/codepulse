/**
 * The Dashboard beyond its list: what it reads (cached and held events, the providers turned on), the selected
 * event's details (its provider's tabs and Info, in the side panel or the compact dialog), its keys in both layouts,
 * `r`, and showing an event's commit in its provider's view.
 */

import { KeyEvent, parseKeypress, type ScrollBoxRenderable } from "@opentui/core";
import { type Accessor, batch, createEffect, createMemo, createSignal, Show, untrack } from "solid-js";
import { DashboardCommitFields, type DashboardDetailTab } from "../components/dashboard-detail";
import CommitDetailView from "../components/detail";
import type { createDetailMemory } from "../components/detail-memory";
import { ProviderTab } from "../components/detail-provider-tabs";
import type { DetailNavRef } from "../components/detail-types";
import type { UIMessage } from "../components/message-box";
import type { AppActions, AppState, DetailTab } from "../context/state";
import type { Theme } from "../context/theme";
import type { DashboardEvent } from "../core/dashboard/events";
import type { GitPort } from "../core/git/port";
import { type EventSource, isProviderDetailView, type ProviderView, providerDetailTab } from "../core/provider-model";
import { markLegend } from "../dashboard/legend";
import type { CommitInfo } from "../dashboard/load";
import { loadAppEvents } from "../dashboard/load";
import { type DashboardApp, useDashboard } from "../dashboard/use-dashboard";
import { handleDetailKey } from "../hooks/handle-detail-keys";
import { openGraphDetails } from "../hooks/handle-graph-keys";
import { providerColors } from "../providers/colors";
import { detailEntryFor } from "../providers/detail-entries";
import { repoDisplayName } from "../utils/group-repos";
import { openUrl } from "../utils/open-url";
import type { DialogHost, LayoutMode } from "./dialogs";
import type { ProviderHost } from "./providers";
import type { RepoSettings } from "./repo-settings";

export function useDashboardController(opts: {
  state: AppState;
  actions: AppActions;
  repoPath: Accessor<string>;
  /** Git, through the app's port: the Dashboard reads its main branch and commits with it. */
  git: GitPort;
  settings: RepoSettings;
  providers: ProviderHost;
  dialogs: Pick<DialogHost, "dialog" | "setDialog">;
  layoutMode: Accessor<LayoutMode>;
  /** The graph's details: "Show in provider" opens them on the event's commit. */
  graphNavRef: DetailNavRef;
  detailMemory: ReturnType<typeof createDetailMemory>;
  theme: Accessor<Theme>;
  /** Opens another repository (an event of another app). */
  switchTo: (path: string) => void;
  setGitNotice: (message: UIMessage | null) => void;
  /** The graph's search and path filter close: they don't work on the Dashboard. */
  closeSearch: () => void;
}) {
  const { state, actions, layoutMode, providers } = opts;
  const { dialog, setDialog } = opts.dialogs;
  /** The Dashboard's own details: cursor, tab and focus, apart from the graph's. */
  const detail = state.detailFor("dashboard");
  const setDetail = actions.detailFor("dashboard");
  /** The Dashboard's own rows to activate and scroll to: the graph's details never call into them, nor these into it. */
  const detailNavRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
    itemRefs: [],
  };

  // ── Dashboard ─────────────────────────────────────────────────────────────
  /** The open repository: another app of its group is a click on its badge away. */
  const dashboardApp = createMemo(
    (): DashboardApp => ({
      path: opts.repoPath(),
      name: repoDisplayName({ path: opts.repoPath(), ...opts.settings.display() }),
    }),
  );
  const dashboardShown = () => state.activeProviderView() === "dashboard";
  /** What the open app's providers hold now, as dashboard events: a running build is only here, not in a cache. */
  const heldDashboardEvents = createMemo(() => {
    if (!dashboardShown()) return [];
    return providers.heldEvents(opts.repoPath());
  });
  /** The providers turned on: the dashboard leaves out a turned-off one's cached events. */
  const dashboardSources = createMemo(() => {
    state.providers.getVersion();
    return new Set(state.providers.getEnabledViews().filter((view): view is EventSource => view !== "dashboard"));
  });
  const dashboard = useDashboard({
    app: dashboardApp,
    active: dashboardShown,
    live: heldDashboardEvents,
    shownSources: dashboardSources,
    settings: opts.settings.dashboard,
    // The graph read again (a refresh, a fetch, a new commit): its main branch may have moved.
    changes: () => state.graphRows(),
    load: (path, options) => loadAppEvents(path, options, opts.git),
  });
  // A scan on the dashboard: its cached result, also for a commit the graph doesn't hold (Snyk reads the graph's).
  createEffect(() => {
    const event = dashboard.selected();
    if (dashboardShown() && event?.source === "snyk") void providers.snyk.readCachedScan(event.sha);
  });
  const dashboardAppName = () => dashboardApp().name;
  // No commit details or graph search beside the dashboard; its own details leave with it.
  createEffect(() => {
    if (dashboardShown()) {
      setDetail.setDetailFocused(false);
      untrack(opts.closeSearch);
    } else if (untrack(dialog) === "dashboard-event") setDialog(null);
  });
  let dashboardDialogScrollbox: ScrollBoxRenderable | undefined;

  /** A commit to select once its repository's graph is there, in the view of the provider that showed it. */
  const [pendingGraphJump, setPendingGraphJump] = createSignal<{ sha: string; view: ProviderView } | null>(null);
  /** The event's commit in its provider's view, with that provider's details open on it. */
  const showInGraph = (event: DashboardEvent) => {
    if (event.app !== opts.repoPath()) opts.switchTo(event.app);
    setPendingGraphJump({ sha: event.sha, view: event.source });
  };
  createEffect(() => {
    const jump = pendingGraphJump();
    if (!jump || state.loading()) return;
    const rows = state.graphRows();
    if (rows.length === 0) return;
    const index = rows.findIndex(row => row.commit.hash === jump.sha);
    // Not in the graph (older than its loaded pages, or outside its branch filter): stay, and say so, rather than show
    // another commit in the provider's view.
    if (index < 0) {
      setPendingGraphJump(null);
      opts.setGitNotice({
        kind: "info",
        source: "Dashboard",
        title: `${jump.sha.slice(0, 7)} is not in the graph`,
        message: "It is older than the graph's loaded history, or outside its branch filter.",
      });
      return;
    }
    batch(() => {
      setPendingGraphJump(null);
      actions.setActiveProviderView(state.providers.getEnabledViews().includes(jump.view) ? jump.view : "git");
      actions.setCursorIndex(index);
      actions.setScrollTargetIndex(index);
    });
    // Its details, as the dashboard showed them and as Enter in the graph opens them: focused beside the graph, the
    // details dialog with the keyboard in the compact layout.
    untrack(() => openGraphDetails({ state, actions, layoutMode, setDialog, detailNavRef: opts.graphNavRef }));
  });

  /** The selected event's tabs: its provider's own (Snyk's two), then Info, its commit as the graph shows it. */
  const dashboardTabsFor = (event: DashboardEvent | null): DashboardDetailTab[] => {
    if (!event) return [];
    const tabs: DashboardDetailTab[] = [];
    if (isProviderDetailView(event.source)) {
      const own = providerDetailTab(event.source);
      if (own) tabs.push({ id: own.id, label: own.label });
      if (event.source === "snyk") tabs.push({ id: "snyk-deps", label: "Dependencies" });
    }
    tabs.push({ id: "info", label: "Info" });
    return tabs;
  };
  /** The tab shown: the one chosen for this event's provider, else its first. */
  const dashboardActiveTab = (): DetailTab | null => {
    const tabs = dashboardTabsFor(dashboard.selected());
    const chosen = detail.detailActiveTab();
    return tabs.some(tab => tab.id === chosen) ? chosen : (tabs[0]?.id ?? null);
  };
  /** The provider tab takes the keyboard (→ beside the events, the compact dialog). */
  const focusDashboardTab = (tab: DetailTab | null = dashboardActiveTab()) => {
    if (!tab) return false;
    batch(() => {
      setDetail.setDetailCursorAction(null);
      setDetail.setDetailActiveTab(tab);
      setDetail.setDetailCursorIndex(0);
      setDetail.setDetailFocused(true);
    });
    return true;
  };
  // Another event, or the dashboard shown again: its first tab, at the top, and the events keep the keyboard. A re-read
  // gives the same event as a new object: only another id counts (a mutable ref, so it outlives the effect's runs).
  const shownEvent = { key: null as string | null };
  createEffect(() => {
    const id = dashboard.selected()?.id ?? null;
    const key = dashboardShown() && id !== null ? id : null;
    if (key === shownEvent.key) return;
    shownEvent.key = key;
    if (key === null) return;
    untrack(() => {
      batch(() => {
        setDetail.setDetailCursorAction(null);
        setDetail.setDetailActiveTab(dashboardTabsFor(dashboard.selected())[0]?.id ?? "info");
        setDetail.setDetailCursorIndex(0);
        if (dialog() !== "dashboard-event") setDetail.setDetailFocused(false);
      });
    });
  });
  let dashboardDetailScrollbox: ScrollBoxRenderable | undefined;
  /** The provider tab in the dashboard's details (both layouts): the same tab as in that provider's view. */
  const dashboardTabProps = () => ({
    tabs: () => dashboardTabsFor(dashboard.selected()),
    activeTab: dashboardActiveTab,
    focused: () => detail.detailFocused(),
    onSelectTab: (tab: DetailTab) => focusDashboardTab(tab),
    onMouseFocus: () => focusDashboardTab(),
    legend: () => {
      const event = dashboard.selected();
      const tab = dashboardActiveTab();
      if (!event || !tab) return event ? markLegend(event.source) : null;
      return detailEntryFor(tab)?.legend(providers.detailSources, event.sha) ?? null;
    },
    renderTab: (event: DashboardEvent, tab: DetailTab, info: Accessor<CommitInfo | null>) =>
      tab === "info" ? (
        <DashboardInfoTab event={event} info={info} />
      ) : (
        <ProviderTab
          tab={tab}
          sha={event.sha}
          providers={providers.detailSources}
          navRef={detailNavRef}
          mouseEnabled={dialog() == null || dialog() === "dashboard-event"}
          onMouseFocus={() => focusDashboardTab(tab)}
          memory={opts.detailMemory}
          // The event's own run, build or resource: open, marked in the dashboard's color like its row.
          target={event.entry}
          targetColor={providerColors(opts.theme(), "dashboard").bg}
        />
      ),
  });
  /**
   * The event's commit as the graph's Info tab shows it (refs, hash, author, date, subject, body, children, parents),
   * while the graph holds it; one older than the graph's pages shows what Git reads.
   */
  const DashboardInfoTab = (infoProps: { event: DashboardEvent; info: Accessor<CommitInfo | null> }) => {
    const row = () => state.graphRows().find(graphRow => graphRow.commit.hash === infoProps.event.sha) ?? null;
    return (
      <Show when={row()} fallback={<DashboardCommitFields event={infoProps.event} commit={infoProps.info()} />}>
        {graphRow => (
          <CommitDetailView
            commit={() => graphRow().commit}
            row={graphRow}
            detail={() => ({ ...graphRow().commit, body: infoProps.info()?.body ?? graphRow().commit.body, files: [] })}
            navRef={detailNavRef}
            memory={opts.detailMemory}
            mouseEnabled={dialog() == null || dialog() === "dashboard-event"}
            onMouseFocus={() => focusDashboardTab("info")}
            // A child or parent: that commit in the graph.
            onJumpToCommit={hash => setPendingGraphJump({ sha: hash, view: "git" })}
          />
        )}
      </Show>
    );
  };
  /** The dashboard's `r` (and its footer hint): what is cached at once, then every provider fetched again. */
  const refreshDashboard = () => {
    void dashboard.reload();
    void providers.refreshActive();
  };
  /** Keys while the provider tab has the keyboard, as in the graph's details. */
  const handleDashboardTabKey = (event: KeyEvent) =>
    handleDetailKey(event, {
      state,
      actions,
      // The compact dialog holds the tab like the graph's details dialog: ← on the first tab stays.
      dialog: () => (dialog() === "dashboard-event" ? "detail" : dialog()),
      getDetailScrollboxRef: () =>
        dialog() === "dashboard-event" ? dashboardDialogScrollbox : dashboardDetailScrollbox,
      detailNavRef,
      tabs: () => dashboardTabsFor(dashboard.selected()).map(tab => tab.id),
    });
  /** Enter: beside the side panel, the event in the graph; without it, its details first, like the graph's. */
  const activateDashboard = () => {
    const event = dashboard.activate();
    if (!event) return;
    if (layoutMode() === "compact") {
      setDialog("dashboard-event");
      focusDashboardTab();
    } else showInGraph(event);
  };
  const showSelectedInGraph = () => {
    const event = dashboard.selected();
    // The event list has the keyboard until the jump lands: then the provider's details take it (a commit outside
    // the graph only gets a notice).
    setDetail.setDetailFocused(false);
    setDialog(null);
    if (event) showInGraph(event);
  };
  const openSelectedEvent = () => {
    const url = dashboard.selected()?.url;
    if (url) openUrl(url);
  };
  /** Keys in the compact details: Enter shows the event in the graph, ↑/↓ scroll, Esc (the cascade) closes. */
  /** The tab's row has its own page (a job, a resource): `o` opens it there rather than the event's. */
  const dashboardRowOpens = () => detail.detailFocused() && detail.detailCursorShortcut()?.key === "o";
  /** The compact dialog's `o open` hint, clicked: what `o` does there. */
  const openFromDashboardDialog = () => {
    if (!dashboardRowOpens()) return openSelectedEvent();
    const key = parseKeypress("o");
    if (key) handleDashboardTabKey(new KeyEvent(key));
  };
  const handleDashboardDialogKey = (event: KeyEvent) => {
    const scrollbox = dashboardDialogScrollbox;
    // `o`: the tab's row when it has its own page (a job, a resource), as in the wide layout; else the event's.
    if (event.name === "o" && !dashboardRowOpens()) {
      event.preventDefault();
      openSelectedEvent();
      return;
    }
    if (event.name === "s" && dashboardActiveTab()) {
      event.preventDefault();
      showSelectedInGraph();
      return;
    }
    if (detail.detailFocused() && dashboardActiveTab()) {
      handleDashboardTabKey(event);
      return;
    }
    switch (event.name) {
      case "return":
      case "enter":
        showSelectedInGraph();
        break;
      case "o":
        openSelectedEvent();
        break;
      case "down":
      case "j":
        scrollbox?.scrollBy(event.shift ? 10 : 1, "absolute");
        break;
      case "up":
      case "k":
        scrollbox?.scrollBy(event.shift ? -10 : -1, "absolute");
        break;
      case "pagedown":
        scrollbox?.scrollBy(1, "viewport");
        break;
      case "pageup":
        scrollbox?.scrollBy(-1, "viewport");
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const handleDashboardKey = (event: KeyEvent) => {
    if (dialog() === "dashboard-event") {
      handleDashboardDialogKey(event);
      return;
    }
    if (detail.detailFocused() && layoutMode() === "normal") {
      handleDashboardTabKey(event);
      return;
    }
    const step = event.shift ? 10 : 1;
    switch (event.name) {
      case "right":
      case "l":
        if (layoutMode() === "normal") focusDashboardTab();
        break;
      case "down":
      case "j":
        dashboard.move(step);
        break;
      case "up":
      case "k":
        dashboard.move(-step);
        break;
      case "pagedown":
        dashboard.move(10);
        break;
      case "pageup":
        dashboard.move(-10);
        break;
      case "g":
        dashboard.moveToEnd(event.shift ? "last" : "first");
        break;
      case "home":
        dashboard.moveToEnd("first");
        break;
      case "end":
        dashboard.moveToEnd("last");
        break;
      case "return":
      case "enter":
        activateDashboard();
        break;
      case "r":
        refreshDashboard();
        break;
      case "o":
        if (!dashboard.selected()?.url) return;
        openSelectedEvent();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return {
    dashboard,
    dashboardShown,
    dashboardAppName,
    showSelectedInGraph,
    dashboardTabProps,
    refreshDashboard,
    handleDashboardKey,
    openFromDashboardDialog,
    dashboardRowOpens,
    setDialogScrollbox: (element: ScrollBoxRenderable) => {
      dashboardDialogScrollbox = element;
    },
    setDetailScrollbox: (element: ScrollBoxRenderable) => {
      dashboardDetailScrollbox = element;
    },
  };
}

export type DashboardController = ReturnType<typeof useDashboardController>;
