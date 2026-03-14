import { createEffect, Show, onMount } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createAppState, AppStateContext } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import { getCommits, getBranches, getCurrentBranch, getRepoName, getCommitDetail } from "./git/repo";
import { buildGraph, getMaxGraphColumns } from "./git/graph";
import GraphView from "./components/graph";
import CommitDetailView from "./components/detail";
import Header from "./components/header";
import Footer from "./components/footer";
import SearchDialog from "./components/search";
import BranchDialog from "./components/branch-dialog";
import HelpDialog from "./components/help-dialog";
import ThemeDialog from "./components/theme-dialog";
import SettingsDialog from "./components/settings-dialog";
import { createSignal } from "solid-js";

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

  const [dialog, setDialog] = createSignal<"search" | "branch" | "help" | "theme" | "settings" | null>(null);

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

  // Keyboard handling
  useKeyboard((e) => {
    if (e.eventType === "release") return;

    // Ctrl+S opens settings regardless of dialog state
    if (e.ctrl && e.name === "s") {
      setDialog(dialog() === "settings" ? null : "settings");
      return;
    }

    // Close dialog on Escape
    if (e.name === "escape") {
      if (dialog()) {
        setDialog(null);
        return;
      }
      if (state.searchQuery()) {
        actions.setSearchQuery("");
        actions.setSelectedIndex(0);
        return;
      }
      return;
    }

    // If a dialog is open, only handle Escape (handled above)
    if (dialog()) return;

    switch (e.name) {
      case "q":
        renderer.destroy();
        process.exit(0);
        break;
      case "j":
      case "down":
        actions.moveSelection(1);
        break;
      case "k":
      case "up":
        actions.moveSelection(-1);
        break;
      case "g":
        if (!e.shift) {
          actions.setSelectedIndex(0);
        } else {
          // G (shift+g) -- go to last
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
        setDialog("search");
        break;
      case "b":
        setDialog("branch");
        break;
      case "?":
        setDialog(dialog() === "help" ? null : "help");
        break;
      case "t":
        if (e.shift) {
          // T (shift+t) -- toggle tags
          actions.setShowTags(!state.showTags());
        } else {
          // t -- change theme
          setDialog("theme");
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
          {/* Header */}
          <Header />

          {/* Main content area */}
          <box flexDirection="row" flexGrow={1}>
            {/* Graph panel */}
            <box
              flexDirection="column"
              flexGrow={state.showDetailPanel() ? 2 : 1}
              flexShrink={1}
              border={["right"]}
              borderColor={themeState.theme().border}
              borderStyle="single"
            >
              <scrollbox
                flexGrow={1}
                scrollY
                scrollX={false}
              >
                <GraphView />
              </scrollbox>
            </box>

            {/* Detail panel */}
            <Show when={state.showDetailPanel()}>
              <box flexDirection="column" flexGrow={1} flexShrink={1} width="40%">
                <scrollbox flexGrow={1} scrollY scrollX={false}>
                  <CommitDetailView />
                </scrollbox>
              </box>
            </Show>
          </box>

          {/* Footer */}
          <Footer />

          {/* Dialogs */}
          <Show when={dialog() === "search"}>
            <SearchDialog onClose={() => setDialog(null)} />
          </Show>
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
