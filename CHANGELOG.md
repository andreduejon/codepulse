# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-05-06

### Added

- **Jenkins provider MVP** — configure Jenkins jobs from the Providers menu and
  switch to Jenkins from the graph view with `tab`.
- **Jenkins graph badges** — recent Jenkins builds are matched to visible commits
  by exact Git SHA from `changeSets`, with guarded fallback handling for
  multi-SCM builds.
- **Jenkins detail tab** — selected commits show matching Jenkins workflow runs
  in the shared provider detail tree.
- **Lazy Jenkins stage loading** — expanding a Jenkins run loads real pipeline
  stages from `wfapi/describe` only when needed.
- **Jenkins build logs** — pressing Enter on the build row opens the shared job
  log dialog using Jenkins `consoleText` output.
- **Provider run opener** — `o` in the log dialog opens the GitHub Actions run or
  Jenkins build URL in the system browser.
- **Raw log view** — the log dialog now cycles `all → issues → errors → raw`,
  allowing unclassified output when tests intentionally print error text.
- **Per-provider freshness display** — Providers menu headers show the last
  successful refresh time for GitHub and Jenkins separately.
- **Jenkins configuration** — Providers menu supports username, token env var,
  fetch size per job (`10` / `20` / `50`), and editable job URLs.
- **Jenkins tests** — API tests cover URL normalization, label derivation, SHA
  extraction, graph badge aggregation, auth headers, and SSO redirect detection.

### Changed

- GitHub Actions and Jenkins detail tabs now share a single provider run tree
  component for consistent navigation, status icons, durations, and placeholders.
- GitHub Actions and Jenkins logs now share one log dialog with provider-neutral
  run/job navigation and parsing.
- Log readability improved: normal log lines use foreground text, Jenkins
  timestamps are stripped, and Jenkins pipeline stage markers are highlighted.
- Provider labels are harmonized as `Git`, `GitHub`, and `Jenkins` in visible UI
  while internal provider IDs remain lowercase.
- Jenkins run rows hide duplicate run duration; the build row shows exact
  `wfapi` duration and stage rows show stage durations.
- Provider refreshes now refresh the active provider as well as repository data.
- Completed Jenkins jobs and logs are cached for the session; running Jenkins
  runs remain refreshable.
- GitHub and Jenkins HTTP fetches now share timeout/retry helpers.
- OpenTUI dependencies updated from `0.2.2` to `0.2.3`.

### Fixed

- Jenkins authentication failures now detect SSO redirects and HTML login pages
  instead of silently showing empty results.
- Jenkins tab availability now stays visible in Jenkins provider mode, including
  loading and empty states.
- Detail cursor clamping no longer blocks Jenkins tab navigation.
- Jenkins shallow graph preload includes `changeSets` / `changeSet` data for more
  reliable SHA matching.
- Ambiguous multi-SCM Jenkins builds no longer attach the same run to multiple
  commits.
- Jenkins `wfapi` timing now drives build/stage durations, avoiding mismatched
  build vs stage time after expansion.
- Failed or empty log loads are cached in the dialog to avoid repeated fetch
  loops.
- Type-check issues in provider menu config and Jenkins fetch mocks were fixed.

### Refactored

- Extracted shared provider run tree UI used by GitHub Actions and Jenkins.
- Extracted shared provider status and HTTP retry/timeout utilities.
- Removed unused provider foundation interfaces and unused GitHub log fetch prop
  plumbing.
- Kept Jenkins auth tokens as environment variable references only; raw tokens
  are never stored in config.

## [0.3.0] - 2026-05-03

### Added

- **GitHub Actions provider** — browse workflow runs, jobs, and logs from
  selected commits
- **Providers configuration** — menu + help dialog now document setup, token
  environment var, and enterprise trust flow
- **Provider mode switching** —  `tab` cycles git and provider views with
  contextual setup guidance when unavailable
- **GitHub graph columns** — graph view can show CI status and last run
  details for commits
- **GitHub detail tree** — run/job layout, inline jobs, log dialog, loading
  states, and keyboard navigation for CI detail views
- **Provider status lane** — non-fatal integration errors now show above
  command bar
- **`:clear` command** — dismisses current status message

### Changed

- Remote CI fetch stays manual by default; local repo refresh remains separate
- GitHub host trust is per-repo and remembers only current enterprise host
- Startup repo switching now reuses canonical git root paths
- Dialog layout and error surfaces unified across repo selector, dialogs, and startup
- CLI help and branch-push CI now include explicit TypeScript checks

### Removed

- Startup CLI flags beyond positional repo path, `--help`, and `--version`
- `gh auth` token fallback for GitHub authentication; provider now uses configured
  environment variable
- Automatic remote fetch on startup; remote fetching is manual by default
- Explicit "Save to config" action; settings now persist automatically

