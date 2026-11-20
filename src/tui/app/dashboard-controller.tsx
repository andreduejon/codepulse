/**
 * The Dashboard beyond its list: what it reads (cached and held events, the providers turned on), the selected
 * event's details (its provider's tabs and Info, in the side panel or the compact dialog), its keys in both layouts,
 * `r`, and showing an event's commit in its provider's view.
 */

import { KeyEvent, parseKeypress, type ScrollBoxRenderable } from "@opentui/core";
import { type Accessor, batch, createEffect, createMemo, createSignal, Show, untrack } from "solid-js";
import type { DashboardEvent } from "../../core/dashboard/events";
import type { CommitInfo, ReadOptions } from "../../core/dashboard/load";
import type { EventSource, ProviderView } from "../../core/provider-model";
import { DashboardCommitFields, type DashboardDetailTab } from "../components/dashboard-detail";
import CommitDetailView from "../components/detail";
import type { createDetailMemory } from "../components/detail-memory";
import { ProviderTab } from "../components/detail-provider-tabs";
import type { DetailNavRef } from "../components/detail-types";
import type { UIMessage } from "../components/message-box";
import type { AppActions, AppState, DetailTab } from "../context/state";
import type { Theme } from "../context/theme";
import { markLegend } from "../dashboard/legend";
import { type DashboardApp, useDashboard } from "../dashboard/use-dashboard";
import { handleDetailKey } from "../hooks/handle-detail-keys";
import { openGraphDetails } from "../hooks/handle-graph-keys";
import { providerColors } from "../providers/colors";
import type { AnyProviderModule } from "../providers/module";
import { repoDisplayName } from "../utils/group-repos";
import { scheduleScrollIntoView, scrollElementIntoView } from "../utils/scroll";
import type { DialogHost, LayoutMode } from "./dialogs";
import type { ProviderHost } from "./providers";
import type { RepoSettings } from "./repo-settings";

