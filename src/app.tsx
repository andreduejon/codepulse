import { createEffect, Show, onMount, createSignal } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createAppState, AppStateContext } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import { getCommits, getBranches, getCurrentBranch, getRepoName, getCommitDetail } from "./git/repo";
import { buildGraph, getMaxGraphColumns } from "./git/graph";
import GraphView from "./components/graph";
import CommitDetailView from "./components/detail";
import Footer from "./components/footer";
import BranchDialog from "./components/dialogs/branch-dialog";
import HelpDialog from "./components/dialogs/help-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import SettingsDialog from "./components/dialogs/settings-dialog";

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

  // Load git data
  async function loadData(branch?: string) {
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
      actions.setSelectedIndex(0);
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

  // Load commit detail when selection changes
  createEffect(async () => {
    const commit = state.selectedCommit();
    if (!commit) {
      actions.setCommitDetail(null);
      return;
    }
    try {
      const detail = await getCommitDetail(props.repoPath, commit.hash);
      actions.setCommitDetail(detail);
    } catch {
      actions.setCommitDetail(null);
    }
  });

  // Search input handlers
  const handleSearchSubmit = (value: string) => {
    actions.setSearchQuery(value);
    actions.setSelectedIndex(0);
    setSearchFocused(false);
  };

  const handleSearchInput = (value: string) => {
    // Live filter as user types
    actions.setSearchQuery(value);
    actions.setSelectedIndex(0);
  };

  // Keyboard handling
  useKeyboard((e) => {
    if (e.eventType === "release") return;

    // Ctrl+S opens settings regardless of dialog/search state
    if (e.ctrl && e.name === "s") {
      setSearchFocused(false);
      setDialog(dialog() === "settings" ? null : "settings");
      return;
    }

    // Ctrl+T opens theme dialog regardless of dialog/search state
    if (e.ctrl && e.name === "t") {
      setSearchFocused(false);
      setDialog(dialog() === "theme" ? null : "theme");
      return;
    }

    // Escape handling
    if (e.name === "escape") {
      if (dialog()) {
        setDialog(null);
        return;
      }
      if (searchFocused()) {
        setSearchFocused(false);
        return;
      }
      if (state.searchQuery()) {
        actions.setSearchQuery("");
        actions.setSelectedIndex(0);
        return;
      }
      return;
    }

    // If search input is focused, let the input handle all other keys
    if (searchFocused()) return;

    // If a dialog is open, only handle Escape (handled above)
    if (dialog()) return;

    switch (e.name) {
      case "q":
        renderer.destroy();
        process.exit(0);
        break;
      case "down":
        actions.moveSelection(1);
        break;
      case "up":
        actions.moveSelection(-1);
        break;
      case "g":
        if (!e.shift) {
          actions.setSelectedIndex(0);
        } else {
          actions.setSelectedIndex(state.filteredRows().length - 1);
        }
        break;
      case "pagedown":
        actions.moveSelection(20);
        break;
      case "pageup":
        actions.moveSelection(-20);
        break;
      case "return":
        actions.setShowDetailPanel(!state.showDetailPanel());
        break;
      case "/":
        setSearchFocused(true);
        break;
      case "b":
        setDialog("branch");
        break;
      case "?":
        setDialog(dialog() === "help" ? null : "help");
        break;
      case "t":
        if (e.shift) {
          actions.setShowTags(!state.showTags());
        }
        break;
      case "a": {
        const newAll = !state.showAllBranches();
        actions.setShowAllBranches(newAll);
        loadData(newAll ? undefined : state.currentBranch());
        break;
      }
      case "f":
        actions.setFocusCurrentBranch(!state.focusCurrentBranch());
        break;
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
            {/* Graph panel - left, grey background */}
            <box
              flexDirection="column"
              flexGrow={1}
              flexShrink={1}
              backgroundColor={themeState.theme().backgroundPanel}
              paddingX={2}
              paddingY={1}
            >
              <scrollbox
                flexGrow={1}
                scrollY
                scrollX={false}
                verticalScrollbarOptions={{ visible: false }}
              >
                <GraphView />
              </scrollbox>
            </box>

            {/* Detail panel - right */}
            <Show when={state.showDetailPanel()}>
              <box
                flexDirection="column"
                width="20%"
                flexShrink={0}
                paddingX={2}
                paddingY={1}
              >
                <scrollbox flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
                  <CommitDetailView />
                </scrollbox>
              </box>
            </Show>
          </box>

          {/* Search input bar */}
          <box
            width="100%"
            height={1}
            backgroundColor={themeState.theme().backgroundPanel}
            paddingX={2}
          >
            <input
              focused={searchFocused()}
              width="100%"
              placeholder="Search commits..."
              value={state.searchQuery()}
              onInput={handleSearchInput}
              onSubmit={handleSearchSubmit as any}
              fg={themeState.theme().foreground}
              backgroundColor={themeState.theme().backgroundPanel}
            />
          </box>

          {/* Footer - hotkey hints */}
          <Footer />

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
