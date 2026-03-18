import { createEffect, Show, onMount, createSignal } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createAppState, AppStateContext } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import { getCommits, getBranches, getCurrentBranch, getRepoName, getCommitDetail } from "./git/repo";
import { buildGraph, getMaxGraphColumns } from "./git/graph";
import GraphView, { ColumnHeader } from "./components/graph";
import CommitDetailView from "./components/detail";
import type { DetailNavRef } from "./components/detail";
import Footer from "./components/footer";
import BranchDialog from "./components/dialogs/branch-dialog";
import HelpDialog from "./components/dialogs/help-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import SettingsDialog from "./components/dialogs/settings-dialog";
import packageJson from "../package.json";

interface AppProps {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
}

function AppContent(props: AppProps) {
  const { state, actions } = createAppState(props.maxCount ?? 200);
  const themeState = createThemeState(props.themeName);
  const renderer = useRenderer();

  const [dialog, setDialog] = createSignal<"branch" | "help" | "theme" | "settings" | null>(null);
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
  async function loadData(branch?: string, stickyHash?: string) {
    actions.setLoading(true);
    try {
      const repoPath = props.repoPath;
      actions.setRepoPath(repoPath);

      const [commits, branches, currentBranch, repoName] = await Promise.all([
        getCommits(repoPath, {
          maxCount: state.maxCount(),
          branch: branch,
          all: state.showAllBranches(),
        }),
        getBranches(repoPath),
        getCurrentBranch(repoPath),
        getRepoName(repoPath),
      ]);

      actions.setCommits(commits);
      const rows = buildGraph(commits);
      actions.setGraphRows(rows);
      actions.setMaxGraphColumns(getMaxGraphColumns(rows));
      actions.setBranches(branches);
      actions.setCurrentBranch(currentBranch);
      actions.setRepoName(repoName);

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
      // TODO: show error in UI
    } finally {
      actions.setLoading(false);
    }
  }

  onMount(() => {
    loadData(props.branch);
    renderer.setTerminalTitle("gittree");
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
      return;
    }

    // Debounce the detail load to avoid spawning git subprocesses on rapid navigation
    detailDebounceTimer = setTimeout(async () => {
      detailDebounceTimer = null;
      try {
        const detail = await getCommitDetail(props.repoPath, commit.hash, commit);
        if (v === detailVersion) actions.setCommitDetail(detail);
      } catch {
        if (v === detailVersion) actions.setCommitDetail(null);
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
  useKeyboard((e) => {
    if (e.eventType === "release") return;

    // Ctrl+S opens settings regardless of dialog/search state
    if (e.ctrl && e.name === "s") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "settings" ? null : "settings");
      return;
    }

    // Ctrl+T opens theme dialog regardless of dialog/search state
    if (e.ctrl && e.name === "t") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "theme" ? null : "theme");
      return;
    }

    // F1 opens help regardless of dialog/search state
    if (e.name === "f1") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      setDialog(dialog() === "help" ? null : "help");
      return;
    }

    // F5 refreshes git data, preserving scroll position
    if (e.name === "f5") {
      setSearchFocused(false);
      actions.setDetailFocused(false);
      if (dialog()) setDialog(null);
      const stickyHash = state.selectedCommit()?.hash;
      loadData(undefined, stickyHash);
      return;
    }

    // Escape handling
    if (e.name === "escape") {
      if (dialog()) {
        setDialog(null);
        return;
      }
      if (state.detailFocused()) {
        actions.setDetailFocused(false);
        return;
      }
      if (searchFocused()) {
        setSearchFocused(false);
        return;
      }
      if (state.searchQuery()) {
        actions.setSearchQuery("");
        actions.setCursorIndex(0);
        actions.setScrollTargetIndex(0);
        return;
      }
      return;
    }

    // If search input is focused, let the input handle all other keys
    if (searchFocused()) return;

    // If a dialog is open, only handle Escape (handled above)
    if (dialog()) return;

    // Detail panel focused: up/down navigate interactive items, enter activates
    if (state.detailFocused()) {
      switch (e.name) {
        case "left":
          e.preventDefault();
          actions.setDetailFocused(false);
          return;
        case "up":
          e.preventDefault();
          actions.moveDetailCursor(-1, detailNavRef.itemCount);
          detailScrollboxRef?.scrollBy(-1, "absolute");
          return;
        case "down":
          e.preventDefault();
          actions.moveDetailCursor(1, detailNavRef.itemCount);
          detailScrollboxRef?.scrollBy(1, "absolute");
          return;
        case "return":
          e.preventDefault();
          detailNavRef.activateCurrentItem();
          return;
        case "pageup":
          e.preventDefault();
          detailScrollboxRef?.scrollBy(-0.5, "viewport");
          return;
        case "pagedown":
          e.preventDefault();
          detailScrollboxRef?.scrollBy(0.5, "viewport");
          return;
        case "q":
          renderer.destroy();
          process.exit(0);
          break;
      }
      return; // swallow all other keys when detail is focused
    }

    switch (e.name) {
      case "q":
        renderer.destroy();
        process.exit(0);
        break;
      case "down":
        e.preventDefault();
        actions.moveCursor(e.shift ? 10 : 1);
        detailScrollboxRef?.scrollTo(0);
        break;
      case "up":
        e.preventDefault();
        actions.moveCursor(e.shift ? -10 : -1);
        detailScrollboxRef?.scrollTo(0);
        break;
      case "return":
        e.preventDefault();
        // Reset detail scroll to top when selecting a new commit
        detailScrollboxRef?.scrollTo(0);
        break;
      case "right":
        e.preventDefault();
        if (state.selectedCommit()) {
          actions.setDetailOriginHash(null);
          actions.setDetailCursorIndex(0);
          actions.setDetailFocused(true);
        }
        break;
      case "left":
        e.preventDefault();
        // Re-center scroll on current cursor position
        actions.setScrollTargetIndex(state.cursorIndex());
        break;
      case "g":
        e.preventDefault();
        if (!e.shift) {
          actions.setCursorIndex(0);
          actions.setScrollTargetIndex(0);
        } else {
          const lastIdx = state.filteredRows().length - 1;
          actions.setCursorIndex(lastIdx);
          actions.setScrollTargetIndex(lastIdx);
        }
        detailScrollboxRef?.scrollTo(0);
        break;
      case "pagedown":
        e.preventDefault();
        actions.moveCursor(20);
        detailScrollboxRef?.scrollTo(0);
        break;
      case "pageup":
        e.preventDefault();
        actions.moveCursor(-20);
        detailScrollboxRef?.scrollTo(0);
        break;
      case "/":
        actions.setDetailFocused(false);
        setSearchFocused(true);
        break;
      case "b":
        actions.setDetailFocused(false);
        setDialog("branch");
        break;
      case "a": {
        const newAll = !state.showAllBranches();
        actions.setShowAllBranches(newAll);
        loadData(newAll ? undefined : state.currentBranch());
        break;
      }
    }
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
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().accent}>Git</text>
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().foregroundMuted}>
                    {"  "}{state.repoPath() ? state.repoPath().replace(/^\/Users\/[^/]+/, "~") : ""}{state.currentBranch() ? `:${state.currentBranch()}` : ""}
                  </text>
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
          <Show when={dialog() === "branch"}>
            <BranchDialog
              onClose={() => setDialog(null)}
              onSelect={(branch) => {
                loadData(branch);
              }}
            />
          </Show>
          <Show when={dialog() === "help"}>
            <HelpDialog onClose={() => setDialog(null)} />
          </Show>
          <Show when={dialog() === "theme"}>
            <ThemeDialog onClose={() => setDialog(null)} />
          </Show>
          <Show when={dialog() === "settings"}>
            <SettingsDialog
              onClose={() => setDialog(null)}
              onReload={() => loadData()}
              onOpenDialog={(dialogId) => {
                if (dialogId === "theme") {
                  setDialog("theme");
                }
              }}
            />
          </Show>
        </box>
      </AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}

export default function App(props: AppProps) {
  return <AppContent {...props} />;
}
