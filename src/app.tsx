import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import packageJson from "../package.json";
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
import {
  COMPACT_THRESHOLD_WIDTH,
  DEFAULT_MAX_COUNT,
  MIN_TERMINAL_HEIGHT,
  MIN_TERMINAL_WIDTH,
  UNCOMMITTED_HASH,
} from "./constants";
import { AppStateContext, createAppState, useAppState } from "./context/state";
import { createThemeState, ThemeContext, useTheme } from "./context/theme";
import { buildGraph, getMaxGraphColumns } from "./git/graph";
import { mergeCommitPages } from "./git/merge-pages";
import {
  fetchRemote,
  getBranches,
  getCommitDetail,
  getCommits,
  getCurrentBranch,
  getLastFetchTime,
  getRemoteUrl,
  getStashList,
  getTagDetails,
  getUncommittedDetail,
  getWorkingTreeStatus,
} from "./git/repo";
import type { Commit, DiffTarget } from "./git/types";
import { useKeyboardNavigation } from "./hooks/use-keyboard-navigation";

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

/** Detail dialog used in compact mode — wraps DetailPanel in a full-height overlay. */
function DetailDialog(props: Readonly<DetailPanelProps & { onClose: () => void }>) {
  const dimensions = useTerminalDimensions();
  const { theme } = useTheme();
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
        backgroundColor={theme().backgroundPanel}
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
          <text flexShrink={0} wrapMode="none" fg={theme().foreground}>
            enter
          </text>
          <text flexShrink={0} wrapMode="none" fg={theme().foregroundMuted}>
            {` ${enterVerb()}  `}
          </text>
          <text flexShrink={0} wrapMode="none" fg={theme().foreground}>
            {"←/→"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={theme().foregroundMuted}>
            {" switch tab  "}
          </text>
          <text flexShrink={0} wrapMode="none" fg={theme().foreground}>
            {"↑/↓"}
          </text>
          <text flexShrink={0} wrapMode="none" fg={theme().foregroundMuted}>
            {" navigate"}
          </text>
        </DialogFooter>
      </box>
    </DialogOverlay>
  );
}

