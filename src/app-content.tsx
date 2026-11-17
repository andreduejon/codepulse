import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useCommandBar } from "./app/commands";
import { useDashboardController } from "./app/dashboard-controller";
import { useDialogHost } from "./app/dialogs";
import { useMessageCenter } from "./app/messages";
import { useProviderHost } from "./app/providers";
import { useRepoSession } from "./app/repo-session";
import { useRepoSettings } from "./app/repo-settings";
import { runAppCommand } from "./app-commands";
import type { AppContentProps } from "./app-types";
import CacheScreen from "./components/cache-screen";
import CommandBar from "./components/command-bar";
import { DashboardDetail } from "./components/dashboard-detail";
import { DashboardView } from "./components/dashboard-view";
import { createDetailMemory } from "./components/detail-memory";
import DetailPanel from "./components/detail-panel";
import type { DetailNavRef } from "./components/detail-types";
import { DashboardEventDialog } from "./components/dialogs/dashboard-event-dialog";
import DebugDialog from "./components/dialogs/debug-dialog";
import { DetailDialog } from "./components/dialogs/detail-dialog";
import DiffBlameDialog from "./components/dialogs/diff-blame-dialog";
import HelpDialog from "./components/dialogs/help-dialog";
import MenuDialog from "./components/dialogs/menu-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import ErrorScreen from "./components/error-screen";
import Footer from "./components/footer";
import GraphView, { ColumnHeader } from "./components/graph";
import MessageBox from "./components/message-box";
import ProjectSelector from "./components/project-selector";
import SetupScreen from "./components/setup-screen";
import { backfillRepoConfig, writeConfig } from "./config-write";
import { COMPACT_THRESHOLD_WIDTH, DEFAULT_MAX_COUNT, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import { AppStateContext, createAppState } from "./context/state";
import { ThemeContext } from "./context/theme";
import { openGraphDetails } from "./hooks/handle-graph-keys";
import { useAncestry } from "./hooks/use-ancestry";
import { useDataLoader } from "./hooks/use-data-loader";
import { useDetailLoader } from "./hooks/use-detail-loader";
import { useKeyboardNavigation } from "./hooks/use-keyboard-navigation";
import { providerAccent } from "./providers/colors";
import OpenShiftResourceDialog from "./providers/openshift/resource-dialog";
import JobLogDialog from "./providers/shared/job-log-dialog";
import { setProviderCacheSuspended } from "./providers/shared/sha-sqlite-cache";
import type { SnykProviderConfig } from "./providers/snyk/use-snyk";

export function AppContent(props: Readonly<AppContentProps>) {
  const { state, actions } = createAppState(
    props.maxCount ?? DEFAULT_MAX_COUNT,
    props.autoRefreshInterval,
    props.autoFetchInterval,
    props.all,
  );
  const themeState = props.themeState;
  const renderer = useRenderer();
  const [activeRepoPath, setActiveRepoPath] = createSignal(props.repoPath);
  const [cacheScreenVisible, setCacheScreenVisible] = createSignal(false);
  let disposed = false;
  createEffect(() => setProviderCacheSuspended(cacheScreenVisible()));
  onCleanup(() => {
    disposed = true;
    setProviderCacheSuspended(false);
  });

  const settings = useRepoSettings({ repoPath: activeRepoPath, initial: props, themeState, state, actions });
  const {
    github: githubConfig,
    setGithub: setGithubConfig,
    jenkins: jenkinsConfig,
    setJenkins: setJenkinsConfig,
    openShift: openShiftConfig,
    setOpenShift: setOpenShiftConfig,
    snyk: snykConfig,
    setSnyk: setSnykConfig,
    dashboard: dashboardConfig,
    setDashboard: setDashboardConfig,
    startView,
    setStartView,
    autoFastForward,
    setAutoFastForward,
    display: repoDisplayConfig,
    setDisplay: setRepoDisplayConfig,
    reload: reloadRuntimeConfig,
  } = settings;

  const providers = useProviderHost({
    state,
    actions,
    settings,
    suspended: cacheScreenVisible,
    onOpenJobLog: target => openJobLog(target),
    onOpenResource: resource => handleOpenOpenShiftResource(resource),
  });
  const { openShift, snyk } = providers;

  // Setup screen visibility — shown when startup mode is "setup"
  const [setupVisible, setSetupVisible] = createSignal(props.startupMode.kind === "setup");

  const {
    screenMessage,
    tabNotice,
    setGitNotice,
    showFastForward,
    forgetFastForward,
    clearScreenMessage,
    dismissTabNotice,
  } = useMessageCenter({ state, actions, snyk });

  const handleSetupComplete = () => {
    // Backfill all default settings so the user can see and edit them in the config file
    backfillRepoConfig(activeRepoPath());
    setSetupVisible(false);
  };

  const { setAnchor, clearAnchor, reanchorIfOutsideChain } = useAncestry(state, actions);
  const commandBar = useCommandBar({
    state,
    actions,
    repoPath: activeRepoPath,
    clearAnchor,
    runCommand: command => handleCommandExecute(command),
  });
  const {
    searchFocused,
    setSearchFocused,
    searchInputValue,
    setSearchInputValue,
    commandBarMode,
    setCommandBarMode,
    commandBarValue,
    setCommandBarValue,
    handlePathExecute,
    selectMode,
    applySearch,
  } = commandBar;

  // Reactive terminal dimensions for adaptive layout
  const dimensions = useTerminalDimensions();

  /** Derived layout mode based on terminal size. */
  const layoutMode = createMemo((): "too-small" | "compact" | "normal" => {
    const { width, height } = dimensions();
    if (width < MIN_TERMINAL_WIDTH || height < MIN_TERMINAL_HEIGHT) return "too-small";
    if (width < COMPACT_THRESHOLD_WIDTH) return "compact";
    return "normal";
  });

  const {
    dialog,
    setDialog,
    diffTarget,
    setDiffTarget,
    jobLogTarget,
    openShiftResourceTarget,
    openDiff: handleOpenDiff,
    openJobLog,
    openResource: handleOpenOpenShiftResource,
    openFromMenu: handleOpenDialog,
    setLogSearchScope,
    compactDetailUnderChild,
    closeToDetail,
  } = useDialogHost({ state, actions, layoutMode });

  // Ref for programmatic scrolling of the detail panel
  let graphScrollboxRef: ScrollBoxRenderable | undefined;
  let detailScrollboxRef: ScrollBoxRenderable | undefined;

  // Navigation ref for interactive detail panel items
  const detailNavRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
    itemRefs: [],
  };

  // Flag to suppress tab reset during child/parent jump navigation.
  // Set synchronously before setCursorIndex, read inside the commit-change effect.
  let isJumpNavigation = false;

  // ── Path filter ───────────────────────────────────────────────────────────
  const handleJumpToCommit = (hash: string, from: "child" | "parent") => {
    const rows = state.graphRows();
    const idx = rows.findIndex(r => r.commit.hash === hash);
    if (idx >= 0) {
      detailNavRef.lastJumpFrom = from;
      detailNavRef.pendingJumpDirection = from;
      // Suppress tab reset — setCursorIndex triggers the commit-change effect
      // synchronously, which reads this flag to preserve the active tab.
      isJumpNavigation = true;
      actions.setCursorIndex(idx);
      isJumpNavigation = false;
      actions.setScrollTargetIndex(idx);
      detailScrollboxRef?.scrollTo(0);
    }
  };

  const refreshActiveProvider = providers.refreshActive;

  const resetTransientRepoState = () => {
    setDialog(null);
    commandBar.leave();
    setSearchInputValue("");
    clearAnchor();
    actions.setSearchQuery("");
    actions.setViewingBranch(null);
    actions.setPathFilter(null);
    actions.setPathMatchSet(null);
    actions.setError(null);
    setGitNotice(null);
    forgetFastForward();
    actions.setCommitDetail(null);
    actions.setUncommittedDetail(null);
    actions.setDetailCursorIndex(0);
  };

  const session = useRepoSession({
    state,
    actions,
    repoPath: activeRepoPath,
    setRepoPath: setActiveRepoPath,
    settings,
    providers,
    cacheScreenVisible,
    setCacheScreenVisible,
    clearTransient: resetTransientRepoState,
    graphScroll: {
      top: () => graphScrollboxRef?.scrollTop ?? 0,
      scrollTo: top => graphScrollboxRef?.scrollTo(top),
    },
    closeDialog: () => setDialog(null),
    isDisposed: () => disposed,
  });
  const {
    knownRepos: knownRepoInfos,
    switchTo: switchRepoPath,
    switchInGroup: switchGroupRepo,
    selectorVisible: repoSelectorVisible,
    setSelectorVisible: setRepoSelectorVisible,
    pendingGraphScrollTop,
    openCacheScreen,
    closeCacheScreen,
    evictCache: evictCacheRepository,
  } = session;
  const currentRepoDisplayConfig = () => repoDisplayConfig();

  // ── Dashboard ─────────────────────────────────────────────────────────────
  /** One for both layouts and both views: a resize keeps open folders, runs and namespaces. */
  const detailMemory = createDetailMemory();
  const {
    dashboard,
    dashboardShown,
    dashboardAppName,
    showSelectedInGraph,
    dashboardTabProps,
    refreshDashboard,
    handleDashboardKey,
    openFromDashboardDialog,
    dashboardRowOpens,
    setDialogScrollbox: setDashboardDialogScrollbox,
    setDetailScrollbox: setDashboardDetailScrollbox,
  } = useDashboardController({
    state,
    actions,
    repoPath: activeRepoPath,
    settings,
    providers,
    dialogs: { dialog, setDialog },
    layoutMode,
    detailNavRef,
    detailMemory,
    theme: () => themeState.theme(),
    switchTo: switchRepoPath,
    setGitNotice,
    closeSearch: commandBar.closeSearch,
  });

  const handleReloadAll = async () => {
    reloadRuntimeConfig();
    await loadData(undefined, undefined, false, true);
    await refreshActiveProvider();
  };

  const handleFetchAll = async () => {
    const path = activeRepoPath();
    await handleFetch();
    if (activeRepoPath() !== path) return;
    await refreshActiveProvider();
  };

  /** ctrl+f and `:pull`: like `f`, and the local branches that are only behind follow their remote branches. */
  const handlePullAll = async () => {
    const path = activeRepoPath();
    setGitNotice(null);
    await handleFetch("pull");
    if (activeRepoPath() !== path) return;
    await refreshActiveProvider();
  };

  const activeProviderCommitData = providers.activeCommitData;

  // All git data loading: initial load, pagination, fetch, and auto-refresh timer.
  const { loadData, loadMoreData, handleFetch } = useDataLoader({
    repoPath: activeRepoPath,
    initialBranch: props.branch,
    state,
    actions,
    autoFastForward,
    onFastForward: showFastForward,
  });

  onMount(() => {
    renderer.setTerminalTitle("codepulse");
  });

  // Load commit detail when cursor changes (with debounce + abort of stale loads),
  // and auto-switch away from empty tabs after detail data arrives.
  useDetailLoader({
    repoPath: activeRepoPath,
    state,
    actions,
    getIsJumpNavigation: () => isJumpNavigation,
    detailNavRef,
    getCommitData: activeProviderCommitData,
    getProviderLoading: () => state.providerStatus().kind === "loading",
  });

  // Scroll detail panel to top when active tab changes
  createEffect(() => {
    state.detailActiveTab(); // track
    detailScrollboxRef?.scrollTo(0);
  });

  // Clamp cursor index when graphRows shrinks (e.g. branch change, reload).
  createEffect(() => {
    const rows = state.graphRows();
    const idx = state.cursorIndex();

    if (rows.length === 0) {
      if (idx !== 0) {
        actions.setCursorIndex(0);
        actions.setScrollTargetIndex(0);
      }
    } else if (idx >= rows.length) {
      const clamped = rows.length - 1;
      actions.setCursorIndex(clamped);
      actions.setScrollTargetIndex(clamped);
    }
  });

  /** Switch the graph to view a specific branch perspective. */
  const handleViewBranch = (branch: string | null) => {
    actions.setViewingBranch(branch);
    // When clearing the filter (null), jump to checked-out branch head;
    // when setting a filter, try to keep the cursor on the same commit.
    const stickyHash = branch ? state.selectedCommit()?.hash : undefined;
    loadData(undefined, stickyHash);
  };

  const handleCommandExecute = (cmd: string) =>
    runAppCommand(cmd, {
      state,
      actions,
      quit: () => renderer.destroy(),
      dialog,
      setDialog,
      openCacheScreen,
      openRepoSelector: () => setRepoSelectorVisible(true),
      clearScreenMessage: () => {
        dismissTabNotice();
        clearScreenMessage();
      },
      setAnchor,
      clearAnchor,
      fetchAll: handleFetchAll,
      pullAll: handlePullAll,
      reloadAll: handleReloadAll,
      toggleDashboardSource: dashboard.toggleSource,
      hiddenDashboardSources: dashboard.hidden,
      setSearchFocused,
      setSearchInputValue,
      setCommandBarMode,
      setCommandBarValue,
    });

  // Keyboard handling
  const { onFooterEnter, onFooterEscape } = useKeyboardNavigation({
    state,
    actions,
    dialog,
    setDialog,
    layoutMode,
    searchFocused,
    setSearchFocused,
    searchInputValue,
    setSearchInputValue,
    clearSearchDebounce: () => {},
    getDetailScrollboxRef: () => detailScrollboxRef,
    detailNavRef,
    loadData,
    loadMoreData,
    handleFetch,
    commandBarMode,
    setCommandBarMode,
    commandBarValue,
    setCommandBarValue,
    onCommandExecute: handleCommandExecute,
    onPathExecute: handlePathExecute,
    onSearchExecute: applySearch,
    onClearAncestry: clearAnchor,
    getCommitData: activeProviderCommitData,
    getProviderLoading: () => state.providerStatus().kind === "loading",
    onSwitchGroupRepo: switchGroupRepo,
    onDashboardKey: handleDashboardKey,
  });

  /** Provider data and dialogs for the detail panel and the compact detail dialog. */
  const providerDetailProps = {
    memory: detailMemory,
    providers: providers.detailSources,
    get tabNotice() {
      return tabNotice();
    },
    onDismissTabNotice: dismissTabNotice,
  };

  // ── Provider-aware theme: override accent with githubActionsBg in CI mode ──
  // createMemo is placed here — after all const declarations above — to respect
  // AGENTS.md rule 1 (eager memo must not reference TDZ variables).
  // All components that call useT() read from ThemeContext, so overriding the
  // theme value here propagates the accent change to every component automatically.
  //
  // githubActionsBg is the bright badge color (e.g. #89b4fa) — used as accent.
  // githubActionsFg is the dark badge text color — NOT suitable as a global accent.
  const providerTheme = createMemo(() => {
    const base = themeState.theme();
    const view = state.activeProviderView();
    // Git view keeps the theme's own accent (built-in themes set it equal to gitBg), so a custom accent applies.
    return view === "git" ? base : { ...base, accent: providerAccent(base, view) };
  });

  return (
    <ThemeContext.Provider
      value={{
        ...themeState,
        theme: providerTheme,
      }}
    >
      <AppStateContext.Provider value={{ state, actions }}>
        <Show
          when={cacheScreenVisible() || layoutMode() !== "too-small"}
          fallback={
            <ErrorScreen
              error={`Terminal too small (${dimensions().width}\u00d7${dimensions().height})\nResize to at least ${MIN_TERMINAL_WIDTH} columns and ${MIN_TERMINAL_HEIGHT} rows.`}
            />
          }
        >
          <Show
            when={!setupVisible()}
            fallback={
              <SetupScreen
                repoPath={activeRepoPath()}
                onComplete={handleSetupComplete}
                onQuit={() => renderer.destroy()}
              />
            }
          >
            <Show
              when={!repoSelectorVisible() && !cacheScreenVisible()}
              fallback={
                <Show
                  when={cacheScreenVisible()}
                  fallback={
                    <ProjectSelector
                      knownRepos={knownRepoInfos()}
                      currentRepo={activeRepoPath()}
                      onSelectRepo={switchRepoPath}
                      onCancel={() => setRepoSelectorVisible(false)}
                      setKeyboardScopeOverride={actions.setKeyboardScopeOverride}
                    />
                  }
                >
                  <CacheScreen
                    currentRepo={activeRepoPath()}
                    onEvict={evictCacheRepository}
                    onClose={closeCacheScreen}
                    setKeyboardScopeOverride={actions.setKeyboardScopeOverride}
                  />
                </Show>
              }
            >
              <box flexDirection="column" width="100%" height="100%" backgroundColor={themeState.theme().background}>
                {/* Main content area */}
                <box flexDirection="row" flexGrow={1}>
                  {/* Left panel - graph + search + footer, all on grey background */}
                  <box
                    flexDirection="column"
                    flexGrow={1}
                    flexShrink={1}
                    backgroundColor={themeState.theme().backgroundPanel}
                    paddingX={2}
                  >
                    <Show when={dashboardShown()}>
                      <box flexDirection="column" flexGrow={1} paddingBottom={1}>
                        <DashboardView
                          dashboard={dashboard}
                          mouseEnabled={() => dialog() == null && state.keyboardScopeOverride() == null}
                          onRowClick={() => actions.setDetailFocused(false)}
                        />
                      </box>
                    </Show>
                    {/* Graph area: kept behind the dashboard, so it comes back where it was */}
                    <box flexDirection="column" flexGrow={1} paddingBottom={1} visible={!dashboardShown()}>
                      {/* Sticky column headers - above scrollbox */}
                      <ColumnHeader />

                      <GraphView
                        mouseEnabled={() => dialog() == null && state.keyboardScopeOverride() == null}
                        onSelectRow={index => {
                          const commit = state.graphRows()[index]?.commit;
                          if (!commit) return;
                          batch(() => {
                            reanchorIfOutsideChain(commit.hash);
                            commandBar.leave();
                            actions.setDetailFocused(false);
                            actions.setCursorIndex(index);
                            actions.setScrollTargetIndex(index);
                          });
                          detailNavRef.pendingJumpDirection = null;
                          detailScrollboxRef?.scrollTo(0);
                        }}
                        onLoadMore={loadMoreData}
                        snykGetCommitData={snyk.getCommitData}
                        snykIsScanning={snyk.isScanning}
                        scrollboxRef={el => (graphScrollboxRef = el)}
                        suppressAutoScroll={() => pendingGraphScrollTop() != null}
                      />
                    </box>

                    <box flexDirection="column" flexShrink={0} width="100%">
                      <Show when={screenMessage()}>
                        {msg => (
                          <box flexDirection="column" width="100%" flexShrink={0}>
                            <MessageBox
                              kind={msg().kind}
                              source={msg().source}
                              title={msg().title}
                              message={msg().message}
                              detail={msg().detail}
                              onDismiss={clearScreenMessage}
                              mouseEnabled={dialog() == null && state.keyboardScopeOverride() == null}
                            />
                            <box height={1} />
                          </box>
                        )}
                      </Show>

                      {/* Command bar section */}
                      <CommandBar
                        onSelectMode={selectMode}
                        onSelectProject={switchRepoPath}
                        mouseEnabled={() => dialog() == null && state.keyboardScopeOverride() == null}
                        commandBarMode={commandBarMode}
                        commandBarValue={commandBarValue}
                        searchInputValue={searchInputValue}
                        searchFocused={searchFocused}
                        onInput={commandBar.onInput}
                        detailFocused={state.detailFocused}
                        knownRepos={knownRepoInfos()}
                        currentRepo={activeRepoPath()}
                        currentGroup={currentRepoDisplayConfig().group}
                        currentAppName={currentRepoDisplayConfig().appName}
                        dashboard={dashboard}
                      />

                      {/* Footer - hotkey hints, 1 char gap above, right-aligned */}
                      <box height={1} />
                      <Footer
                        onConfirm={onFooterEnter}
                        onClose={onFooterEscape}
                        mouseEnabled={dialog() == null && state.keyboardScopeOverride() == null}
                        onOpenDetails={() => {
                          if (dialog() != null || state.keyboardScopeOverride() != null) return;
                          openGraphDetails({ state, actions, layoutMode, setDialog, detailNavRef });
                        }}
                        commandBarMode={commandBarMode}
                        filterActive={!!state.highlightSet() || !!state.viewingBranch()}
                        compact={layoutMode() === "compact"}
                        dashboard={dashboard}
                        onDashboardRefresh={refreshDashboard}
                      />
                    </box>
                  </box>

                  {/* Detail panel - right, hidden in compact/too-small mode */}
                  {/* Dashboard details - right, like the commit details beside the graph */}
                  <Show when={layoutMode() === "normal" && dashboardShown()}>
                    <box flexDirection="column" width="25%" minWidth={60} flexShrink={0} paddingX={2} paddingBottom={1}>
                      <DashboardDetail
                        event={dashboard.selected}
                        appName={dashboardAppName}
                        onShowInGraph={showSelectedInGraph}
                        mouseEnabled={() => dialog() == null && state.keyboardScopeOverride() == null}
                        scrollboxRef={element => {
                          setDashboardDetailScrollbox(element);
                        }}
                        {...dashboardTabProps()}
                      />
                    </box>
                  </Show>
                  <Show when={layoutMode() === "normal" && !dashboardShown()}>
                    <box flexDirection="column" width="25%" minWidth={60} flexShrink={0} paddingX={2} paddingBottom={1}>
                      <DetailPanel
                        mouseEnabled={dialog() == null && state.keyboardScopeOverride() == null}
                        onMouseFocus={() => {
                          commandBar.leave();
                          actions.setDetailFocused(true);
                        }}
                        scrollboxRef={el => {
                          detailScrollboxRef = el;
                        }}
                        navRef={detailNavRef}
                        searchFocused={searchFocused()}
                        onJumpToCommit={handleJumpToCommit}
                        onOpenDiff={handleOpenDiff}
                        {...providerDetailProps}
                      />
                    </box>
                  </Show>
                </box>

                {/* Dialogs */}
                <Show when={dialog() === "menu"}>
                  <MenuDialog
                    onClose={() => setDialog(null)}
                    onReload={() => void handleReloadAll()}
                    onFetch={() => void handleFetchAll()}
                    onPull={() => void handlePullAll()}
                    onOpenDialog={handleOpenDialog}
                    onOpenCache={openCacheScreen}
                    onViewBranch={handleViewBranch}
                    configInfo={props.configInfo}
                    onSwitchRepo={() => {
                      setDialog(null);
                      setRepoSelectorVisible(true);
                    }}
                    githubConfig={githubConfig()}
                    onGithubConfigChange={setGithubConfig}
                    jenkinsConfig={jenkinsConfig()}
                    onJenkinsConfigChange={setJenkinsConfig}
                    openshiftConfig={openShiftConfig()}
                    onOpenShiftConfigChange={setOpenShiftConfig}
                    {...{
                      snykConfig: snykConfig(),
                      onSnykConfigChange: (config: SnykProviderConfig) => setSnykConfig(config),
                    }}
                    dashboardConfig={dashboardConfig()}
                    onDashboardConfigChange={setDashboardConfig}
                    startView={startView()}
                    onStartViewChange={setStartView}
                    autoFastForward={autoFastForward()}
                    onAutoFastForwardChange={setAutoFastForward}
                    onRepoDisplayConfigChange={setRepoDisplayConfig}
                  />
                </Show>
                <Show when={dialog() === "help"}>
                  <HelpDialog onClose={() => setDialog(null)} />
                </Show>
                <Show when={dialog() === "theme"}>
                  <ThemeDialog
                    onClose={() => setDialog(null)}
                    onSelect={name => writeConfig({ theme: name }, activeRepoPath())}
                  />
                </Show>
                <Show when={dialog() === "debug"}>
                  <DebugDialog onClose={() => setDialog(null)} gitColor={themeState.theme().gitBg} />
                </Show>
                <Show when={dialog() === "diff-blame" && diffTarget()}>
                  {target => (
                    <DiffBlameDialog
                      target={target()}
                      onClose={closeToDetail}
                      onNavigate={t => {
                        setDiffTarget(t);
                        detailNavRef.scrollToFile(t.filePath);
                      }}
                    />
                  )}
                </Show>
                {/* Detail dialog, compact mode only. Under a dialog opened from it, it stays mounted but hidden, so
                    closing that dialog comes back to the details as they were (open runs, attempts, cursor). */}
                <Show when={dialog() === "detail" || compactDetailUnderChild()}>
                  <DetailDialog
                    visible={dialog() === "detail"}
                    scrollboxRef={el => {
                      detailScrollboxRef = el;
                    }}
                    navRef={detailNavRef}
                    searchFocused={searchFocused()}
                    onJumpToCommit={handleJumpToCommit}
                    onOpenDiff={handleOpenDiff}
                    onClose={() => {
                      // Same as Esc (handle-cascade-close): leaving compact details also leaves detail focus.
                      batch(() => {
                        actions.setDetailFocused(false);
                        setDialog(null);
                      });
                    }}
                    {...providerDetailProps}
                    message={screenMessage()}
                    onDismissMessage={clearScreenMessage}
                  />
                </Show>
                {/* The dashboard's details, compact mode only */}
                <Show when={dialog() === "dashboard-event"}>
                  <DashboardEventDialog
                    event={dashboard.selected}
                    appName={dashboardAppName}
                    onClose={() => {
                      actions.setDetailFocused(false);
                      setDialog(null);
                    }}
                    onShowInGraph={showSelectedInGraph}
                    onOpen={openFromDashboardDialog}
                    canOpen={() => !!dashboard.selected()?.url || dashboardRowOpens()}
                    tabProps={dashboardTabProps()}
                    scrollboxRef={element => {
                      setDashboardDialogScrollbox(element);
                    }}
                  />
                </Show>
                {/* Job log dialog */}
                <Show when={dialog() === "job-log" && jobLogTarget()}>
                  {target => (
                    <JobLogDialog
                      provider={target().provider}
                      job={target().job}
                      jobs={target().jobs}
                      run={target().run}
                      fetchLog={target().fetchLog}
                      entryNoun={target().noun}
                      initialSearch={target().search}
                      onClose={closeToDetail}
                      onSearchActive={setLogSearchScope}
                    />
                  )}
                </Show>
                <Show when={dialog() === "openshift-resource" && openShiftResourceTarget()}>
                  {resource => (
                    <OpenShiftResourceDialog
                      resource={resource()}
                      loadLog={async (item, force) =>
                        item.kind === "Pod" ? openShift.loadPodLog(item) : openShift.loadBuildLog(item, force)
                      }
                      followLog={openShift.followLog}
                      consoleUrl={openShiftConfig().consoleUrl}
                      loadEvents={item => openShift.loadResourceEvents(item)}
                      loadObject={(item, force) => openShift.loadResourceObject(item, force)}
                      onClose={closeToDetail}
                      onSearchActive={setLogSearchScope}
                    />
                  )}
                </Show>
              </box>
            </Show>
          </Show>
        </Show>
      </AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}
