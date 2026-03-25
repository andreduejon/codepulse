import { createEffect, Show, onMount, onCleanup, createSignal } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createAppState, AppStateContext } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import { getCommits, getBranches, getCurrentBranch, getCommitDetail, getRemoteUrl, fetchRemote, getLastFetchTime } from "./git/repo";
import { buildGraph, getMaxGraphColumns } from "./git/graph";
import GraphView, { ColumnHeader } from "./components/graph";
import CommitDetailView from "./components/detail";
import type { DetailNavRef } from "./components/detail";
import Footer from "./components/footer";
import HelpDialog from "./components/dialogs/help-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import MenuDialog from "./components/dialogs/menu-dialog";
import packageJson from "../package.json";
import { DEFAULT_MAX_COUNT } from "./constants";
import { useKeyboardNavigation } from "./hooks/use-keyboard-navigation";

interface AppProps {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
}

function AppContent(props: AppProps) {
  const { state, actions } = createAppState(props.maxCount ?? DEFAULT_MAX_COUNT);
  const themeState = createThemeState(props.themeName);
  const renderer = useRenderer();

  const [dialog, setDialog] = createSignal<"menu" | "help" | "theme" | null>(null);
  const [searchFocused, setSearchFocused] = createSignal(false);
  // Ref for programmatic scrolling of the detail panel
  let detailScrollboxRef: ScrollBoxRenderable | undefined;

  // Navigation ref for interactive detail panel items
  const detailNavRef: DetailNavRef = {
    itemCount: 0,
    activateCurrentItem: () => false,
    lastJumpFrom: null,
  };

  // Jump to a commit by hash (used by detail panel parent/child entries)
  const handleJumpToCommit = (hash: string, from: "child" | "parent") => {
    const rows = state.filteredRows();
    const idx = rows.findIndex((r) => r.commit.hash === hash);
    if (idx >= 0) {
      // Store the current commit as the origin for cursor positioning
      const currentHash = state.selectedCommit()?.hash ?? null;
      actions.setDetailOriginHash(currentHash);
      detailNavRef.lastJumpFrom = from;
      actions.setCursorIndex(idx);
      actions.setScrollTargetIndex(idx);
      detailScrollboxRef?.scrollTo(0);
    }
  };

  // Load git data
  async function loadData(branch?: string, stickyHash?: string, silent = false) {
    if (!silent) actions.setLoading(true);
    try {
      const repoPath = props.repoPath;
      actions.setRepoPath(repoPath);

      // When viewing a specific branch perspective, scope the log to that branch
      const viewBranch = state.viewingBranch();
      const effectiveBranch = viewBranch ?? branch;
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      const [commits, branches, currentBranch, remoteUrl] = await Promise.all([
        getCommits(repoPath, {
          maxCount: state.maxCount(),
          branch: effectiveBranch,
          all: effectiveAll,
        }),
        getBranches(repoPath),
        getCurrentBranch(repoPath),
        getRemoteUrl(repoPath),
      ]);

      // Skip update if nothing changed (avoids flicker on auto-refresh)
      if (silent) {
        const oldCommits = state.commits();
        if (
          oldCommits.length === commits.length &&
          oldCommits.every((c, i) => c.hash === commits[i].hash)
        ) {
          return;
        }
      }

      actions.setCommits(commits);
      const rows = buildGraph(commits);
      actions.setGraphRows(rows);
      actions.setMaxGraphColumns(getMaxGraphColumns(rows));
      actions.setBranches(branches);
      actions.setCurrentBranch(currentBranch);
      actions.setRemoteUrl(remoteUrl);
      actions.setError(null);

      // Selection priority: sticky hash > current branch tip > 0
      let targetIndex = 0;
      if (stickyHash) {
        const idx = rows.findIndex((r) => r.commit.hash === stickyHash);
        if (idx >= 0) {
          targetIndex = idx;
        } else {
          const cbIdx = rows.findIndex((r) => r.isOnCurrentBranch);
          if (cbIdx >= 0) targetIndex = cbIdx;
        }
      } else {
        const cbIdx = rows.findIndex((r) => r.isOnCurrentBranch);
        if (cbIdx >= 0) targetIndex = cbIdx;
      }
      actions.setCursorIndex(targetIndex);
      actions.setScrollTargetIndex(targetIndex);
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) actions.setLoading(false);
    }
  }

  onMount(() => {
    loadData(props.branch);
    renderer.setTerminalTitle("gittree");
    // Load initial fetch time
    getLastFetchTime(props.repoPath).then((time) => actions.setLastFetchTime(time));
  });

  // Fetch from remote and reload data
  async function handleFetch() {
    if (state.fetching()) return; // guard against double-fetch
    actions.setFetching(true);
    try {
      const result = await fetchRemote(props.repoPath);
      if (result.ok) {
        const fetchTime = await getLastFetchTime(props.repoPath);
        actions.setLastFetchTime(fetchTime);
        const stickyHash = state.selectedCommit()?.hash;
        await loadData(undefined, stickyHash);
      } else {
        actions.setError(result.error ?? "Fetch failed");
      }
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : String(err));
    } finally {
      actions.setFetching(false);
    }
  }

  // Auto-refresh timer: re-reads local git data at the configured interval
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const interval = state.autoRefreshInterval();
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (interval > 0) {
      autoRefreshTimer = setInterval(() => {
        const stickyHash = state.selectedCommit()?.hash;
        loadData(undefined, stickyHash, true);
      }, interval);
    }
  });
  onCleanup(() => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  });

  // Load commit detail when cursor changes (with debounce + race condition guard)
  let detailVersion = 0;
  let detailDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DETAIL_DEBOUNCE_MS = 150;

  createEffect(() => {
    const commit = state.selectedCommit();
    const v = ++detailVersion;

    // Cancel any pending debounce
    if (detailDebounceTimer) {
      clearTimeout(detailDebounceTimer);
      detailDebounceTimer = null;
    }

    if (!commit) {
      actions.setCommitDetail(null);
      actions.setDetailLoading(false);
      return;
    }

    actions.setDetailLoading(true);

    // Debounce the detail load to avoid spawning git subprocesses on rapid navigation
    detailDebounceTimer = setTimeout(async () => {
      detailDebounceTimer = null;
      try {
        const detail = await getCommitDetail(props.repoPath, commit.hash, commit);
        if (v === detailVersion) {
          actions.setCommitDetail(detail);
          actions.setDetailLoading(false);
        }
      } catch {
        if (v === detailVersion) {
          actions.setCommitDetail(null);
          actions.setDetailLoading(false);
        }
      }
    }, DETAIL_DEBOUNCE_MS);
  });

  // Search input handlers
  const handleSearchSubmit = (value: string) => {
    actions.setSearchQuery(value);
    actions.setCursorIndex(0);
    actions.setScrollTargetIndex(0);
    setSearchFocused(false);
  };

  const handleSearchInput = (value: string) => {
    // Live filter as user types — cursor moves immediately, detail load is debounced
    actions.setSearchQuery(value);
    actions.setCursorIndex(0);
    actions.setScrollTargetIndex(0);
  };

  // Keyboard handling
  useKeyboardNavigation({
    state,
    actions,
    dialog,
    setDialog,
    searchFocused,
    setSearchFocused,
    getDetailScrollboxRef: () => detailScrollboxRef,
    detailNavRef,
    loadData,
    handleFetch,
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
        <box
          flexDirection="column"
          width="100%"
          height="100%"
          backgroundColor={themeState.theme().background}
        >
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

                <GraphView />
              </box>

              {/* Search input bar - main background, inset within grey */}
              <box
                width="100%"
                minHeight={5}
                backgroundColor={themeState.theme().background}
                paddingX={2}
                paddingY={1}
                border={["left"]}
                borderStyle="heavy"
                borderColor={themeState.theme().accent}
                flexDirection="column"
              >
                {/* Line 1+: input + search result count */}
                <box flexGrow={1} flexDirection="row">
                  <input
                    focused={searchFocused()}
                    flexGrow={1}
                    placeholder="Search commits..."
                    value={state.searchQuery()}
                    onInput={handleSearchInput}
                    onSubmit={handleSearchSubmit as any}
                    fg={themeState.theme().foreground}
                    backgroundColor={themeState.theme().background}
                  />
                  <Show when={state.searchQuery()}>
                    <text
                      flexShrink={0}
                      wrapMode="none"
                      fg={state.filteredRows().length === 0 ? themeState.theme().error : themeState.theme().foregroundMuted}
                    >
                      {"  "}{state.filteredRows().length === 0 ? "No matches" : `${state.filteredRows().length} / ${state.graphRows().length}`}
                    </text>
                  </Show>
                </box>

                {/* Bottom line: Git label + repo path : branch + version */}
                <box flexDirection="row" width="100%">
                  <Show when={state.error()}>
                    <text flexShrink={0} wrapMode="none" fg={themeState.theme().error}>
                      {"error: "}{state.error()}{"  "}
                    </text>
                  </Show>
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().accent}>Git</text>
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().foregroundMuted}>
                    {"  "}{state.repoPath() ? state.repoPath().replace(/^\/Users\/[^/]+/, "~") : ""}{state.currentBranch() ? `:${state.currentBranch()}` : ""}
                  </text>
                  <Show when={state.viewingBranch()}>
                    <text flexShrink={0} wrapMode="none" fg={themeState.theme().accent}>
                      {`  [viewing: ${state.viewingBranch()}]`}
                    </text>
                  </Show>
                  <box flexGrow={1} />
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().foregroundMuted}>
                    gittree v{packageJson.version}
                  </text>
                </box>
              </box>

              {/* Footer - hotkey hints, 1 char gap above, right-aligned */}
              <box height={1} />
              <Footer />
            </box>

            {/* Detail panel - right */}
            <box
              flexDirection="column"
              width="25%"
              minWidth={60}
              flexShrink={0}
              paddingX={2}
              paddingBottom={1}

            >
              {/* Details header with reactive border */}
              <box flexDirection="column" width="100%" flexShrink={0}>
                <box
                  flexDirection="row"
                  width="100%"
                  border={["top"]}
                  borderStyle="single"
                  borderColor={state.detailFocused() ? themeState.theme().accent : themeState.theme().border}
                >
                  <text wrapMode="none">
                    <strong><span fg={state.detailFocused() ? themeState.theme().foreground : themeState.theme().foregroundMuted}>Details</span></strong>
                  </text>
                </box>
                {/* Muted separator below header */}
                <box width="100%" border={["top"]} borderStyle="single" borderColor={themeState.theme().border} />
              </box>

              <scrollbox ref={detailScrollboxRef} flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
                <CommitDetailView onJumpToCommit={handleJumpToCommit} navRef={detailNavRef} />
              </scrollbox>
            </box>
          </box>

          {/* Dialogs */}
          <Show when={dialog() === "menu"}>
            <MenuDialog
              onClose={() => setDialog(null)}
              onReload={() => loadData()}
              onFetch={handleFetch}
              onOpenDialog={(dialogId) => {
                if (dialogId === "theme") {
                  setDialog("theme");
                }
              }}
              onViewBranch={(branch) => {
                actions.setViewingBranch(branch);
                const stickyHash = state.selectedCommit()?.hash;
                loadData(undefined, stickyHash);
              }}
            />
          </Show>
          <Show when={dialog() === "help"}>
            <HelpDialog onClose={() => setDialog(null)} />
          </Show>
          <Show when={dialog() === "theme"}>
            <ThemeDialog onClose={() => setDialog(null)} />
          </Show>
        </box>
      </AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}

export default function App(props: AppProps) {
  return <AppContent {...props} />;
}
