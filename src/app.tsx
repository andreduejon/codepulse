import { createEffect, Show, onMount, createSignal } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createAppState, AppStateContext } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import { getCommits, getBranches, getCurrentBranch, getRepoName, getCommitDetail } from "./git/repo";
import { buildGraph, getMaxGraphColumns } from "./git/graph";
import GraphView, { ColumnHeader } from "./components/graph";
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
      actions.setSelectedIndex(targetIndex);
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

    // F1 opens help regardless of dialog/search state
    if (e.name === "f1") {
      setSearchFocused(false);
      setDialog(dialog() === "help" ? null : "help");
      return;
    }

    // F5 refreshes git data, preserving scroll position
    if (e.name === "f5") {
      setSearchFocused(false);
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
      case "/":
        setSearchFocused(true);
        break;
      case "b":
        setDialog("branch");
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
            {/* Left panel - graph + search + footer, all on grey background */}
            <box
              flexDirection="column"
              flexGrow={1}
              flexShrink={1}
              backgroundColor={themeState.theme().backgroundPanel}
              paddingX={2}
            >
              {/* Graph area */}
              <box flexDirection="column" flexGrow={1} paddingY={1}>
                {/* Sticky column headers - above scrollbox */}
                <ColumnHeader />

                <scrollbox
                  flexGrow={1}
                  scrollY
                  scrollX={false}
                  verticalScrollbarOptions={{ visible: false }}
                >
                  <GraphView />
                </scrollbox>
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
                {/* Line 1+: input that grows with content */}
                <box flexGrow={1}>
                  <input
                    focused={searchFocused()}
                    width="100%"
                    placeholder="Search commits..."
                    value={state.searchQuery()}
                    onInput={handleSearchInput}
                    onSubmit={handleSearchSubmit as any}
                    fg={themeState.theme().foreground}
                    backgroundColor={themeState.theme().background}
                  />
                </box>

                {/* Bottom line: Git label + repo path : branch + version */}
                <box flexDirection="row" width="100%">
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().accent}>Git</text>
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().foregroundMuted}>
                    {"  "}{state.repoPath() ? state.repoPath().replace(/^\/Users\/[^/]+/, "~") : ""}{state.currentBranch() ? `:${state.currentBranch()}` : ""}
                  </text>
                  <box flexGrow={1} />
                  <text flexShrink={0} wrapMode="none" fg={themeState.theme().foregroundMuted}>
                    gittree v0.1.0
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
              width="20%"
              minWidth={40}
              flexShrink={0}
              paddingX={2}
              paddingY={1}
            >
              <scrollbox flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
                <CommitDetailView />
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