### Fixed

- Cross-branch and selected-commit CI loading now resolves data for
  detached, or older SHA values more reliably
- GitHub request handling now covers timeouts, transient retries, and clearer
  rate-limit messaging
- GitHub job log retries no longer loop forever on empty/failing responses
- Missing jobs and failed job fetches now surface distinct errors instead of
  empty-state confusion
- Background CI errors no longer block normal navigation
- Provider view, setup, and refresh flows avoid stale loading races and preserve
  graph scroll better
- Diff/blame and dialog workflows surface load failures more consistently
- `:help` now lists `:clear` for status dismissal

### Refactored

- Provider status moved to typed helpers with shared API result shapes and SHA
  selection helpers
- Repo selector and dialog UIs now reuse shared message-box and indexed scroll helpers

## [0.2.0] - 2026-04-15

### Added

- **Command bar** — `:` opens command mode; supports `:quit`, `:menu`, `:help`,
  `:theme`, `:fetch`, `:reload`, `:search`, `:path`, `:ancestry`, `:repo`
- **Ancestry highlighting** — `a` or `:ancestry` highlights the first-parent
  chain through the selected commit with dimming of non-ancestor rows
- **Path filter** — `:path <path>` highlights commits that touched files
  matching the given path, dimming the rest
- **Unified highlighting** — search, ancestry, and path are mutually exclusive
  modes; `↑/↓` skip dimmed rows when any is active
- **Diff line wrapping** — `w` toggles line wrap in the diff dialog
- **Mode cycling** — `shift + ←/→` cycles through idle → command →
  search → path → ancestry
- **Setup screen** — first-launch welcome screen with logo banner shown when a
  repo has no config entry yet
- **Project selector** — switch between repos from the menu or at startup;
  shown when launched from a non-git directory
- **`:repo` command** — opens the menu dialog pre-focused on the Repository tab
- **Proximity preload** — lazy-loads next page when highlight navigation
  approaches the boundary

### Changed

- Help dialog rewritten as 3-tab layout (General / Diff / Commands)
- Keybinds extracted to shared `keybinds.ts` module, reused in help dialog and
  CLI `--help`
- Badge component unified — replaces old `detail-badge.tsx` with a single
  `Badge` component
- `ctrl + t` theme shortcut removed; use `:theme` command instead
- Footer hints are now context-aware

### Fixed

- Shell injection in `project-selector.tsx` — replaced `execSync` shell substring
  with `spawnSync` array args
- Renderer freeze when toggling command bar input mount/unmount
- Dialog rendering bugs — command bar execute order and TDZ in diff dialog
- Ancestry highlighting edge cases — junction replacement, fan-out vertical,
  intermediate row brightening
- Stale `ctrl + t` hotkey label in menu dialog (displayed but non-functional)

### Refactored

- Extracted pure utilities with new tests: `keyboard-nav-utils.ts`,
  `command-bar-utils.ts`, `data-loader-utils.ts`
- Extracted `useDetailCursor` hook from `detail.tsx`
- Extracted `useAncestry`, `usePathFilter` hooks and `DetailDialog` from `app.tsx`
- Extracted per-mode keyboard handlers from `useKeyboardNavigation`:
  `handle-command-bar-keys.ts`, `handle-detail-keys.ts`, `handle-graph-keys.ts`,
  `handle-cascade-close.ts`
- Extracted `DiffLineRow` component and `diff-utils` pure helpers with new tests
- Extracted `CommandBar`, `FileListView`, `LogoBanner` components
- Extracted ancestry highlight logic into testable pure functions (`graph-highlight.ts`)

## [0.1.0] - 2026-04-07

### Added

- **Config file support** — `~/.config/codepulse/config.json` with save/reset
  from the menu dialog and CLI override precedence
- **Regex search** — `/pattern/` syntax in the search input; invalid regex
  falls back to substring match
- **Lazy commit loading** — cursor-triggered pagination replaces the hard
  commit cap; page size configurable via menu
- **Adaptive compact mode** — detail panel switches to a dialog overlay on
  narrow terminals; too-small terminal guard prevents rendering artifacts
- **In-TUI error screen** — friendly startup error display with dual-tone
  logo, wrapped messages, and resolution hints
- **Upstream ahead/behind** — `↑N ↓M` shown inline in the branch section
  and menu dialog
- **Banner scroll** — long graph commit descriptions scroll horizontally when highlighted
- **Live debounced search** — results update as you type with cursor position
  preserved on filter clear

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
- Silent wrong-file fallback in diff target resolution
- Unhandled promise rejection in stash state hook

### Refactored

