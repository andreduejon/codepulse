import { createEffect, Show, onMount, onCleanup, createSignal, batch } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createAppState, AppStateContext } from "./context/state";
import { createThemeState, ThemeContext } from "./context/theme";
import { getCommits, getBranches, getCurrentBranch, getCommitDetail, getUncommittedDetail, getRemoteUrl, fetchRemote, getLastFetchTime, getTagDetails, getStashList, getWorkingTreeStatus } from "./git/repo";
import { buildGraph, getMaxGraphColumns } from "./git/graph";
import type { Commit } from "./git/types";
import GraphView, { ColumnHeader } from "./components/graph";
import CommitDetailView from "./components/detail";
import UncommittedDetailView from "./components/uncommitted-detail";
import type { DetailNavRef } from "./components/detail-types";
import Footer from "./components/footer";
import HelpDialog from "./components/dialogs/help-dialog";
import ThemeDialog from "./components/dialogs/theme-dialog";
import MenuDialog from "./components/dialogs/menu-dialog";
import packageJson from "../package.json";
import { DEFAULT_MAX_COUNT, UNCOMMITTED_HASH } from "./constants";
import { useKeyboardNavigation } from "./hooks/use-keyboard-navigation";

interface AppProps {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
}

function AppContent(props: Readonly<AppProps>) {
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

  // Flag to suppress tab reset during child/parent jump navigation.
  // Set synchronously before setCursorIndex, read inside the commit-change effect.
  let isJumpNavigation = false;

  // Jump to a commit by hash (used by detail panel parent/child entries)
  const handleJumpToCommit = (hash: string, from: "child" | "parent") => {
    const rows = state.filteredRows();
    const idx = rows.findIndex((r) => r.commit.hash === hash);
    if (idx >= 0) {
      // Store the current commit as the origin for cursor positioning
      const currentHash = state.selectedCommit()?.hash ?? null;
      actions.setDetailOriginHash(currentHash);
      detailNavRef.lastJumpFrom = from;
      // Suppress tab reset — setCursorIndex triggers the commit-change effect
      // synchronously, which reads this flag to preserve the active tab.
      isJumpNavigation = true;
      actions.setCursorIndex(idx);
      isJumpNavigation = false;
      actions.setScrollTargetIndex(idx);
      detailScrollboxRef?.scrollTo(0);
    }
  };

  // Load git data (cancels any in-flight load so user actions always win)
  let loadAbortCtrl: AbortController | null = null;
  async function loadData(branch?: string, stickyHash?: string, silent = false) {
    // Cancel any in-flight load — user-initiated actions take priority
    if (loadAbortCtrl) loadAbortCtrl.abort();
    const ctrl = new AbortController();
    loadAbortCtrl = ctrl;

    if (!silent) actions.setLoading(true);
    try {
      const repoPath = props.repoPath;
      actions.setRepoPath(repoPath);

      // When viewing a specific branch perspective, scope the log to that branch
      const viewBranch = state.viewingBranch();
      const effectiveBranch = viewBranch ?? branch;
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      const [commits, branches, currentBranch, remoteUrl, tagDetails, stashes, wtStatus] = await Promise.all([
        getCommits(repoPath, {
          maxCount: state.maxCount(),
          branch: effectiveBranch,
          all: effectiveAll,
        }, ctrl.signal),
        getBranches(repoPath, ctrl.signal),
        getCurrentBranch(repoPath, ctrl.signal),
        getRemoteUrl(repoPath, ctrl.signal),
        getTagDetails(repoPath, ctrl.signal),
        getStashList(repoPath, ctrl.signal),
        getWorkingTreeStatus(repoPath, ctrl.signal),
      ]);

      // If we were superseded by a newer loadData call, discard results
      if (ctrl.signal.aborted) return;

      // Capture the HEAD commit hash before any synthetic commits are injected.
      const headHash = commits[0]?.hash;

      // Build stash-by-parent map: parent hash → stash Commit[].
      // Used for (a) injecting "stash (N)" badges on parent commits in the
      // graph, and (b) showing stash entries in the detail panel.
      const stashByParent = new Map<string, Commit[]>();
      if (stashes.length > 0) {
        const commitHashSet = new Set(commits.map(c => c.hash));
        for (const s of stashes) {
          const parentHash = s.parents[0];
          if (!parentHash || !commitHashSet.has(parentHash)) continue;
          const group = stashByParent.get(parentHash);
          if (group) group.push(s);
          else stashByParent.set(parentHash, [s]);
        }
        // Inject synthetic "stash (N)" ref on each parent commit so the
        // graph renders a dimmed badge. This does NOT add stash commits
        // to the commit list — they only appear in the detail panel.
        for (const [parentHash, stashGroup] of stashByParent) {
          const parentCommit = commits.find(c => c.hash === parentHash);
          if (parentCommit) {
            parentCommit.refs.push({
              name: `stash (${stashGroup.length})`,
              type: "stash" as const,
              isCurrent: false,
            });
          }
        }
      }

      // Inject a synthetic "uncommitted changes" node at index 0 when the
      // working tree is dirty.  Its parent is the current HEAD commit so
      // buildGraph draws it as a side branch off the tip.
      if (wtStatus && headHash) {
        const uncommitted: Commit = {
          hash: UNCOMMITTED_HASH,
          shortHash: "\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7",
          parents: [headHash],
          subject: "Uncommitted changes",
          body: "",
          author: "",
          authorEmail: "",
          authorDate: "",
          committer: "",
          committerEmail: "",
          commitDate: "",
          refs: [{ name: "uncommitted", type: "uncommitted" as const, isCurrent: false }],
        };
        commits.unshift(uncommitted);
      }

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

      const rows = buildGraph(commits);

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

      // Batch all signal updates to avoid intermediate reactive cascades
      batch(() => {
        actions.setCommits(commits);
        actions.setGraphRows(rows);
        actions.setMaxGraphColumns(getMaxGraphColumns(rows));
        actions.setBranches(branches);
        actions.setCurrentBranch(currentBranch);
        actions.setRemoteUrl(remoteUrl);
        actions.setTagDetails(tagDetails);
        actions.setStashByParent(stashByParent);
        actions.setError(null);
        actions.setCursorIndex(targetIndex);
        actions.setScrollTargetIndex(targetIndex);
      });
    } catch (err) {
      if (ctrl.signal.aborted) return; // superseded — ignore
      actions.setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Only clear loading/controller if we're still the active load
      if (loadAbortCtrl === ctrl) {
        loadAbortCtrl = null;
        if (!silent) actions.setLoading(false);
      }
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

  // Load commit detail when cursor changes (with debounce + abort of stale loads).
  // The debounce prevents spawning git subprocesses during rapid navigation
  // (e.g. trackpad scroll, which has natural micro-pauses of 100–300ms between
  // inertial batches that would defeat shorter debounce windows).
  let detailAbortCtrl: AbortController | null = null;
  let detailDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DETAIL_DEBOUNCE_MS = 150;

  createEffect(() => {
    const commit = state.selectedCommit();

    // Cancel any pending debounce and abort in-flight git subprocesses
    if (detailDebounceTimer) {
      clearTimeout(detailDebounceTimer);
      detailDebounceTimer = null;
    }
    if (detailAbortCtrl) {
      detailAbortCtrl.abort();
      detailAbortCtrl = null;
    }

    if (!commit) {
      actions.setCommitDetail(null);
      actions.setUncommittedDetail(null);
      actions.setDetailLoading(false);
      return;
    }

    const isUncommitted = commit.hash === UNCOMMITTED_HASH;

    // Reset active tab — but preserve it on child/parent jump navigation
    // so the user stays on the Details tab when walking the commit graph.
    // isJumpNavigation is a plain JS flag set synchronously by handleJumpToCommit
    // around the setCursorIndex call. Since SolidJS effects run synchronously when
    // a signal updates, this flag is still true when this effect fires.
    if (isJumpNavigation) {
      // Jump — keep current tab
    } else {
      actions.setDetailActiveTab(isUncommitted ? "unstaged" : "files");
    }
    actions.setDetailCursorIndex(0);

    // Clear stale detail immediately so the old file tree nodes are removed
    // from the render tree during scroll (a 334-file commit's tree = ~3K nodes).
    actions.setCommitDetail(null);
    actions.setUncommittedDetail(null);
    actions.setDetailLoading(true);

    // Debounce the detail load to avoid spawning git subprocesses on rapid navigation
    detailDebounceTimer = setTimeout(async () => {
      detailDebounceTimer = null;
      const ctrl = new AbortController();
      detailAbortCtrl = ctrl;
      try {
        if (isUncommitted) {
          // Uncommitted node: load staged/unstaged/untracked file lists in parallel
          const ud = await getUncommittedDetail(props.repoPath, ctrl.signal);
          if (!ctrl.signal.aborted) {
            actions.setUncommittedDetail(ud);
            // Also set a basic CommitDetail so any fallback code still has commit info
            actions.setCommitDetail({ ...commit, files: [...ud.staged, ...ud.unstaged, ...ud.untracked] });
            actions.setDetailLoading(false);
          }
        } else {
          const detail = await getCommitDetail(props.repoPath, commit.hash, commit, ctrl.signal);
          if (!ctrl.signal.aborted) {
            actions.setCommitDetail(detail);
            actions.setDetailLoading(false);
          }
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          actions.setCommitDetail(null);
          actions.setUncommittedDetail(null);
          actions.setDetailLoading(false);
          actions.setError(err instanceof Error ? err.message : String(err));
        }
      }
    }, DETAIL_DEBOUNCE_MS);
  });
  onCleanup(() => {
    if (detailDebounceTimer) {
      clearTimeout(detailDebounceTimer);
      detailDebounceTimer = null;
    }
    if (detailAbortCtrl) {
      detailAbortCtrl.abort();
      detailAbortCtrl = null;
    }
  });

  // Scroll detail panel to top when active tab changes
  createEffect(() => {
    state.detailActiveTab(); // track
    detailScrollboxRef?.scrollTo(0);
  });

  // Auto-switch away from empty tabs after detail data loads.
  // Finds the first non-disabled tab if the current tab has 0 items.
  createEffect(() => {
    const cd = state.commitDetail();
    const ud = state.uncommittedDetail();
    const tab = state.detailActiveTab();
    const commit = state.selectedCommit();
    if (!commit) return;

    const isUncommitted = commit.hash === UNCOMMITTED_HASH;

    // Check if current tab is empty
    let isEmpty = false;
    if (isUncommitted && ud) {
      if (tab === "unstaged") isEmpty = ud.unstaged.length === 0;
      else if (tab === "staged") isEmpty = ud.staged.length === 0;
      else if (tab === "untracked") isEmpty = ud.untracked.length === 0;
    } else if (!isUncommitted && cd) {
      if (tab === "files") isEmpty = cd.files.length === 0;
    }

    if (!isEmpty) return;

    // Find first non-empty tab to switch to
    if (isUncommitted && ud) {
      if (ud.unstaged.length > 0) { actions.setDetailActiveTab("unstaged"); return; }
      if (ud.staged.length > 0) { actions.setDetailActiveTab("staged"); return; }
      if (ud.untracked.length > 0) { actions.setDetailActiveTab("untracked"); return; }
    } else if (!isUncommitted) {
      if (cd && cd.files.length > 0) { actions.setDetailActiveTab("files"); return; }
      actions.setDetailActiveTab("detail");
    }
  });

  // Search input handlers
  const handleSearchSubmit = (value: string) => {
    batch(() => {
      actions.setSearchQuery(value);
      actions.setCursorIndex(0);
      actions.setScrollTargetIndex(0);
    });
    setSearchFocused(false);
  };

  const handleSearchInput = (value: string) => {
    // Live filter as user types — cursor moves immediately, detail load is debounced
    batch(() => {
      actions.setSearchQuery(value);
      actions.setCursorIndex(0);
      actions.setScrollTargetIndex(0);
    });
  };

  /** Open a sub-dialog from within the menu (e.g. theme picker). */
  const handleOpenDialog = (dialogId: string) => {
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
                    // @opentui/solid type bug: InputProps.onSubmit is (value: string) => void
                    // but JSX intrinsics intersect it with core's (event: SubmitEvent) => void
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

            {/* Detail panel - right (width must match DETAIL_PANEL_WIDTH_FRACTION in constants.ts) */}
            <box
              flexDirection="column"
              width="25%"
              minWidth={60}
              flexShrink={0}
              paddingX={2}
              paddingBottom={1}

            >
              {/* Tab bar with top accent line per selected tab */}
              <box flexDirection="row" width="100%" flexShrink={0}>
                {(() => {
                  const commit = state.selectedCommit();
                  const isUncommitted = commit?.hash === UNCOMMITTED_HASH;
                  const ud = state.uncommittedDetail();
                  const cd = state.commitDetail();
                  const tabs = isUncommitted
                    ? [
                      { id: "unstaged", label: `Unstaged${ud ? ` (${ud.unstaged.length})` : ""}`, disabled: ud ? ud.unstaged.length === 0 : false },
                      { id: "staged", label: `Staged${ud ? ` (${ud.staged.length})` : ""}`, disabled: ud ? ud.staged.length === 0 : false },
                      { id: "untracked", label: `Untracked${ud ? ` (${ud.untracked.length})` : ""}`, disabled: ud ? ud.untracked.length === 0 : false },
                    ]
                    : [
                      { id: "files", label: `Files${cd?.files ? ` (${cd.files.length})` : ""}`, disabled: cd ? cd.files.length === 0 : false },
                      ...(state.stashByParent().has(commit?.hash ?? "")
                        ? [{ id: "stashes", label: `Stashes (${state.stashByParent().get(commit?.hash ?? "")?.length ?? 0})`, disabled: false }]
                        : []),
                      { id: "detail", label: "Details", disabled: false },
                    ];
                  return tabs.map((tab) => {
                    const isActive = state.detailActiveTab() === tab.id;
                    const t = themeState.theme();
                    const color = tab.disabled
                      ? t.border
                      : isActive
                        ? (state.detailFocused() ? t.accent : t.foregroundMuted)
                        : t.border;
                    return (
                      <box
                        flexGrow={1}
                        justifyContent="center"
                        flexDirection="row"
                        border={["top"]}
                        borderStyle="single"
                        borderColor={color}
                      >
                        <text flexShrink={0} wrapMode="none" fg={color}>
                          <strong>{tab.label}</strong>
                        </text>
                      </box>
                    );
                  });
                })()}
              </box>
              {/* Muted separator below tabs */}
              <box width="100%" border={["top"]} borderStyle="single" borderColor={themeState.theme().border} />

              <scrollbox ref={detailScrollboxRef} flexGrow={1} scrollY scrollX={false} verticalScrollbarOptions={{ visible: false }}>
                <Show
                  when={state.selectedCommit()?.hash !== UNCOMMITTED_HASH}
                  fallback={<UncommittedDetailView onJumpToCommit={handleJumpToCommit} navRef={detailNavRef} />}
                >
                  <CommitDetailView onJumpToCommit={handleJumpToCommit} navRef={detailNavRef} />
                </Show>
              </scrollbox>
            </box>
          </box>

          {/* Dialogs */}
          <Show when={dialog() === "menu"}>
            <MenuDialog
              onClose={() => setDialog(null)}
              onReload={() => loadData()}
              onFetch={handleFetch}
              onOpenDialog={handleOpenDialog}
              onViewBranch={handleViewBranch}
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

export default function App(props: Readonly<AppProps>) {
  return <AppContent {...props} />;
}
