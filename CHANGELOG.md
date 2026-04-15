# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-04-15

### Added
- **Command bar** — `:` opens command mode; supports `:quit`, `:menu`, `:help`, `:theme`, `:fetch`, `:reload`, `:search`, `:path`, `:ancestry`, `:repo`
- **Ancestry highlighting** — `a` or `:ancestry` highlights the first-parent chain through the selected commit with dimming of non-ancestor rows
- **Path filter** — `:path <glob>` highlights commits that touched files matching the given path, dimming the rest
- **Unified highlighting** — search, ancestry, and path are mutually exclusive modes; `↑/↓` skip dimmed rows when any is active
- **Diff line wrapping** — `w` toggles line wrap in the diff dialog
- **Mode cycling** — `Shift+←/→` cycles through idle → command → search → path → ancestry
- **Setup screen** — first-launch welcome screen with logo banner shown when a repo has no config entry yet
- **Project selector** — switch between repos from the menu or at startup; shown when launched from a non-git directory
- **`:repo` command** — opens the menu dialog pre-focused on the Repository tab
- **Proximity preload** — lazy-loads next page when highlight navigation approaches the boundary

### Changed
- Help dialog rewritten as 3-tab layout (General / Diff / Commands)
- Keybinds extracted to shared `keybinds.ts` module, reused in help dialog and CLI `--help`
- Badge component unified — replaces old `detail-badge.tsx` with a single `Badge` component
- `Ctrl+T` theme shortcut removed; use `:theme` command instead
- Footer hints are now context-aware (detail / input modes / graph idle)

### Fixed
- Shell injection in `project-selector.tsx` — replaced `execSync` shell string with `spawnSync` array args
- Renderer freeze when toggling command bar input mount/unmount
- Dialog rendering bugs — command bar execute order and TDZ in diff dialog
- Ancestry highlighting edge cases — junction replacement, fan-out vertical, intermediate row brightening
- Stale `ctrl+t` hotkey label in menu dialog (displayed but non-functional)

### Refactored
- Extracted pure utilities with new tests: `keyboard-nav-utils.ts`, `command-bar-utils.ts`, `data-loader-utils.ts`
- Extracted `useDetailCursor` hook from `detail.tsx`
- Extracted `useAncestry`, `usePathFilter` hooks and `DetailDialog` from `app.tsx`
- Extracted per-mode keyboard handlers from `useKeyboardNavigation`: `handle-command-bar-keys.ts`, `handle-detail-keys.ts`, `handle-graph-keys.ts`, `handle-cascade-close.ts`
- Extracted `DiffLineRow` component and `diff-utils` pure helpers with new tests
- Extracted `CommandBar`, `FileListView`, `LogoBanner` components
- Extracted ancestry highlight logic into testable pure functions (`graph-highlight.ts`)

## [0.1.0] - 2026-04-07

### Added
- **Config file support** — `~/.config/codepulse/config.json` with save/reset from the menu dialog and CLI override precedence
- **Regex search** — `/pattern/` syntax in the search input; invalid regex falls back to substring match
- **Lazy commit loading** — cursor-triggered pagination replaces the hard commit cap; page size configurable via menu
- **Adaptive compact mode** — detail panel switches to a dialog overlay on narrow terminals; too-small terminal guard prevents rendering artifacts
- **In-TUI error screen** — friendly startup error display with dual-tone logo, wrapped messages, and resolution hints
- **Upstream ahead/behind** — `↑N ↓M` shown inline in the branch section and menu dialog
- **Banner scroll** — long graph commit descriptions scroll horizontally when highlighted
- **Live debounced search** — results update as you type with cursor position preserved on filter clear

### Changed
- Menu label renamed from "Max commits" to "Page size"
- Dialogs harmonized to width 72 and H-8 height cap
- Version display moved to footer left section
- Process title set to `codepulse` on startup for consistent terminal tab names

### Fixed
- Detail dialog focus, padding, footer label, and left-arrow behavior
- Diff-blame dialog opens correctly from detail dialog in compact mode
- Continuous bottom border on tab bar
- Banner width accuracy across resize
- Compact footer label for "show details"
- Race condition in data loading with concurrent page fetches
- Stale ref labels after branch switches
- `dimChars` mutation on shared commit objects
- `rowRefs` array truncation on graph rebuild
- Silent wrong-file fallback in diff target resolution (`Math.max` masking "not found")
- Unhandled promise rejection in stash state hook

