# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-04-02

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
- Bumped version to `0.2.0`
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

## [0.1.0] - 2025 (initial release as gittree)

Initial release — read-only terminal git graph visualizer with lane-based graph rendering, color themes, and basic commit detail panel.