function AppContent(props: Readonly<AppProps>) {
  const { state, actions } = createAppState(props.maxCount ?? DEFAULT_MAX_COUNT, props.autoRefreshInterval);
  const themeState = createThemeState(props.themeName);
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
  };

  // Flag to suppress tab reset during child/parent jump navigation.
  // Set synchronously before setCursorIndex, read inside the commit-change effect.
  let isJumpNavigation = false;

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

  // Load git data (cancels any in-flight load so user actions always win)
  let loadAbortCtrl: AbortController | null = null;
  async function loadData(branch?: string, stickyHash?: string, silent = false, preserveLoaded = false) {
    // Cancel any in-flight load — user-initiated actions take priority
    if (loadAbortCtrl) loadAbortCtrl.abort();
    const ctrl = new AbortController();
    loadAbortCtrl = ctrl;

    if (!silent) actions.setLoading(true);
    // Reset pagination on every fresh load
    actions.setHasMore(true);
    try {
      const repoPath = props.repoPath;
      actions.setRepoPath(repoPath);

      // When viewing a specific branch perspective, scope the log to that branch
      const viewBranch = state.viewingBranch();
      const effectiveBranch = viewBranch ?? branch;
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      // Preserve scroll depth when reloading due to settings changes or manual refresh:
      // fetch at least as many commits as are currently loaded so the user doesn't
      // lose history they've already paged through.
      const pageSize = state.maxCount();
      const silentMaxCount =
        silent || preserveLoaded
          ? Math.max(pageSize, state.commits().filter(c => c.hash !== UNCOMMITTED_HASH).length)
          : pageSize;

      const [commits, branches, currentBranch, remoteUrl, tagDetails, stashes, wtStatus] = await Promise.all([
        getCommits(
          repoPath,
          {
            maxCount: silentMaxCount,
            branch: effectiveBranch,
            all: effectiveAll,
          },
          ctrl.signal,
        ),
        getBranches(repoPath, ctrl.signal),
        getCurrentBranch(repoPath, ctrl.signal),
        getRemoteUrl(repoPath, ctrl.signal),
        getTagDetails(repoPath, ctrl.signal),
        getStashList(repoPath, ctrl.signal),
        getWorkingTreeStatus(repoPath, ctrl.signal),
      ]);

      // If we were superseded by a newer loadData call, discard results
      if (ctrl.signal.aborted) return;

      // Detect whether more commits exist beyond this page.
      // Compare raw git result count against the requested page size (not silentMaxCount,
      // which may be larger — we only care about the configured page size for hasMore).
      const rawCount = commits.length;
      actions.setHasMore(rawCount >= pageSize);

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
        if (oldCommits.length === commits.length && oldCommits.every((c, i) => c.hash === commits[i].hash)) {
          return;
        }
      }

      const rows = buildGraph(commits);

      // Selection priority: sticky hash > current branch tip > 0
      let targetIndex = 0;
      if (stickyHash) {
        const idx = rows.findIndex(r => r.commit.hash === stickyHash);
        if (idx >= 0) {
          targetIndex = idx;
        } else {
          const cbIdx = rows.findIndex(r => r.isOnCurrentBranch);
          if (cbIdx >= 0) targetIndex = cbIdx;
        }
      } else {
        const cbIdx = rows.findIndex(r => r.isOnCurrentBranch);
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

  // Load next page of commits and append to the existing list.
  let loadMoreAbortCtrl: AbortController | null = null;
  async function loadMoreData() {
    // Guards: don't load if there's nothing more, or if a page fetch is already running
    if (!state.hasMore()) return;
    if (loadMoreAbortCtrl) return;

    const ctrl = new AbortController();
    loadMoreAbortCtrl = ctrl;
    actions.setFetching(true);

    try {
      const repoPath = props.repoPath;
      const pageSize = state.maxCount();

      // Skip past already-loaded real commits (exclude synthetic uncommitted node)
      const existingCommits = state.commits().filter(c => c.hash !== UNCOMMITTED_HASH);
      const skip = existingCommits.length;

      const viewBranch = state.viewingBranch();
      const effectiveAll = viewBranch ? false : state.showAllBranches();

      const newCommits = await getCommits(
        repoPath,
        {
          maxCount: pageSize,
          skip,
          branch: viewBranch ?? undefined,
          all: effectiveAll,
        },
        ctrl.signal,
      );

      if (ctrl.signal.aborted) return;

      // If we got fewer commits than a full page, we've reached the end
      actions.setHasMore(newCommits.length >= pageSize);

      if (newCommits.length === 0) return;

      // Merge: existing commits + new page (handles uncommitted node & stash badges)
      const merged = mergeCommitPages(state.commits(), newCommits, state.stashByParent());

      const rows = buildGraph(merged);

      // Preserve current cursor position (don't jump on page load)
      const stickyHash = state.selectedCommit()?.hash;
      let targetIndex = state.cursorIndex();
      if (stickyHash) {
        const idx = rows.findIndex(r => r.commit.hash === stickyHash);
        if (idx >= 0) targetIndex = idx;
      }

      batch(() => {
        actions.setCommits(merged);
        actions.setGraphRows(rows);
        actions.setMaxGraphColumns(getMaxGraphColumns(rows));
        actions.setCursorIndex(targetIndex);
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      // Non-fatal: log but don't surface to user (partial data is still valid)
      console.error("loadMoreData failed:", err);
    } finally {
      if (loadMoreAbortCtrl === ctrl) {
        loadMoreAbortCtrl = null;
        actions.setFetching(false);
      }
    }
  }

  onMount(() => {
    loadData(props.branch);
    renderer.setTerminalTitle("codepulse");
    // Load initial fetch time
    getLastFetchTime(props.repoPath).then(time => actions.setLastFetchTime(time));
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
        await loadData(undefined, stickyHash, false, true);
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
      // Jump — keep current tab, don't reset cursor (detail.tsx cursor effect
      // will position it on the correct parent/child entry using pendingJumpDirection).
    } else {
      actions.setDetailActiveTab(isUncommitted ? "unstaged" : "files");
      actions.setDetailCursorIndex(0);
      // Clear any stale jump direction on normal (non-jump) navigation
      detailNavRef.pendingJumpDirection = null;
    }

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
      if (ud.unstaged.length > 0) {
        actions.setDetailActiveTab("unstaged");
        return;
      }
      if (ud.staged.length > 0) {
        actions.setDetailActiveTab("staged");
        return;
      }
      if (ud.untracked.length > 0) {
        actions.setDetailActiveTab("untracked");
        return;
      }
    } else if (!isUncommitted) {
      if (cd && cd.files.length > 0) {
        actions.setDetailActiveTab("files");
        return;
      }
      actions.setDetailActiveTab("detail");
    }
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
    layoutMode,
    searchFocused,
    setSearchFocused,
    setSearchInputValue,
    clearSearchDebounce: () => clearTimeout(searchDebounceTimer),
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

                {/* Search section — left accent border, same padding as graph */}
                <box
                  width="100%"
                  minHeight={5}
                  backgroundColor={themeState.theme().background}
                  paddingX={2}
                  paddingY={1}
                  flexDirection="column"
                  border={["left"]}
                  borderStyle="single"
                  borderColor={!state.detailFocused() ? themeState.theme().accent : themeState.theme().border}
                >
                  {/* Search input + result count */}
                  <box flexGrow={1} flexDirection="row">
                    <input
                      focused={searchFocused()}
                      flexGrow={1}
                      placeholder="Search commits..."
                      value={searchInputValue()}
                      onInput={handleSearchInput}
                      fg={themeState.theme().foreground}
                      placeholderColor={themeState.theme().foregroundMuted}
                      backgroundColor={themeState.theme().background}
                    />
                    <text
                      flexShrink={0}
                      wrapMode="none"
                      fg={
                        state.searchQuery() && state.filteredRows().length === 0
                          ? themeState.theme().error
                          : themeState.theme().foregroundMuted
                      }
                    >
                      {"  "}
                      {state.searchQuery()
                        ? `${state.filteredRows().length} / ${state.graphRows().length}`
                        : `${state.graphRows().length}`}
                    </text>
                  </box>

                  <box height={1} />

                  {/* Git label + repo path : branch + version */}
                  <box flexDirection="row" width="100%">
                    <Show when={state.error()}>
                      <text flexShrink={0} wrapMode="none" fg={themeState.theme().error}>
                        {"error: "}
                        {state.error()}
                        {"  "}
                      </text>
                    </Show>
                    <text flexShrink={0} wrapMode="none" fg={themeState.theme().accent}>
                      Git
                    </text>
                    <text flexShrink={0} wrapMode="none" fg={themeState.theme().foregroundMuted}>
                      {"  "}
                      {state.repoPath() ? state.repoPath().replace(/^\/Users\/[^/]+/, "~") : ""}
                      {state.currentBranch() ? `:${state.currentBranch()}` : ""}
                    </text>
                    <Show when={state.viewingBranch()}>
                      <text flexShrink={0} wrapMode="none" fg={themeState.theme().accent}>
                        {`  [viewing: ${state.viewingBranch()}]`}
                      </text>
                    </Show>
                    <box flexGrow={1} />
                    <text flexShrink={0} wrapMode="none" fg={themeState.theme().foregroundMuted}>
                      {`codepulse v${packageJson.version}`}
                    </text>
                  </box>
                </box>

                {/* Footer - hotkey hints, 1 char gap above, right-aligned */}
                <box height={1} />
                <Footer
                  searchFocused={searchFocused()}
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

  return <AppContent {...props} />;
}
