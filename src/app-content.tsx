import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useCommandBar } from "./app/commands";
import { useDashboardController } from "./app/dashboard-controller";
import { DialogLayer } from "./app/dialog-layer";
import { useDialogHost } from "./app/dialogs";
import { useGraphController } from "./app/graph-controller";
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
import ErrorScreen from "./components/error-screen";
import Footer from "./components/footer";
import GraphView, { ColumnHeader } from "./components/graph";
import MessageBox from "./components/message-box";
import ProjectSelector from "./components/project-selector";
import SetupScreen from "./components/setup-screen";
import { backfillRepoConfig } from "./config-write";
import { COMPACT_THRESHOLD_WIDTH, DEFAULT_MAX_COUNT, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import { AppStateContext, createAppState } from "./context/state";
import { ThemeContext } from "./context/theme";
import { openGraphDetails } from "./hooks/handle-graph-keys";
import { useAncestry } from "./hooks/use-ancestry";
import { useKeyboardNavigation } from "./hooks/use-keyboard-navigation";
import { providerAccent } from "./providers/colors";
import { setProviderCacheSuspended } from "./providers/shared/sha-sqlite-cache";

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
  const { autoFastForward, display: repoDisplayConfig, reload: reloadRuntimeConfig } = settings;

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

  const dialogs = useDialogHost({ state, actions, layoutMode });
  const {
    dialog,
    setDialog,
    openDiff: handleOpenDiff,
    openJobLog,
    openResource: handleOpenOpenShiftResource,
  } = dialogs;

  // Navigation ref for interactive detail panel items
  const detailNavRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem: () => false,
    lastJumpFrom: null,
    pendingJumpDirection: null,
    scrollToFile: () => {},
    itemRefs: [],
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
    // The graph controller comes later (its loaders start after everything they read): reached when used.
    graphScroll: {
      top: () => graph.graphScroll.top(),
      scrollTo: top => graph.graphScroll.scrollTo(top),
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
  const dashboardController = useDashboardController({
    state,
    actions,
    repoPath: activeRepoPath,
    settings,
    providers,
    dialogs: { dialog, setDialog },
    layoutMode,
    graphNavRef: detailNavRef,
    detailMemory,
    theme: () => themeState.theme(),
    switchTo: switchRepoPath,
    setGitNotice,
    closeSearch: commandBar.closeSearch,
  });
  const {
    dashboard,
    dashboardShown,
    dashboardAppName,
    showSelectedInGraph,
    dashboardTabProps,
    refreshDashboard,
    handleDashboardKey,
    setDetailScrollbox: setDashboardDetailScrollbox,
  } = dashboardController;

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

  onMount(() => {
    renderer.setTerminalTitle("codepulse");
  });

  const graph = useGraphController({
    state,
    actions,
    repoPath: activeRepoPath,
    initialBranch: props.branch,
    autoFastForward,
    onFastForward: showFastForward,
    navRef: detailNavRef,
    commitData: providers.activeCommitData,
    beforeSelect: hash => {
      reanchorIfOutsideChain(hash);
      commandBar.leave();
    },
  });
  const { loadData, loadMoreData, handleFetch } = graph;

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
    getDetailScrollboxRef: graph.detailScrollbox,
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
    getCommitData: providers.activeCommitData,
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
                        onSelectRow={graph.selectRow}
                        onLoadMore={loadMoreData}
                        snykGetCommitData={snyk.getCommitData}
                        snykIsScanning={snyk.isScanning}
                        scrollboxRef={graph.setGraphScrollbox}
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
                        scrollboxRef={graph.setDetailScrollbox}
                        navRef={detailNavRef}
                        searchFocused={searchFocused()}
                        onJumpToCommit={graph.jumpToCommit}
                        onOpenDiff={handleOpenDiff}
                        {...providerDetailProps}
                      />
                    </box>
                  </Show>
                </box>

                <DialogLayer
                  dialogs={dialogs}
                  settings={settings}
                  dashboard={dashboardController}
                  openShift={openShift}
                  repoPath={activeRepoPath}
                  configInfo={props.configInfo}
                  menu={{
                    onReload: () => void handleReloadAll(),
                    onFetch: () => void handleFetchAll(),
                    onPull: () => void handlePullAll(),
                    onOpenCache: openCacheScreen,
                    onViewBranch: graph.viewBranch,
                    onSwitchRepo: () => {
                      setDialog(null);
                      setRepoSelectorVisible(true);
                    },
                  }}
                  details={{
                    navRef: detailNavRef,
                    setScrollbox: graph.setDetailScrollbox,
                    searchFocused,
                    onJumpToCommit: graph.jumpToCommit,
                    providerProps: providerDetailProps,
                    message: screenMessage,
                    onDismissMessage: clearScreenMessage,
                  }}
                />
              </box>
            </Show>
          </Show>
        </Show>
      </AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}
