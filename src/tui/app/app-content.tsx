import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { DEFAULT_MAX_COUNT } from "../../core/settings/config";
import { createDetailMemory } from "../components/detail-memory";
import type { DetailNavRef } from "../components/detail-types";
import { COMPACT_THRESHOLD_WIDTH, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "../constants";
import { resolvePorts } from "../context/ports";
import { PortsProvider } from "../context/ports-provider";
import { defaultProviderModules, ProviderModulesContext } from "../context/provider-modules";
import { AppStateContext, createAppState } from "../context/state";
import { ThemeContext } from "../context/theme";
import { useAncestry } from "../hooks/use-ancestry";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { providerAccent } from "../providers/colors";
import { GraphColumnsContext } from "../providers/graph-columns-context";
import { runAppCommand } from "./app-commands";
import type { AppContentProps } from "./app-types";
import { useCommandBar } from "./command-bar";
import { useDashboardController } from "./dashboard-controller";
import { useDialogHost } from "./dialogs";
import { useGraphController } from "./graph-controller";
import { AppLayout } from "./layout";
import { useMessageCenter } from "./messages";
import { useProviderHost } from "./providers";
import { useRepoSession } from "./repo-session";
import { useRepoSettings } from "./repo-settings";

export function AppContent(props: Readonly<AppContentProps>) {
  /** The ports the app runs on: given by startupProps, the registered ones otherwise. */
  const ports = resolvePorts(props);
  /** Each provider's terminal module: given by startupProps, the registered ones otherwise. */
  const providerModules = props.providerModules ?? defaultProviderModules();
  const { state, actions } = createAppState(
    props.maxCount ?? DEFAULT_MAX_COUNT,
    props.autoRefreshInterval,
    props.autoFetchInterval,
    props.all,
    ports.providers,
  );
  const themeState = props.themeState;
  const renderer = useRenderer();
  const [activeRepoPath, setActiveRepoPath] = createSignal(props.repoPath);
  const [cacheScreenVisible, setCacheScreenVisible] = createSignal(false);
  let disposed = false;
  /** The providers' cache, as the cache screen manages it. */
  const cacheStore = ports.cacheStore;
  createEffect(() => cacheStore.setSuspended(cacheScreenVisible()));
  onCleanup(() => {
    disposed = true;
    cacheStore.setSuspended(false);
  });

  /** Where the settings are kept. */
  const settingsPort = ports.settings;
  /** Git, through the app's port. */
  const gitPort = ports.git;
  const settings = useRepoSettings({
    repoPath: activeRepoPath,
    initial: props.initialProviderSettings,
    providers: ports.providers,
    themeState,
    state,
    actions,
    port: settingsPort,
  });
  const { autoFastForward, reload: reloadRuntimeConfig } = settings;

  const providers = useProviderHost({
    state,
    actions,
    providers: ports.providers,
    modules: providerModules,
    settings,
    suspended: cacheScreenVisible,
    onOpenJobLog: target => openJobLog(target),
    onOpenDialog: render => openProviderDialog(render),
  });

  // Setup screen visibility — shown when startup mode is "setup"
  const [setupVisible, setSetupVisible] = createSignal(props.startupMode.kind === "setup");

  const messages = useMessageCenter({ state, actions, providers });
  const { tabNotice, setGitNotice, showFastForward, forgetFastForward, clearScreenMessage, dismissTabNotice } =
    messages;

  const handleSetupComplete = () => {
    // Backfill all default settings so the user can see and edit them in the config file
    settingsPort.backfill(activeRepoPath());
    setSetupVisible(false);
  };

  const { setAnchor, clearAnchor, reanchorIfOutsideChain } = useAncestry(state, actions);
  const commandBar = useCommandBar({
    state,
    actions,
    repoPath: activeRepoPath,
    git: gitPort,
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

  const dialogs = useDialogHost({ state, layoutMode });
  const { dialog, setDialog, openJobLog, openProviderDialog } = dialogs;
  /** The mouse works on the graph, the dashboard and their panels while no dialog covers them. */
  const _mouseEnabled = () => dialog() == null;

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
    cacheStore,
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
    switchTo: switchRepoPath,
    switchInGroup: switchGroupRepo,
    setSelectorVisible: setRepoSelectorVisible,
    openCacheScreen,
  } = session;

  // ── Dashboard ─────────────────────────────────────────────────────────────
  /** One for both layouts and both views: a resize keeps open folders, runs and namespaces. */
  const detailMemory = createDetailMemory();
  const dashboardController = useDashboardController({
    state,
    actions,
    repoPath: activeRepoPath,
    loadEvents: ports.dashboard.readEvents,
    openUrl: ports.system.openUrl,
    onCacheWrite: cacheStore.onWrite,
    settings,
    providers,
    modules: providerModules,
    dialogs: { dialog, setDialog },
    layoutMode,
    graphNavRef: detailNavRef,
    detailMemory,
    theme: () => themeState.theme(),
    switchTo: switchRepoPath,
    setGitNotice,
    closeSearch: commandBar.closeSearch,
  });
  const { dashboard, handleDashboardKey } = dashboardController;

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
    git: gitPort,
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
        dashboardController.dismissDashboardNotice();
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
    providers: providers.details,
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
    return view === "git" ? base : { ...base, accent: providerAccent(base, view, providerModules) };
  });

  return (
    <PortsProvider ports={ports}>
      <ProviderModulesContext.Provider value={providerModules}>
        <GraphColumnsContext.Provider value={providers.graphColumns}>
          <ThemeContext.Provider value={{ ...themeState, theme: providerTheme }}>
            <AppStateContext.Provider value={{ state, actions }}>
              <AppLayout
                baseTheme={themeState.theme}
                layoutMode={layoutMode}
                repoPath={activeRepoPath}
                configInfo={props.configInfo}
                setup={{ visible: setupVisible, onComplete: handleSetupComplete }}
                session={session}
                cacheScreenVisible={cacheScreenVisible}
                settings={settings}
                providers={providers}
                dialogs={dialogs}
                messages={messages}
                commandBar={commandBar}
                graph={graph}
                dashboard={dashboardController}
                keys={{ onEnter: onFooterEnter, onEscape: onFooterEscape }}
                run={{ reloadAll: handleReloadAll, fetchAll: handleFetchAll, pullAll: handlePullAll }}
                detail={{ navRef: detailNavRef, providerProps: providerDetailProps }}
              />
            </AppStateContext.Provider>
          </ThemeContext.Provider>
        </GraphColumnsContext.Provider>
      </ProviderModulesContext.Provider>
    </PortsProvider>
  );
}