export function useDashboardController(opts: {
  state: AppState;
  actions: AppActions;
  repoPath: Accessor<string>;
  /** Reads an app's Dashboard events (the root gives the app's Git and the provider caches). */
  loadEvents: (app: string, options: ReadOptions) => Promise<DashboardEvent[]>;
  /** Calls back after each provider write to the caches; returns the function that stops it. */
  onCacheWrite: (listener: (repoPath: string) => void) => () => void;
  /** Opens an event's page in the browser. */
  openUrl: (url: string | undefined) => void;
  settings: RepoSettings;
  providers: ProviderHost;
  /** Each provider's terminal module: its colors and its events' legend. */
  modules: readonly AnyProviderModule[];
  dialogs: Pick<DialogHost, "dialog" | "setDialog" | "openDiff">;
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
    load: opts.loadEvents,
    onCacheWrite: opts.onCacheWrite,
  });
  // An event's provider reads what its tab will show, also for a commit the graph doesn't hold (Snyk: the cached scan).
  createEffect(() => {
    const event = dashboard.selected();
    if (dashboardShown() && event) providers.dashboardSelected(event);
  });
  const dashboardAppName = () => dashboardApp().name;
  // No graph search beside the dashboard; its compact details dialog leaves with it (its details keep their state).
  createEffect(() => {
    if (dashboardShown()) untrack(opts.closeSearch);
    else if (untrack(dialog) === "dashboard-event") setDialog(null);
  });
  let dashboardDialogScrollbox: ScrollBoxRenderable | undefined;

  /** A commit to select once its repository's graph is there, in the view of the provider that showed it. */
  const [pendingGraphJump, setPendingGraphJump] = createSignal<{
    sha: string;
    view: ProviderView;
    tab?: string;
    entry?: string;
  } | null>(null);
  /**
   * The event's commit in its provider's view, with that provider's details open on it, on the event's own tab: the one
   * it names, else its provider's first (also when the graph was left on that commit with another tab open).
   */
  const showInGraph = (event: DashboardEvent) => {
    if (event.app !== opts.repoPath()) opts.switchTo(event.app);
    const tab = event.tab ?? state.providers.set.detailTab(event.source)?.id;
    setPendingGraphJump({
      sha: event.sha,
      view: event.source,
      ...(tab ? { tab } : {}),
      ...(event.entry ? { entry: event.entry } : {}),
    });
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
      // The graph's details open on the event's tab when its commit shows next (use-detail-loader reads it once).
      opts.graphNavRef.pendingTab = jump.tab;
      // And the cursor on the event's own row in it (a run, a build, a warning, a pull request).
      actions.setGraphDetailTarget(jump.entry ? { sha: jump.sha, entry: jump.entry } : null);
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
    // A tab only some commits have (GitHub's Pull requests) when this one has it, with its label for it.
    const own = state.providers.set.tabsOf(event.source).flatMap(tab => {
      const label = providers.details.label(tab.id, event.sha);
      return label === null ? [] : [{ ...tab, label: label ?? tab.label }];
    });
    return [...own, { id: "info", label: "Info" }];
  };
  /** The tab an event opens on: the one it names (an OpenShift warning: Events), else its provider's first. */
  const firstTabOf = (event: DashboardEvent | null): DetailTab | null => {
    const tabs = dashboardTabsFor(event);
    return tabs.find(tab => tab.id === event?.tab)?.id ?? tabs[0]?.id ?? null;
  };
  /** The tab shown: the one chosen for this event's provider, else the one it opens on. */
  const dashboardActiveTab = (): DetailTab | null => {
    const tabs = dashboardTabsFor(dashboard.selected());
    const chosen = detail.detailActiveTab();
    return tabs.some(tab => tab.id === chosen) ? chosen : firstTabOf(dashboard.selected());
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
  // Another event: the tab it opens on, at the top, and the events keep the keyboard. The same event shown again (a re-read
  // gives a new object, or the dashboard comes back) keeps its details as they were left: only another id counts (a
  // mutable ref, so it outlives the effect's runs and the dashboard's absence).
  const shownEvent = { key: null as string | null };
  createEffect(() => {
    const id = dashboard.selected()?.id ?? null;
    if (!dashboardShown() || id === null || id === shownEvent.key) return;
    shownEvent.key = id;
    untrack(() => {
      batch(() => {
        setDetail.setDetailCursorAction(null);
        setDetail.setDetailActiveTab(firstTabOf(dashboard.selected()) ?? "info");
        setDetail.setDetailCursorIndex(0);
        if (dialog() !== "dashboard-event") setDetail.setDetailFocused(false);
      });
    });
  });
  /** The tab's notices closed with `✕` or `:clear`, by key: a new one (another namespace) shows again. */
  const [dismissedNotices, setDismissedNotices] = createSignal<ReadonlySet<string>>(new Set());
  /** The provider's notice under its tab, as in its view (the namespaces whose events it lacks). */
  const dashboardNotice = () => {
    const event = dashboard.selected();
    const tab = dashboardActiveTab();
    const notice = event && tab && tab !== "info" ? providers.tabNotice(event.source, event.sha, tab) : null;
    return notice && !dismissedNotices().has(notice.key) ? notice : null;
  };
  /** `✕`, or `:clear` while the Dashboard shows. */
  const dismissDashboardNotice = () => {
    const notice = dashboardShown() ? dashboardNotice() : null;
    if (notice) setDismissedNotices(keys => new Set([...keys, notice.key]));
  };
  let dashboardDetailScrollbox: ScrollBoxRenderable | undefined;
  // A tab that moves the cursor itself (onto the event's own row) brings it into view, in either layout.
  detailNavRef.scrollToCursor = () =>
    scheduleScrollIntoView(detailNavRef, () => {
      const scrollbox = dialog() === "dashboard-event" ? dashboardDialogScrollbox : dashboardDetailScrollbox;
      const row = detailNavRef.itemRefs[detail.detailCursorIndex()];
      return !!scrollbox && !!row && scrollElementIntoView(scrollbox, row, 1);
    });
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
      if (!event || !tab) return event ? markLegend(event.source, opts.modules) : null;
      return providers.details.legend(tab, event.sha);
    },
    notice: dashboardNotice,
    onDismissNotice: dismissDashboardNotice,
    renderTab: (event: DashboardEvent, tab: DetailTab, info: Accessor<CommitInfo | null>) =>
      tab === "info" ? (
        <DashboardInfoTab event={event} info={info} />
      ) : (
        <ProviderTab
          tab={tab}
          sha={event.sha}
          providers={providers.details}
          navRef={detailNavRef}
          mouseEnabled={dialog() == null || dialog() === "dashboard-event"}
          onMouseFocus={() => focusDashboardTab(tab)}
          memory={opts.detailMemory}
          // The event's own run, build or resource: open, marked in the dashboard's color like its row.
          target={event.entry}
          targetColor={providerColors(opts.theme(), "dashboard", opts.modules).bg}
          // A file's diff (a pull request's), over the Dashboard; closing it comes back here.
          onOpenDiff={opts.dialogs.openDiff}
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
    if (url) opts.openUrl(url);
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
    dismissDashboardNotice,
    refreshDashboard,
    handleDashboardKey,
    dashboardNavRef: detailNavRef,
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
