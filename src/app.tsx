import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import CommandBar from "./components/command-bar";
import DetailPanel, { type DetailPanelProps } from "./components/detail-panel";
import type { DetailNavRef } from "./components/detail-types";
import { DialogFooter, DialogOverlay, DialogTitleBar } from "./components/dialogs/dialog-chrome";
import DiffBlameDialog from "./components/dialogs/diff-blame-dialog";
import HelpDialog from "./components/dialogs/help-dialog";
import MenuDialog from "./components/dialogs/menu-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import ErrorScreen from "./components/error-screen";
import Footer from "./components/footer";
import GraphView, { ColumnHeader } from "./components/graph";
import type { ConfigInfo } from "./config";
import { COMPACT_THRESHOLD_WIDTH, DEFAULT_MAX_COUNT, MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "./constants";
import { AppStateContext, createAppState, useAppState } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import type { DiffTarget } from "./git/types";
import { useDataLoader } from "./hooks/use-data-loader";
import { useDetailLoader } from "./hooks/use-detail-loader";
import { type CommandBarMode, useKeyboardNavigation } from "./hooks/use-keyboard-navigation";
import { useT } from "./hooks/use-t";

interface AppProps {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
  autoRefreshInterval?: number;
  configInfo?: ConfigInfo;
  startupError?: string;
}

interface AppContentProps extends AppProps {
  themeState: ReturnType<typeof createThemeState>;
}

/** Detail dialog used in compact mode — wraps DetailPanel in a full-height overlay. */
function DetailDialog(props: Readonly<DetailPanelProps & { onClose: () => void }>) {
  const dimensions = useTerminalDimensions();
  const t = useT();
  const { state } = useAppState();
  const dialogWidth = () => Math.min(72, dimensions().width - 8);
  const dialogHeight = () => dimensions().height - 8;

  // Dynamic enter verb based on what the cursored item does
  const enterVerb = () => state.detailCursorAction() ?? "select";

  return (
    <DialogOverlay>
      <box
        flexDirection="column"
        width={dialogWidth()}
        height={dialogHeight()}
        backgroundColor={t().backgroundPanel}
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Details" />
        {/* paddingX=4 matches other dialogs' inner content padding (outer box already has paddingX=1) */}
        <box flexDirection="column" flexGrow={1} paddingX={4}>
          <DetailPanel
            scrollboxRef={props.scrollboxRef}
            navRef={props.navRef}
            searchFocused={props.searchFocused}
            onJumpToCommit={props.onJumpToCommit}
            onOpenDiff={props.onOpenDiff}
          />
        </box>
        <DialogFooter>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            enter
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {` ${enterVerb()}  `}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            {"←/→"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" switch tab  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foreground}>
            {"↑/↓"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {" navigate"}
          </text>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}

function AppContent(props: Readonly<AppContentProps>) {
  const { state, actions } = createAppState(props.maxCount ?? DEFAULT_MAX_COUNT, props.autoRefreshInterval);
  const themeState = props.themeState;
  const renderer = useRenderer();

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
  // Mutable ref: the hash of the commit used as the anchor.
  // A ref (not signal) because it must persist across multiple effect firings
  // in the same reactive flush without being consumed (see AGENTS.md rule 3).
  let ancestryAnchorHash: string | null = null;

  /**
   * Compute the first-parent chain passing through anchorHash in both directions.
   *
   * - Backward: follow parentHashes[0] from anchorHash up through ancestors.
   * - Forward: follow the reverse first-parent map (find rows whose first parent
   *   is already in the set) down through descendants.
   *
   * Result: the mainline "backbone" that passes through the selected commit —
   * its first-parent past and its first-parent future. Merge branches and
   * off-mainline commits are excluded (and therefore dimmed).
   */
  const buildFirstParentChain = (anchorHash: string): Set<string> => {
    const rows = state.graphRows();

    // Build two lookup maps using the TRUE git first parent (commit.parents[0]), NOT the
    // display-reordered parentHashes[0]. parentHashes is reordered by sameBranchFirst so
    // the "same branch" parent sorts to position 0 — which can differ from git's first parent
    // and would cause the chain to jump to a different branch at merge commits.
    //   firstParentOf[hash]    = hash's git first parent (commit.parents[0])
    //   firstChildOf[parent]   = the child whose git first parent is `parent`
    //                            (only the first such child encountered, graph order)
    const firstParentOf = new Map<string, string>();
    const firstChildOf = new Map<string, string>();
    const loadedHashes = new Set<string>();
    for (const row of rows) {
      const hash = row.commit.hash;
      loadedHashes.add(hash);
      const fp = row.commit.parents[0]; // git first parent — preserves true mainline
      if (fp) {
        firstParentOf.set(hash, fp);
        if (!firstChildOf.has(fp)) firstChildOf.set(fp, hash);
      }
    }

    const chain = new Set<string>();
    chain.add(anchorHash);

    // Walk backward (ancestors via first-parent).
    // Only add hashes that have loaded rows — if the parent isn't loaded,
    // stop. Adding unloaded hashes to the chain would break
    // computeBrightColumns' trailing-rows extension (it checks
    // ancestrySet.has(lastFirstParent) to decide whether to extend).
    let cur: string | undefined = firstParentOf.get(anchorHash);
    while (cur && !chain.has(cur) && loadedHashes.has(cur)) {
      chain.add(cur);
      cur = firstParentOf.get(cur);
    }

    // Walk forward (descendants via first-parent)
    cur = firstChildOf.get(anchorHash);
    while (cur && !chain.has(cur)) {
      chain.add(cur);
      cur = firstChildOf.get(cur);
    }

    return chain;
  };

  // Re-run chain computation when graphRows() changes and ancestry is active (lazy-loading support).
  // The prevGraphRows ref prevents redundant recomputation during the same reactive flush
  // that initially activates ancestry (command handler already sets the chain; this effect
  // should only fire when NEW data loads, not on the activation flush itself).
  let prevGraphRows: readonly object[] | null = null;
  createEffect(() => {
    const rows = state.graphRows();
    if (rows === prevGraphRows) return; // same reference — skip redundant flush
    prevGraphRows = rows;
    if (ancestryAnchorHash !== null) {
      const newSet = buildFirstParentChain(ancestryAnchorHash);
      // Structural comparison: skip setAncestrySet if the chain hasn't changed.
      // buildFirstParentChain always returns a new Set, but SolidJS uses ===
      // for signals, so a new Set always fires even when contents are identical.
      // This prevents the full render cascade (computeBrightColumns → dimChars →
      // every GraphLine) from re-running needlessly on auto-refresh / lazy load.
      const current = state.ancestrySet();
      if (current !== null && current.size === newSet.size) {
        let same = true;
        for (const h of newSet) {
          if (!current.has(h)) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      actions.setAncestrySet(newSet);
    }
  });

  // Jump to a commit by hash (used by detail panel parent/child entries)
  const handleJumpToCommit = (hash: string, from: "child" | "parent") => {
    const rows = state.filteredRows();
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

  // Clamp cursor index when filtered results shrink (e.g. search narrowing).
  // In Phase 1 (typing, not confirmed), pin the cursor to row 0 (the anchor).
  // In Phase 2 / no search, clamp normally.
  createEffect(() => {
    const rows = state.filteredRows();
    const idx = state.cursorIndex();

    // Phase 1: pin cursor to row 0 (anchor row is always first)
    if (state.searchShowDivider()) {
      if (idx !== 0) {
        actions.setCursorIndex(0);
        actions.setScrollTargetIndex(0);
      }
      return;
    }

    // Phase 2 / no search: standard clamping
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
      case "help":
        setDialog("help");
        break;
      case "theme":
        setDialog("theme");
        break;
      case "f":
      case "fetch":
        ancestryAnchorHash = null;
        actions.setAncestrySet(null);
        handleFetch();
        break;
      case "r":
      case "reload":
        ancestryAnchorHash = null;
        actions.setAncestrySet(null);
        loadData(undefined, undefined, false, true);
        break;
      case "search":
        // Re-open search mode — ancestry and search are mutually exclusive
        ancestryAnchorHash = null;
        actions.setAncestrySet(null);
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
          ancestryAnchorHash = null;
          actions.setAncestrySet(null);
          break;
        }
        const anchor = state.selectedCommit()?.hash ?? null;
        if (anchor) {
          ancestryAnchorHash = anchor;
          actions.setAncestrySet(buildFirstParentChain(anchor));
        }
        break;
      }
      default:
        // Unknown command — ignore silently
        break;
    }
  };

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
    onClearAncestry: () => {
      ancestryAnchorHash = null;
      actions.setAncestrySet(null);
    },
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
              error={`Terminal too small (${dimensions().width}\u00d7${dimensions().height})\n\nResize to at least ${MIN_TERMINAL_WIDTH} columns and ${MIN_TERMINAL_HEIGHT} rows.`}
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
                  filterActive={!!state.searchQuery()}
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
      </AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}

export default function App(props: Readonly<AppProps>) {
  const themeState = createThemeState(props.themeName);

  if (props.startupError) {
    return (
      <themeState.ThemeContext.Provider value={themeState}>
        <ErrorScreen error={props.startupError} />
      </themeState.ThemeContext.Provider>
    );
  }

  return <AppContent {...props} themeState={themeState} />;
}
