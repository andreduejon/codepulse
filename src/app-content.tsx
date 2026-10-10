import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import type { AppContentProps, RepoSessionSnapshot } from "./app-types";
import CommandBar from "./components/command-bar";
import DetailPanel from "./components/detail-panel";
import type { DetailNavRef } from "./components/detail-types";
import DebugDialog from "./components/dialogs/debug-dialog";
import { DetailDialog } from "./components/dialogs/detail-dialog";
import DiffBlameDialog from "./components/dialogs/diff-blame-dialog";
import HelpDialog from "./components/dialogs/help-dialog";
import MenuDialog, { setLastMenuTab } from "./components/dialogs/menu-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import ErrorScreen from "./components/error-screen";
import Footer from "./components/footer";
import GraphView, { ColumnHeader } from "./components/graph";
import MessageBox, { type UIMessage } from "./components/message-box";
import ProjectSelector from "./components/project-selector";
import SetupScreen from "./components/setup-screen";
import { backfillRepoConfig, getKnownRepoInfos, getRepoDisplayConfig, loadConfig, writeConfig } from "./config";
import { COMPACT_THRESHOLD_WIDTH, DEFAULT_MAX_COUNT, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import { AppStateContext, createAppState, providerIdle, providerStatusMessage } from "./context/state";
import { ThemeContext } from "./context/theme";
import { BANNER, displayBanner } from "./debug/banner";
import { clearDebugEvents } from "./debug/events";
import type { DiffTarget } from "./git/types";
import { openGraphDetails } from "./hooks/handle-graph-keys";
import { useAncestry } from "./hooks/use-ancestry";
import { useDataLoader } from "./hooks/use-data-loader";
import { useDetailLoader } from "./hooks/use-detail-loader";
import { type CommandBarMode, type DialogId, useKeyboardNavigation } from "./hooks/use-keyboard-navigation";
import { usePathFilter } from "./hooks/use-path-filter";
import { providerAccent } from "./providers/colors";
import JobLogDialog from "./providers/github-actions/log-dialog";
import type { GitHubJob, GitHubWorkflowRun } from "./providers/github-actions/types";
import { useGitHubCI } from "./providers/github-actions/use-github-ci";
import type { JenkinsJob, JenkinsRun } from "./providers/jenkins/types";
import { useJenkinsCI } from "./providers/jenkins/use-jenkins-ci";
import OpenShiftResourceDialog from "./providers/openshift/resource-dialog";
import type { OpenShiftResource } from "./providers/openshift/types";
import { useOpenShift } from "./providers/openshift/use-openshift";
import { type SnykProviderConfig, useSnyk } from "./providers/snyk/use-snyk";
import { nextGroupRepoPath } from "./utils/group-repos";
import { computeDisplacedIndex } from "./utils/keyboard-nav-utils";

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

  // GitHub Actions provider config.
  const [githubConfig, setGithubConfig] = createSignal({
    enabled: props.initialGithubConfig?.enabled ?? false,
    tokenEnvVar: props.initialGithubConfig?.tokenEnvVar ?? "GITHUB_TOKEN",
    trustedEnterpriseHost: props.initialGithubConfig?.trustedEnterpriseHost ?? null,
    fetchDepth: props.initialGithubConfig?.fetchDepth ?? 20,
    cacheLimit: props.initialGithubConfig?.cacheLimit ?? 20,
    autoRefreshSeconds: props.initialGithubConfig?.autoRefreshSeconds ?? 120,
  });

  // Jenkins provider config
  const [jenkinsConfig, setJenkinsConfig] = createSignal({
    enabled: props.initialJenkinsConfig?.enabled ?? false,
    username: props.initialJenkinsConfig?.username,
    tokenEnvVar: props.initialJenkinsConfig?.tokenEnvVar ?? "JENKINS_TOKEN",
    fetchDepth: props.initialJenkinsConfig?.fetchDepth ?? props.initialJenkinsConfig?.graphBuildLimit ?? 20,
    cacheLimit: props.initialJenkinsConfig?.cacheLimit ?? 20,
    autoRefreshSeconds: props.initialJenkinsConfig?.autoRefreshSeconds ?? 120,
    jobs: props.initialJenkinsConfig?.jobs ?? [],
  });

  // OpenShift provider config
  const [openShiftConfig, setOpenShiftConfig] = createSignal({
    enabled: props.initialOpenShiftConfig?.enabled ?? false,
    serverUrl: props.initialOpenShiftConfig?.serverUrl ?? "",
    tokenEnvVar: props.initialOpenShiftConfig?.tokenEnvVar ?? "OPENSHIFT_TOKEN",
    namespaces: props.initialOpenShiftConfig?.namespaces ?? [],
    commitShaAnnotation: props.initialOpenShiftConfig?.commitShaAnnotation ?? "dev/commit-sha",
    cacheLimit: props.initialOpenShiftConfig?.cacheLimit ?? 20,
    fetchDepth: props.initialOpenShiftConfig?.fetchDepth ?? 20,
    autoRefreshSeconds: props.initialOpenShiftConfig?.autoRefreshSeconds ?? 120,
  });

  const [snykConfig, setSnykConfig] = createSignal<SnykProviderConfig>({
    enabled: props.initialSnykConfig?.enabled ?? false,
    tokenEnvVar: props.initialSnykConfig?.tokenEnvVar ?? "SNYK_TOKEN",
    autoScanBranches: props.initialSnykConfig?.autoScanBranches ?? [],
    maxCachedScans: props.initialSnykConfig?.maxCachedScans ?? 20,
  });

  const [repoDisplayConfig, setRepoDisplayConfig] = createSignal(getRepoDisplayConfig(activeRepoPath()));

  const reloadRuntimeConfig = () => {
    const path = activeRepoPath();
    backfillRepoConfig(path);
    const { config } = loadConfig(path);
    setGithubConfig({
      enabled: config.providers?.github?.enabled ?? false,
      tokenEnvVar: config.providers?.github?.tokenEnvVar ?? "GITHUB_TOKEN",
      trustedEnterpriseHost: config.providers?.github?.trustedEnterpriseHost ?? null,
      fetchDepth: config.providers?.github?.fetchDepth ?? 20,
      cacheLimit: config.providers?.github?.cacheLimit ?? 20,
      autoRefreshSeconds: config.providers?.github?.autoRefreshSeconds ?? 120,
    });
    setJenkinsConfig({
      enabled: config.providers?.jenkins?.enabled ?? false,
      username: config.providers?.jenkins?.username,
      tokenEnvVar: config.providers?.jenkins?.tokenEnvVar ?? "JENKINS_TOKEN",
      fetchDepth: config.providers?.jenkins?.fetchDepth ?? config.providers?.jenkins?.graphBuildLimit ?? 20,
      cacheLimit: config.providers?.jenkins?.cacheLimit ?? 20,
      autoRefreshSeconds: config.providers?.jenkins?.autoRefreshSeconds ?? 120,
      jobs: config.providers?.jenkins?.jobs ?? [],
    });
    setOpenShiftConfig({
      enabled: config.providers?.openshift?.enabled ?? false,
      serverUrl: config.providers?.openshift?.serverUrl ?? "",
      tokenEnvVar: config.providers?.openshift?.tokenEnvVar ?? "OPENSHIFT_TOKEN",
      namespaces: config.providers?.openshift?.namespaces ?? [],
      commitShaAnnotation: config.providers?.openshift?.commitShaAnnotation ?? "dev/commit-sha",
      cacheLimit: config.providers?.openshift?.cacheLimit ?? 20,
      fetchDepth: config.providers?.openshift?.fetchDepth ?? 20,
      autoRefreshSeconds: config.providers?.openshift?.autoRefreshSeconds ?? 120,
    });
    setSnykConfig({
      enabled: config.providers?.snyk?.enabled ?? false,
      tokenEnvVar: config.providers?.snyk?.tokenEnvVar ?? "SNYK_TOKEN",
      autoScanBranches: config.providers?.snyk?.autoScanBranches ?? [],
      maxCachedScans: config.providers?.snyk?.maxCachedScans ?? 20,
    });
    setRepoDisplayConfig(getRepoDisplayConfig(path));
  };

  // ── GitHub CI data hook (called during setup, before Provider renders — per AGENTS.md rule 5) ──
  const gitHubCI = useGitHubCI({
    state,
    actions,
    config: githubConfig,
  });
  const jenkinsCI = useJenkinsCI({ state, actions, config: jenkinsConfig });
  const openShift = useOpenShift({ state, actions, config: openShiftConfig });
  const snyk = useSnyk({ state, actions, config: snykConfig });

  // Setup screen visibility — shown when startup mode is "setup"
  const [setupVisible, setSetupVisible] = createSignal(props.startupMode.kind === "setup");
  // Repo selector visibility — shown when "Switch repository" is selected from menu
  const [repoSelectorVisible, setRepoSelectorVisible] = createSignal(false);

  const screenMessage = createMemo<UIMessage | null>(() => {
    const err = state.error();
    if (err) return { kind: "error" as const, message: displayBanner(err, BANNER.git.fetchFailed) };

    const status = state.providerStatus();
    const message = providerStatusMessage(status);
    if (state.activeProviderView() === "git" || !message) return null;

    return {
      kind: status.kind === "error" ? ("error" as const) : ("info" as const),
      message: displayBanner(message, message),
    };
  });

  const handleSetupComplete = () => {
    // Backfill all default settings so the user can see and edit them in the config file
    backfillRepoConfig(activeRepoPath());
    setSetupVisible(false);
  };

  // Backfill missing config keys for the active repo and refresh display labels on repo switches.
  createEffect(() => {
    activeRepoPath();
    reloadRuntimeConfig();
  });

  // Auto-persist theme changes (confirmed selections and reverts from ThemeDialog)
  createEffect(() => {
    const name = themeState.themeName();
    writeConfig({ theme: name }, activeRepoPath());
  });

  const [dialog, setDialog] = createSignal<DialogId>(null);

  const [searchFocused, setSearchFocused] = createSignal(false);
  /**
   * Local input value for the search bar — independent of the active filter.
   * Updated on every keystroke but only applied to the filter on submit (Enter).
   */
  const [searchInputValue, setSearchInputValue] = createSignal("");
  /** Target for the diff+blame dialog (set when user activates a file). */
  const [diffTarget, setDiffTarget] = createSignal<DiffTarget | null>(null);
  /** Target for the job log dialog (set when user opens a job log). */
  const [jobLogTarget, setJobLogTarget] = createSignal<{
    provider: "github-actions" | "jenkins";
    job: { id: string | number; name: string };
    run: { name: string; runNumber: number; url?: string };
    jobs: { id: string | number; name: string }[];
    fetchLog: (job: { id: string | number; name: string }) => Promise<string>;
  } | null>(null);
  const [openShiftResourceTarget, setOpenShiftResourceTarget] = createSignal<OpenShiftResource | null>(null);

  /** Command bar mode — drives placeholder text and key routing. */
  const [commandBarMode, setCommandBarMode] = createSignal<CommandBarMode>("idle");
  /** Raw text typed in the command bar (e.g. "search", "path src/"). */
  const [commandBarValue, setCommandBarValue] = createSignal("");

  // Reactive terminal dimensions for adaptive layout
  const dimensions = useTerminalDimensions();

  /** Derived layout mode based on terminal size. */
  const layoutMode = createMemo((): "too-small" | "compact" | "normal" => {
    const { width, height } = dimensions();
    if (width < MIN_TERMINAL_WIDTH || height < MIN_TERMINAL_HEIGHT) return "too-small";
    if (width < COMPACT_THRESHOLD_WIDTH) return "compact";
    return "normal";
  });

  // Seamless resize transitions between layout modes:
  // - Normal → Compact while detail is focused: auto-open the detail dialog
  // - Compact → Normal while detail dialog is open: close dialog, keep detail focused
  // Uses untrack() for dialog() so this effect only fires on layoutMode changes,
  // not every time any dialog (e.g. diff-blame) opens/closes.
  createEffect(() => {
    const mode = layoutMode();
    const currentDialog = untrack(dialog);
    if (mode === "compact" && state.detailFocused() && currentDialog !== "detail") {
      // Only open the detail dialog on resize — not when another dialog (e.g. diff-blame) opens
      setDialog("detail");
    } else if (mode === "normal" && currentDialog === "detail") {
      setDialog(null);
      // detailFocused stays true — panel is now visible in two-column layout
    }
  });

  // Ref for programmatic scrolling of the detail panel
  let graphScrollboxRef: ScrollBoxRenderable | undefined;
  let detailScrollboxRef: ScrollBoxRenderable | undefined;
  const [pendingGraphScrollTop, setPendingGraphScrollTop] = createSignal<number | null>(null);
  let scrollRestoreVersion = 0;
  let scrollRestoreTimers: ReturnType<typeof setTimeout>[] = [];

  const cancelScrollRestore = () => {
    scrollRestoreVersion++;
    for (const timer of scrollRestoreTimers) clearTimeout(timer);
    scrollRestoreTimers = [];
  };

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

  // ── Ancestry highlighting ─────────────────────────────────────────────────
  const { setAnchor, clearAnchor, reanchorIfOutsideChain } = useAncestry(state, actions);

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

  /** Open the diff+blame dialog for the given file target. */
  const handleOpenDiff = (target: DiffTarget) => {
    setDiffTarget(target);
    setDialog("diff-blame");
  };

  const handleOpenJobLog = (job: GitHubJob, run: GitHubWorkflowRun, jobs: GitHubJob[] = [job]) => {
    setJobLogTarget({
      provider: "github-actions",
      job,
      run,
      jobs: jobs.length > 0 ? jobs : [job],
      fetchLog: currentJob => gitHubCI.fetchJobLogForJob(Number(currentJob.id), run),
    });
    setDialog("job-log");
  };

  const handleOpenJenkinsJobLog = (job: JenkinsJob, run: JenkinsRun, jobs: JenkinsJob[] = [job]) => {
    setJobLogTarget({
      provider: "jenkins",
      job,
      run,
      jobs: jobs.length > 0 ? jobs : [job],
      fetchLog: () => jenkinsCI.fetchRunLog(run),
    });
    setDialog("job-log");
  };

  const handleOpenOpenShiftResource = (resource: OpenShiftResource) => {
    setOpenShiftResourceTarget(resource);
    setDialog("openshift-resource");
  };

  const refreshActiveProvider = async () => {
    if (state.activeProviderView() === "github-actions") await gitHubCI.refresh();
    else if (state.activeProviderView() === "jenkins") await jenkinsCI.refresh();
    else if (state.activeProviderView() === "openshift") await openShift.refresh();
    else if (state.activeProviderView() === "snyk") return;
  };

  const knownRepoInfos = () => getKnownRepoInfos();
  const currentRepoDisplayConfig = () => repoDisplayConfig();
  const repoSessionCache = new Map<string, RepoSessionSnapshot>();

  const saveRepoSessionSnapshot = (path: string) => {
    if (!path || state.repoPath() !== path || state.graphRows().length === 0) return;
    repoSessionCache.set(path, {
      commits: state.commits(),
      graphRows: state.graphRows(),
      branches: state.branches(),
      currentBranch: state.currentBranch(),
      repoPath: state.repoPath(),
      remoteUrl: state.remoteUrl(),
      tagDetails: new Map(state.tagDetails()),
      stashByParent: new Map(state.stashByParent()),
      cursorIndex: state.cursorIndex(),
      scrollTargetIndex: state.scrollTargetIndex(),
      maxGraphColumns: state.maxGraphColumns(),
      hasMore: state.hasMore(),
      lastFetchTime: state.lastFetchTime(),
      activeProviderView: state.activeProviderView(),
      graphScrollTop: graphScrollboxRef?.scrollTop ?? 0,
    });
  };

  const restoreRepoSessionSnapshot = (snapshot: RepoSessionSnapshot) => {
    batch(() => {
      actions.setCommits(snapshot.commits);
      actions.setGraphRows(snapshot.graphRows);
      actions.setBranches(snapshot.branches);
      actions.setCurrentBranch(snapshot.currentBranch);
      actions.setRepoPath(snapshot.repoPath);
      actions.setRemoteUrl(snapshot.remoteUrl);
      actions.setTagDetails(new Map(snapshot.tagDetails));
      actions.setStashByParent(new Map(snapshot.stashByParent));
      actions.setCursorIndex(snapshot.cursorIndex);
      actions.setScrollTargetIndex(snapshot.scrollTargetIndex);
      actions.setMaxGraphColumns(snapshot.maxGraphColumns);
      actions.setHasMore(snapshot.hasMore);
      actions.setLastFetchTime(snapshot.lastFetchTime);
      actions.setActiveProviderView(snapshot.activeProviderView);
      actions.setLoading(false);
      actions.setFetching(false);
      actions.setDetailLoading(false);
    });
    setPendingGraphScrollTop(snapshot.graphScrollTop);
  };

  createEffect(() => {
    const top = pendingGraphScrollTop();
    if (top == null || state.loading()) return;
    cancelScrollRestore();
    const version = scrollRestoreVersion;
    const path = activeRepoPath();
    const restore = () => {
      if (version !== scrollRestoreVersion || activeRepoPath() !== path || state.loading()) return;
      graphScrollboxRef?.scrollTo(top);
    };
    scrollRestoreTimers = [
      setTimeout(restore, 0),
      setTimeout(restore, 16),
      setTimeout(() => {
        restore();
        if (version !== scrollRestoreVersion || activeRepoPath() !== path || state.loading()) return;
        setPendingGraphScrollTop(null);
        scrollRestoreTimers = [];
      }, 50),
    ];
    onCleanup(cancelScrollRestore);
  });

  const resetTransientRepoState = () => {
    setDialog(null);
    setCommandBarMode("idle");
    setCommandBarValue("");
    setSearchFocused(false);
    setSearchInputValue("");
    clearAnchor();
    actions.setSearchQuery("");
    actions.setViewingBranch(null);
    actions.setPathFilter(null);
    actions.setPathMatchSet(null);
    actions.setError(null);
    actions.setCommitDetail(null);
    actions.setUncommittedDetail(null);
    actions.setDetailCursorIndex(0);
  };

  const switchRepoPath = (nextPath: string) => {
    const currentPath = activeRepoPath();
    if (!nextPath || nextPath === currentPath) return;
    cancelScrollRestore();
    setPendingGraphScrollTop(null);
    saveRepoSessionSnapshot(currentPath);
    actions.setActiveProviderView("git");
    gitHubCI.invalidate();
    jenkinsCI.invalidate();
    openShift.invalidate();
    snyk.invalidate();
    actions.clearProviderState();
    resetTransientRepoState();
    setRepoSelectorVisible(false);
    setActiveRepoPath(nextPath);
    const snapshot = repoSessionCache.get(nextPath);
    if (snapshot) {
      restoreRepoSessionSnapshot(snapshot);
    } else {
      actions.setCommits([]);
      actions.setGraphRows([]);
      actions.setBranches([]);
      actions.setCurrentBranch("");
      actions.setRepoPath(nextPath);
      actions.setRemoteUrl("");
      actions.setTagDetails(new Map());
      actions.setStashByParent(new Map());
      actions.setLoading(true);
    }
  };

  const switchGroupRepo = (direction: 1 | -1) => {
    const nextPath = nextGroupRepoPath(knownRepoInfos(), activeRepoPath(), direction, currentRepoDisplayConfig());
    if (!nextPath) return;
    switchRepoPath(nextPath);
  };

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

  // All git data loading: initial load, pagination, fetch, and auto-refresh timer.
  const { loadData, loadMoreData, handleFetch } = useDataLoader({
    repoPath: activeRepoPath,
    initialBranch: props.branch,
    state,
    actions,
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
    getCommitData: sha => {
      switch (state.activeProviderView()) {
        case "github-actions":
          return gitHubCI.getCommitData(sha);
        case "jenkins":
          return jenkinsCI.getCommitData(sha);
        case "openshift":
          return openShift.getCommitData(sha);
        case "snyk":
          return snyk.getCommitData(sha);
        case "git":
          return null;
      }
    },
    getProviderLoading: () => state.providerStatus().kind === "loading",
  });

  // Scroll detail panel to top when active tab changes
  createEffect(() => {
    state.detailActiveTab(); // track
    detailScrollboxRef?.scrollTo(0);
  });

  const handleSearchInput = (value: string) => {
    setSearchInputValue(value);
  };

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

  /** Open a sub-dialog from within the menu (e.g. theme picker). */
  const handleOpenDialog = (dialogId: "theme") => {
    if (dialogId === "theme") {
      setDialog("theme");
    }
  };

  /** Switch the graph to view a specific branch perspective. */
  const handleViewBranch = (branch: string | null) => {
    actions.setViewingBranch(branch);
    // When clearing the filter (null), jump to checked-out branch head;
    // when setting a filter, try to keep the cursor on the same commit.
    const stickyHash = branch ? state.selectedCommit()?.hash : undefined;
    loadData(undefined, stickyHash);
  };

  /**
   * Execute a command dispatched from the command bar.
   * Receives the trimmed value entered after `:` (e.g. "q", "quit", "m", "search").
   */
  const handleCommandExecute = (cmd: string) => {
    const normalized = cmd.toLowerCase().replace(/^:/, "");

    switch (normalized) {
      case "q":
      case "quit":
        renderer.destroy();
        break;
      case "m":
      case "menu":
        setDialog("menu");
        break;
      case "repo":
        setLastMenuTab("repository");
        setDialog("menu");
        break;
      case "branches":
        setLastMenuTab("branch");
        setDialog("menu");
        break;
      case "providers":
        setLastMenuTab("providers");
        setDialog("menu");
        break;
      case "switch":
        setRepoSelectorVisible(true);
        break;
      case "help":
        setDialog("help");
        break;
      case "theme":
        setDialog("theme");
        break;
      case "debug":
        setDialog(dialog() === "debug" ? null : "debug");
        break;
      case "clear":
        actions.setError(null);
        actions.setProviderStatus(state.activeProviderView(), providerIdle());
        clearDebugEvents();
        break;
      case "f":
      case "fetch":
        clearAnchor();
        void handleFetchAll();
        break;
      case "r":
      case "reload":
        clearAnchor();
        void handleReloadAll();
        break;
      case "search":
      case "p":
      case "path":
        actions.setDetailFocused(false);
        setSearchFocused(normalized === "search");
        if (normalized === "search") {
          setSearchInputValue(state.searchQuery());
          setCommandBarMode("search");
        } else {
          setCommandBarValue(state.pathFilter() ?? "");
          setCommandBarMode("path");
        }
        break;
      case "a":
      case "ancestry": {
        // Toggle ancestry mode — highlights the first-parent chain through the
        // selected commit (both backward ancestors and forward descendants).
        if (state.ancestrySet() !== null) {
          // Already active — toggle off
          clearAnchor();
          break;
        }
        // Mutually exclusive with search and path
        actions.setSearchQuery("");
        actions.setPathFilter(null);
        actions.setPathMatchSet(null);
        const anchor = state.selectedCommit()?.hash ?? null;
        if (anchor) {
          setAnchor(anchor);
        }
        break;
      }
      default:
        // Unknown command — ignore silently
        break;
    }
  };

  /**
   * Apply a path filter from the command bar PATH_INPUT mode.
   * Empty string clears the filter; non-empty sets it and computes
   * the set of matching commit hashes for display-level dimming.
   * Mutually exclusive with search and ancestry.
   */
  const { handlePathExecute } = usePathFilter({
    repoPath: activeRepoPath,
    state,
    actions,
    clearAnchor,
    setSearchInputValue,
    clearSearchDebounce: () => {},
  });

  const selectMode = (mode: "normal" | "search" | "path" | "ancestry") => {
    if (mode === "search" || mode === "path") {
      handleCommandExecute(mode);
      return;
    }
    batch(() => {
      setSearchFocused(false);
      setCommandBarMode("idle");
      setCommandBarValue("");
      setSearchInputValue("");
      actions.setSearchQuery("");
      actions.setPathFilter(null);
      actions.setPathMatchSet(null);
      if (mode === "normal") clearAnchor();
      else handleCommandExecute("ancestry");
    });
  };

  const applySearch = (value: string) => {
    batch(() => {
      clearAnchor();
      actions.setPathFilter(null);
      actions.setPathMatchSet(null);
      setSearchInputValue(value);
      actions.setSearchQuery(value);
    });
    const target = computeDisplacedIndex(state.graphRows(), state.highlightSet(), state.cursorIndex());
    actions.setCursorIndex(target);
    actions.setScrollTargetIndex(target);
  };

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
    getCommitData: sha => {
      switch (state.activeProviderView()) {
        case "github-actions":
          return gitHubCI.getCommitData(sha);
        case "jenkins":
          return jenkinsCI.getCommitData(sha);
        case "openshift":
          return openShift.getCommitData(sha);
        case "snyk":
          return snyk.getCommitData(sha);
        case "git":
          return null;
      }
    },
    getProviderLoading: () => state.providerStatus().kind === "loading",
    onSwitchGroupRepo: switchGroupRepo,
  });

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
    return { ...base, accent: providerAccent(base, view) };
  });

  return (
    <ThemeContext.Provider
      value={{
        theme: providerTheme,
        setTheme: themeState.setTheme,
        themeName: themeState.themeName,
      }}
    >
      <AppStateContext.Provider value={{ state, actions }}>
        <Show
          when={layoutMode() !== "too-small"}
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
              when={!repoSelectorVisible()}
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
                    {/* Graph area */}
                    <box flexDirection="column" flexGrow={1} paddingBottom={1}>
                      {/* Sticky column headers - above scrollbox */}
                      <ColumnHeader />

                      <GraphView
                        mouseEnabled={() => dialog() == null && state.keyboardScopeOverride() == null}
                        onSelectRow={index => {
                          const commit = state.graphRows()[index]?.commit;
                          if (!commit) return;
                          batch(() => {
                            reanchorIfOutsideChain(commit.hash);
                            setSearchFocused(false);
                            setCommandBarMode("idle");
                            setCommandBarValue("");
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
                        openshiftIsLoading={openShift.isLoading}
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
                              title={msg().title}
                              message={msg().message}
                              detail={msg().detail}
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
                        onInput={val => {
                          if (commandBarMode() === "command" || commandBarMode() === "path") {
                            setCommandBarValue(val);
                          } else {
                            handleSearchInput(val);
                          }
                        }}
                        detailFocused={state.detailFocused}
                        knownRepos={knownRepoInfos()}
                        currentRepo={activeRepoPath()}
                        currentGroup={currentRepoDisplayConfig().group}
                        currentAppName={currentRepoDisplayConfig().appName}
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
                      />
                    </box>
                  </box>

                  {/* Detail panel - right, hidden in compact/too-small mode */}
                  <Show when={layoutMode() === "normal"}>
                    <box flexDirection="column" width="25%" minWidth={60} flexShrink={0} paddingX={2} paddingBottom={1}>
                      <DetailPanel
                        mouseEnabled={dialog() == null && state.keyboardScopeOverride() == null}
                        onMouseFocus={() => {
                          setSearchFocused(false);
                          setCommandBarMode("idle");
                          setCommandBarValue("");
                          actions.setDetailFocused(true);
                        }}
                        scrollboxRef={el => {
                          detailScrollboxRef = el;
                        }}
                        navRef={detailNavRef}
                        searchFocused={searchFocused()}
                        onJumpToCommit={handleJumpToCommit}
                        onOpenDiff={handleOpenDiff}
                        githubGetCommitData={gitHubCI.getCommitData}
                        githubFetchJobsForRun={gitHubCI.fetchJobsForRun}
                        githubFetchCommitData={gitHubCI.fetchCommitDataForSHA}
                        githubProviderStatus={state.providerStatus()}
                        onOpenJobLog={handleOpenJobLog}
                        jenkinsGetCommitData={jenkinsCI.getCommitData}
                        jenkinsFetchJobsForRun={jenkinsCI.fetchJobsForRun}
                        jenkinsFetchCommitData={jenkinsCI.fetchCommitDataForSHA}
                        onOpenJenkinsJobLog={handleOpenJenkinsJobLog}
                        jenkinsProviderStatus={state.providerStatus()}
                        openshiftGetCommitData={openShift.getCommitData}
                        openshiftFetchCommitData={openShift.fetchCommitDataForSHA}
                        openshiftIsLoading={openShift.isLoading}
                        openshiftLiveAge={openShift.liveAge}
                        onOpenOpenShiftResource={handleOpenOpenShiftResource}
                        openshiftProviderStatus={state.providerStatus()}
                        snykGetCommitData={snyk.getCommitData}
                        snykIsScanning={snyk.isScanning}
                        snykScanCommit={snyk.scanCommit}
                        snykProviderStatus={state.providerStatusFor("snyk")}
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
                    onOpenDialog={handleOpenDialog}
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
                    onRepoDisplayConfigChange={setRepoDisplayConfig}
                  />
                </Show>
                <Show when={dialog() === "help"}>
                  <HelpDialog onClose={() => setDialog(null)} />
                </Show>
                <Show when={dialog() === "theme"}>
                  <ThemeDialog onClose={() => setDialog(null)} />
                </Show>
                <Show when={dialog() === "debug"}>
                  <DebugDialog onClose={() => setDialog(null)} gitColor={themeState.theme().gitBg} />
                </Show>
                <Show when={dialog() === "diff-blame" && diffTarget()}>
                  {target => (
                    <DiffBlameDialog
                      target={target()}
                      onClose={() => {
                        // In compact mode with detail focused, return to the detail dialog
                        if (layoutMode() === "compact" && state.detailFocused()) {
                          setDialog("detail");
                        } else {
                          setDialog(null);
                        }
                      }}
                      onNavigate={t => {
                        setDiffTarget(t);
                        detailNavRef.scrollToFile(t.filePath);
                      }}
                    />
                  )}
                </Show>
                {/* Detail dialog — compact mode only */}
                <Show when={dialog() === "detail"}>
                  <DetailDialog
                    scrollboxRef={el => {
                      detailScrollboxRef = el;
                    }}
                    navRef={detailNavRef}
                    searchFocused={searchFocused()}
                    onJumpToCommit={handleJumpToCommit}
                    onOpenDiff={handleOpenDiff}
                    onClose={() => setDialog(null)}
                    githubGetCommitData={gitHubCI.getCommitData}
                    githubFetchJobsForRun={gitHubCI.fetchJobsForRun}
                    githubFetchCommitData={gitHubCI.fetchCommitDataForSHA}
                    githubProviderStatus={state.providerStatus()}
                    onOpenJobLog={handleOpenJobLog}
                    jenkinsGetCommitData={jenkinsCI.getCommitData}
                    jenkinsFetchJobsForRun={jenkinsCI.fetchJobsForRun}
                    jenkinsFetchCommitData={jenkinsCI.fetchCommitDataForSHA}
                    onOpenJenkinsJobLog={handleOpenJenkinsJobLog}
                    jenkinsProviderStatus={state.providerStatus()}
                    openshiftGetCommitData={openShift.getCommitData}
                    openshiftFetchCommitData={openShift.fetchCommitDataForSHA}
                    openshiftIsLoading={openShift.isLoading}
                    openshiftLiveAge={openShift.liveAge}
                    onOpenOpenShiftResource={handleOpenOpenShiftResource}
                    openshiftProviderStatus={state.providerStatus()}
                    snykGetCommitData={snyk.getCommitData}
                    snykIsScanning={snyk.isScanning}
                    snykScanCommit={snyk.scanCommit}
                    snykProviderStatus={state.providerStatusFor("snyk")}
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
                      onClose={() => {
                        if (layoutMode() === "compact" && state.detailFocused()) setDialog("detail");
                        else setDialog(null);
                      }}
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
                      loadObject={item => openShift.loadResourceObject(item)}
                      onClose={() => {
                        if (layoutMode() === "compact" && state.detailFocused()) setDialog("detail");
                        else setDialog(null);
                      }}
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
