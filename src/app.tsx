import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import CommandBar from "./components/command-bar";
import DetailPanel from "./components/detail-panel";
import type { DetailNavRef } from "./components/detail-types";
import { DetailDialog } from "./components/dialogs/detail-dialog";
import DiffBlameDialog from "./components/dialogs/diff-blame-dialog";
import HelpDialog from "./components/dialogs/help-dialog";
import MenuDialog, { setLastMenuTab } from "./components/dialogs/menu-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import ErrorScreen from "./components/error-screen";
import Footer from "./components/footer";
import GraphView, { ColumnHeader } from "./components/graph";
import ProjectSelector from "./components/project-selector";
import SetupScreen from "./components/setup-screen";
import type { ConfigInfo } from "./config";
import { defaultConfig, getKnownRepos, writeConfig } from "./config";
import { COMPACT_THRESHOLD_WIDTH, DEFAULT_MAX_COUNT, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import { AppStateContext, createAppState } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import type { DiffTarget } from "./git/types";
import { useAncestry } from "./hooks/use-ancestry";
import { useDataLoader } from "./hooks/use-data-loader";
import { useDetailLoader } from "./hooks/use-detail-loader";
import { type CommandBarMode, useKeyboardNavigation } from "./hooks/use-keyboard-navigation";
import { usePathFilter } from "./hooks/use-path-filter";
import type { StartupMode } from "./main";
import { useGitHubCI } from "./providers/github-actions/use-github-ci";

interface AppProps {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
  autoRefreshInterval?: number;
  /** Initial pathspec filter from CLI (session-scoped). */
  path?: string;
  configInfo?: ConfigInfo;
  startupMode: StartupMode;
  /** Initial GitHub Actions provider config from the loaded config file. */
  initialGithubConfig?: { enabled?: boolean; tokenEnvVar?: string };
}

interface AppContentProps extends AppProps {
  themeState: ReturnType<typeof createThemeState>;
}

function AppContent(props: Readonly<AppContentProps>) {
  const { state, actions } = createAppState(props.maxCount ?? DEFAULT_MAX_COUNT, props.autoRefreshInterval);
  const themeState = props.themeState;
  const renderer = useRenderer();

  // ── GitHub Actions provider config (mutable signal for Providers menu tab) ──
  const [githubConfig, setGithubConfig] = createSignal({
    enabled: props.initialGithubConfig?.enabled ?? true,
    tokenEnvVar: props.initialGithubConfig?.tokenEnvVar ?? "GITHUB_TOKEN",
  });

  // ── GitHub CI data hook (called during setup, before Provider renders — per AGENTS.md rule 5) ──
  const gitHubCI = useGitHubCI({
    state,
    actions,
    config: githubConfig(),
  });

  // Setup screen visibility — shown when startup mode is "setup"
  const [setupVisible, setSetupVisible] = createSignal(props.startupMode.kind === "setup");
  // Repo selector visibility — shown when "Switch repository" is selected from menu
  const [repoSelectorVisible, setRepoSelectorVisible] = createSignal(false);

  const handleSetupComplete = () => {
    // Write default settings so the user can see and edit them in the config file
    writeConfig(defaultConfig(), props.repoPath);
    setSetupVisible(false);
  };

  // Initialize path filter from CLI --path flag (before first loadData)
  if (props.path) actions.setPathFilter(props.path);

  const [dialog, setDialog] = createSignal<"menu" | "help" | "theme" | "diff-blame" | "detail" | null>(null);

  const [searchFocused, setSearchFocused] = createSignal(false);
  /**
   * Local input value for the search bar — independent of the active filter.
   * Updated on every keystroke but only applied to the filter on submit (Enter).
   */
  const [searchInputValue, setSearchInputValue] = createSignal("");
  /** Target for the diff+blame dialog (set when user activates a file). */
  const [diffTarget, setDiffTarget] = createSignal<DiffTarget | null>(null);

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

  // ── Ancestry highlighting ─────────────────────────────────────────────────
  const { setAnchor, clearAnchor } = useAncestry(state, actions);

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

  // All git data loading: initial load, pagination, fetch, and auto-refresh timer.
  const { loadData, loadMoreData, handleFetch } = useDataLoader({
    repoPath: props.repoPath,
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
    repoPath: props.repoPath,
    state,
    actions,
    getIsJumpNavigation: () => isJumpNavigation,
    detailNavRef,
  });

  // Scroll detail panel to top when active tab changes
  createEffect(() => {
    state.detailActiveTab(); // track
    detailScrollboxRef?.scrollTo(0);
  });

  // Live debounced search: update the active filter 150ms after the user stops typing.
  // For immediate clear (Esc), the keyboard handler calls actions.setSearchQuery("")
  // directly and clears this timer.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const value = searchInputValue();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      actions.setSearchQuery(value);
    }, 150);
  });
  onCleanup(() => clearTimeout(searchDebounceTimer));

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
      case "providers":
        setLastMenuTab("providers");
        setDialog("menu");
        break;
      case "help":
        setDialog("help");
        break;
      case "theme":
        setDialog("theme");
        break;
      case "f":
      case "fetch":
        clearAnchor();
        handleFetch();
        break;
      case "r":
      case "reload":
        clearAnchor();
        loadData(undefined, undefined, false, true);
        break;
      case "search":
        // Re-open search mode — mutually exclusive with ancestry and path
        clearAnchor();
        actions.setPathFilter(null);
        actions.setPathMatchSet(null);
        setSearchFocused(true);
        setCommandBarMode("search");
        break;
      case "p":
      case "path":
        // Switch to PATH input mode — user types a path filter next
        setCommandBarMode("path");
        setCommandBarValue("");
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
    repoPath: props.repoPath,
    state,
    actions,
    clearAnchor,
    setSearchInputValue,
    clearSearchDebounce: () => clearTimeout(searchDebounceTimer),
  });

  // Keyboard handling
  useKeyboardNavigation({
    state,
    actions,
    dialog,
    setDialog,
    layoutMode,
    searchFocused,
    setSearchFocused,
    searchInputValue,
    setSearchInputValue,
    clearSearchDebounce: () => clearTimeout(searchDebounceTimer),
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
    onClearAncestry: clearAnchor,
  });

  return (
    <ThemeContext.Provider
      value={{
        theme: themeState.theme,
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
                repoPath={props.repoPath}
                onComplete={handleSetupComplete}
                onQuit={() => renderer.destroy()}
              />
            }
          >
            <Show
              when={!repoSelectorVisible()}
              fallback={
                <ProjectSelector
                  knownRepos={getKnownRepos()}
                  currentRepo={props.repoPath}
                  onCancel={() => setRepoSelectorVisible(false)}
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

                      <GraphView onLoadMore={loadMoreData} />
                    </box>

                    {/* Command bar section */}
                    <CommandBar
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
                    />

                    {/* Footer - hotkey hints, 1 char gap above, right-aligned */}
                    <box height={1} />
                    <Footer
                      commandBarMode={commandBarMode}
                      filterActive={!!state.highlightSet() || !!state.viewingBranch()}
                      compact={layoutMode() === "compact"}
                    />
                  </box>

                  {/* Detail panel - right, hidden in compact/too-small mode */}
                  <Show when={layoutMode() === "normal"}>
                    <box flexDirection="column" width="25%" minWidth={60} flexShrink={0} paddingX={2} paddingBottom={1}>
                      <DetailPanel
                        scrollboxRef={el => {
                          detailScrollboxRef = el;
                        }}
                        navRef={detailNavRef}
                        searchFocused={searchFocused()}
                        onJumpToCommit={handleJumpToCommit}
                        onOpenDiff={handleOpenDiff}
                        ciGetCommitData={gitHubCI.getCommitData}
                        ciFetchJobsForRun={gitHubCI.fetchJobsForRun}
                      />
                    </box>
                  </Show>
                </box>

                {/* Dialogs */}
                <Show when={dialog() === "menu"}>
                  <MenuDialog
                    onClose={() => setDialog(null)}
                    onReload={() => loadData(undefined, undefined, false, true)}
                    onFetch={handleFetch}
                    onOpenDialog={handleOpenDialog}
                    onViewBranch={handleViewBranch}
                    configInfo={props.configInfo}
                    onSwitchRepo={() => {
                      setDialog(null);
                      setRepoSelectorVisible(true);
                    }}
                    githubConfig={githubConfig()}
                    onGithubConfigChange={setGithubConfig}
                  />
                </Show>
                <Show when={dialog() === "help"}>
                  <HelpDialog onClose={() => setDialog(null)} />
                </Show>
                <Show when={dialog() === "theme"}>
                  <ThemeDialog onClose={() => setDialog(null)} />
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
                  />
                </Show>
              </box>
            </Show>
          </Show>
        </Show>
      </AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}

export default function App(props: Readonly<AppProps>) {
  const themeState = createThemeState(props.themeName);

  const mode = props.startupMode;

  // Fatal error — git not installed
  if (mode.kind === "error") {
    return (
      <themeState.ThemeContext.Provider value={themeState}>
        <ErrorScreen error={mode.message} />
      </themeState.ThemeContext.Provider>
    );
  }

  // Not a git repo — show project selector
  if (mode.kind === "selector") {
    return (
      <themeState.ThemeContext.Provider value={themeState}>
        <ProjectSelector message={mode.message} messagePath={mode.messagePath} knownRepos={mode.knownRepos} />
      </themeState.ThemeContext.Provider>
    );
  }

  // Git repo (setup or graph) — render AppContent which handles both
  return <AppContent {...props} themeState={themeState} />;
}