### Refactored
- Split `graph.ts` into `graph-build.ts`, `graph-render.ts`, `graph-viewport.ts`
- Split `repo.ts` into `repo-git.ts`, `repo-diff.ts`, `repo-status.ts`
- Decomposed `buildGraph` main loop into `assignNodeColumn`, `buildBaseConnectors`, `buildFanOutRows`, `resolveParentLanes`, `buildRelationEntries`
- Extracted hooks: `useDataLoader`, `useDetailLoader`, `useClipboard`, `useFileTree`, `useStashState`, `useMenuItems`, `useBannerScroll`, `useT`
- Extracted components: `KeyHint`, `FileTreeEntry`, `StashEntry`, `TotalLinesChangedRow`, `DetailPanel`, `CopyableRow`
- Extracted utilities: `scrollElementIntoView`, `buildDiffTarget`, `isUncommittedHash`, `detail-cursor` helpers
- Extracted CLI parsing into `src/cli/` module
- Removed deprecated `computeViewportOffsets`
- Removed dead code: unused exports, stale signals, redundant destructures
- Eliminated cross-file duplication (~400 lines removed across clipboard, file-tree, scroll, theme access, and key-hint patterns)

## [0.0.2] - 2026-04-03

### Fixed
- Global installs now preload the Solid OpenTUI runtime plugin correctly at startup

### Changed
- CI workflows now use clearer step names and Node 24 consistently
- Updated README with vision section and roadmap overview

## [0.0.1] - 2026-04-02

### Added
- **Diff + blame dialog** — open a full-screen diff viewer for any file by pressing Enter on a file row; cycle through diff / blame / new-only views with `b` and `n`
- **Diff stats line** — shows file status badge, `+additions −deletions`, and a `truncated` indicator for very large diffs
- **Structured diff title bar** — width-aware path display with truncation, view mode label, and file navigation counter
- **Windowed diff rendering** — only visible lines + a small buffer are rendered, keeping the dialog fast on large diffs
- **PgUp/PgDn** half-page scroll in the diff dialog
- **Diff truncation** — diffs exceeding 5000 lines are capped; a `truncated` flag is shown in the stats line
- **Alternating hunk background tints** for visual separation between hunks
- **File navigation in diff dialog** — `[`/`]` moves between files while keeping the dialog open; detail panel cursor stays in sync
- **Copyable detail fields** — hash, author, date, subject etc. can be copied with Enter; shows a `✓ copied` badge
- **Tab bar** in the detail panel — Files / Stashes / Details tabs for committed commits; Staged / Unstaged / Untracked for the uncommitted node
- **File tree** — modified files shown as a collapsible tree with directory grouping and path compaction
- **Stash entries** in the git graph with expandable file trees
- **Uncommitted changes node** at the top of the graph showing staged and unstaged changes
- **Branch perspective** — pressing Enter on a branch ref filters the graph to that branch's history
- **Fetch UI** — `f` triggers `git fetch`; last-fetch timestamp shown in the Menu dialog
- **Menu dialog** (`m`) — Repository tab with copyable origin/path, fetch action, and preferences
- **Help dialog** (`?`) — comprehensive keybindings reference including all diff dialog keys
- **Theme dialog** (`t`) — live preview of 11 color themes: Catppuccin Mocha (default), Dracula, Nord, Gruvbox Dark, Solarized Dark, Tokyo Night, One Dark, and more
- **Context-aware footer hints** — footer updates based on focused panel and active dialog
- **`--branch`** CLI flag to start in a specific branch perspective
- **`--no-all`** CLI flag to show only the current branch (equivalent to omitting `--all` from `git log`)
- **`--theme`** CLI flag to set the color theme from the command line
- **GitHub Actions CI** — runs Biome check and tests on every push/PR to `main`

### Changed
- Renamed from **gittree** to **codepulse**
- Scoped npm package to `@andreduejon/codepulse`
- Simplified keybindings — removed Vim aliases, Tab, and Ctrl combos; `m` opens menu, `q` cascades close/unfocus/quit
- Detail panel now defaults to Files tab; auto-switches away from empty tabs
- Diff hunk separators unified to single-row horizontal rules with `·` separators
- Gutter columns sized to actual max line number width (not a fixed minimum)
- Author names normalized to NFC before truncation to avoid display artifacts
- `git log` field separator changed from `|` to ASCII RS (`\x1e`) to avoid conflicts

### Fixed
- Blame reactivity and human-readable hunk header rendering
- Cursor reset on tab switch and child/parent jump navigation
- Content-aware dialog height — shrinks to fit short diffs, caps at 90% of terminal height
- Horizontal rule spanning full width including the blame column
- Hunk header alignment with line numbers and content
- Cross-platform clipboard support
- Git argument sanitization to prevent injection