- Split `graph.ts` into `graph-build.ts`, `graph-render.ts`, `graph-viewport.ts`
- Split `repo.ts` into `repo-git.ts`, `repo-diff.ts`, `repo-status.ts`
- Decomposed `buildGraph` main loop into `assignNodeColumn`,
  `buildBaseConnectors`, `buildFanOutRows`, `resolveParentLanes`,
  `buildRelationEntries`
- Extracted hooks: `useDataLoader`, `useDetailLoader`, `useClipboard`,
  `useFileTree`, `useStashState`, `useMenuItems`, `useBannerScroll`, `useT`
- Extracted components: `KeyHint`, `FileTreeEntry`, `StashEntry`,
  `TotalLinesChangedRow`, `DetailPanel`, `CopyableRow`
- Extracted utilities: `scrollElementIntoView`, `buildDiffTarget`,
  `isUncommittedHash`, `detail-cursor` helpers
- Extracted CLI parsing into `src/cli/` module
- Removed deprecated `computeViewportOffsets`
- Removed dead code: unused exports, stale signals, redundant destructures
- Eliminated cross-file duplication (~400 lines removed across clipboard,
  file-tree, scroll, theme access, and key-hint patterns)

## [0.0.2] - 2026-04-03

### Fixed

- Global installs now preload the Solid OpenTUI runtime plugin correctly at startup

### Changed

- CI workflows now use clearer step names and Node 24 consistently
- Updated README with vision section and roadmap overview

## [0.0.1] - 2026-04-02

### Added

- **Diff + blame dialog** — open a full-screen diff viewer for any file by
  pressing Enter on a file row; cycle through diff / blame / new-only views with
  `b` and `n`
- **Diff stats line** — shows file status badge, `+additions −deletions`,
  and a `truncated` indicator for very large diffs
- **Structured diff title bar** — width-aware path display with truncation,
  view mode label, and file navigation counter
- **Windowed diff rendering** — only visible lines + a small buffer are
  rendered, keeping the dialog fast on large diffs
- **PgUp/PgDn** half-page scroll in the diff dialog
- **Diff truncation** — diffs exceeding 5000 lines are capped; a `truncated`
  flag is shown in the stats line
- **Alternating hunk background tints** for visual separation between hunks
- **File navigation in diff dialog** — `[`/`]` moves between files while
  keeping the dialog open; detail panel cursor stays in sync
- **Copyable detail fields** — hash, author, date, subject etc. can be copied
  with Enter; shows a `✓ copied` badge
- **Tab bar** in the detail panel — Files / Stashes / Details tabs for
  committed commits; Staged / Unstaged / Untracked for the uncommitted node
- **File tree** — modified files shown as a collapsible tree with directory
  grouping and path compaction
- **Stash entries** in the git graph with expandable file trees
- **Uncommitted changes node** at the top of the graph showing staged and unstaged changes
- **Branch perspective** — pressing Enter on a branch ref filters the graph to
  that branch's history
- **Fetch UI** — `f` triggers `git fetch`; last-fetch timestamp shown in the
  Menu dialog
- **Menu dialog** (`m`) — Repository tab with copyable origin/path, fetch
  action, and preferences
- **Help dialog** (`?`) — comprehensive keybindings reference including all
  diff dialog keys
- **Theme dialog** (`t`) — live preview of 11 color themes: Catppuccin Mocha
  (default), Dracula, Nord, Gruvbox Dark, Solarized Dark, Tokyo Night, One Dark,
  and more
- **Context-aware footer hints** — footer updates based on focused panel and
  active dialog
- **`--branch`** CLI flag to start in a specific branch perspective
- **`--no-all`** CLI flag to show only the current branch (equivalent to
  omitting `--all` from `git log`)
- **`--theme`** CLI flag to set the color theme from the command line
- **GitHub Actions CI** — runs Biome check and tests on every push/PR to `main`

### Changed

- Renamed from **gittree** to **codepulse**
- Scoped npm package to `@andreduejon/codepulse`
- Simplified keybindings — removed Vim aliases, `tab`, and `ctrl` combos; `m`
  opens menu, `q` cascades close/back/quit
- Detail panel now defaults to Files tab; auto-switches away from empty tabs
- Diff hunk separators unified to single-row horizontal rules with `·` separators
- Gutter columns sized to actual max line number width (not a fixed minimum)
- Author names normalized to NFC before truncation to avoid display artifacts
- `git log` field separator changed from `|` to ASCII RS (`\x1e`) to avoid conflicts

### Fixed

- Blame reactivity and human-readable hunk header rendering
- Cursor reset on tab switch and child/parent jump navigation
- Content-aware dialog height — shrinks to fit short diffs, caps at 90% of
  terminal height
- Horizontal rule spanning full width including the blame column
- Hunk header alignment with line numbers and content
- Cross-platform clipboard support
- Git argument sanitization to prevent injection
