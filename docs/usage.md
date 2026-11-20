# Usage

```sh
codepulse [path]
```

With no path, Codepulse opens the current directory. Use `-h` / `--help` for
CLI help and `-v` / `--version` to show the version. Press `?` in the app for
the full shortcut and provider setup reference.

## Keyboard shortcuts

### General

| Key | Action |
|-----|--------|
| `esc` | Back / clear current mode |
| `tab` | Cycle provider view |
| `:` | Open command mode |
| `/` | Open search mode |
| `m` | Open menu dialog |
| `f` | Fetch Git and the open provider |
| `ctrl+f` | Fetch and fast-forward |
| `?` | Open help dialog |
| `q` | Quit |

In the GitHub Actions, Jenkins, and OpenShift views, `f` fetches Git and then
refreshes that provider. On the Dashboard it refreshes every provider. In the
Snyk view only Git is fetched: Snyk has no server data to refetch, and scans run
when started or when an auto-scan branch moves.

### Graph

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate commits |
| `shift ↑` / `shift ↓` | Jump 10 commits |
| `g` / `G` | First / last commit |
| `→` / `l` | Focus detail panel (wide layout) |
| `enter` | Focus details / open compact dialog |
| `a` | Enter ancestry mode |
| `p` | Enter path mode |
| `shift ←` / `shift →` | Switch repository within the current group |

In the compact layout (narrower than 180 columns) details open as a dialog: use
`enter` to open it and `esc` to close it; `→` / `l` do not open it and `←` / `h`
on the first tab does not close it.

Search (`/`) and path filtering (`p`) apply on Enter. Esc cancels without
changing the current filter. Badge clicks offer the same filtering controls.
Normal clears highlighting without changing branch perspective.

### Commit details

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate items (an item taller than the panel, like a long commit body, scrolls first) |
| `shift ↑` / `shift ↓` | Jump 10 items |
| `←` / `h` | Previous tab / exit details on the first tab (wide layout) |
| `→` / `l` | Next tab |
| `o` | Open the selected row in the browser: a CI run, job or build, an OpenShift namespace or resource, a Snyk finding |
| `v` | Snyk Dependencies: show a vulnerable package's findings |
| `g` / `G` | Top / bottom |
| `enter` | Activate selected item |

### Logs (CI jobs and OpenShift resources)

| Key | Action |
|-----|--------|
| `/` | Search; Enter keeps the query, Esc clears it |
| `n` / `N` | Next / previous search hit |
| `c` | Cycle view mode (CI: all, issues, errors, raw; OpenShift: log, JSON, events) |
| `w` | Toggle line wrap |
| `r` | Refresh what is shown: the log (restarting a follow; a finished CI job's log reloads from cache) or the JSON object |
| `o` | Open the CI run in the browser |
| `←` / `→` or `h` / `l` | Previous / next CI job |
| `↑` / `↓` or `j` / `k`, `shift ↑` / `shift ↓`, space, `g` / `G` | Scroll |
| `esc` | Clear search / close |

### Dashboard

The Dashboard is the first tab: everything that happened to the open app, newest first. Each event is a knot on the
app's rope in its provider's color: commits on the main branch, GitHub runs and pull requests (opened, merged,
closed), Jenkins builds, OpenShift builds and warnings, and Snyk scans, with their commit, branch and time. A build that is still running shows as running and turns
into how it ended. The branch is the one the provider names (a GitHub run's, a Jenkins multibranch job's, an OpenShift
build's Git ref), else the branch the commit was made on.

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate events |
| `shift ↑` / `shift ↓`, `PgUp` / `PgDn` | Jump 10 events |
| `g` / `G`, `home` / `end` | First / last event |
| `enter` | Show the event's commit in its provider's view with its details (wide layout) / open its details (compact layout) |
| `→` / `l` | Give the event's provider tab the keyboard (wide layout); `←` on its first tab gives it back |
| `o` | Open the run's or build's page in the browser |
| `r` | Fetch every provider again and read the events |

- While the Dashboard is shown, each provider fetches and auto refreshes as on its own tab. `f` and `:reload` fetch
  every provider. A failed fetch or scan shows in the message box: several share one box, with a line each. A provider
  that is turned off has no events there, also none it cached before.
- Each provider has a badge in its color where the graph's modes are. A click on it, or `:hide NAME` and
  `:show NAME`, hides or shows that provider's events, and the count reads `26 / 30 events`. `:show` shows them all.
  The names are `git`, `github`, `jenkins`, `openshift` and `snyk`.
- A scan shows its total and every severity in order (`1 critical · 3 high · 0 medium · 0 low`), each count in its
  severity's color. A partial scan ends in Snyk's `?`.
- From 180 columns a side panel shows the selected event in its provider's own tab for the event's commit, as
  that provider's view shows it: runs with jobs, steps and annotations, builds with stages and tests, resources,
  findings. The event's own run, build or resource is open, its name in the Dashboard's color, and `→` puts the
  cursor on it. **Info** beside it shows the commit as the graph's Info tab does; a commit has Info only. The keys work
  as there: `↑`/`↓`, `enter` (a run, a log), `←`/`→` between the tabs. Below 180
  columns, `enter` opens the same as a dialog, where `s` shows the event in its provider's view.
- **Menu → Providers → Dashboard** turns it off (Enabled), and sets how far back it reads (Time window, 7 days by
  default) and how long a knot is (Knot size, 1 hour by default). Saved per repository.

Theme controls and custom configuration are in the [theme guide](themes.md).

## Commands

| Command | Description |
|---------|-------------|
| `:ancestry` | Highlight ancestry for the selected commit |
| `:branches` | Open menu dialog on Branches tab |
| `:cache` | Open global cache screen |
| `:clear` | Dismiss the current status message (or click its `✕`) and clear Debug |
| `:debug` | Toggle debug dialog |
| `:fetch` | Fetch Git and the open provider |
| `:help` | Open help dialog |
| `:hide NAME` | Hide a provider's events on the dashboard |
| `:menu` | Open menu dialog |
| `:path` | Switch to path mode |
| `:pull` | Fetch and fast-forward |
| `:providers` | Open menu dialog on Providers tab |
| `:quit` | Quit application |
| `:reload` | Reload repository data from disk |
| `:repo` | Open menu dialog on Repository tab |
| `:search` | Switch to search mode |
| `:show [NAME]` | Show a provider's events on the dashboard, or all |
| `:switch` | Open repository switcher |
| `:theme` | Open theme dialog |

## Configuration and cache

| Platform | Configuration | Provider cache root |
|----------|---------------|---------------------|
| macOS / Linux | `~/.config/codepulse/config.json` | `~/.cache/codepulse` |
| Windows | `%APPDATA%\codepulse\config.json` | `%LOCALAPPDATA%\codepulse\Cache` |

Settings are saved per repository. Menu → Repository → Configuration shows the
full config path. Click it or press Enter to copy. Windows AppData locations
fall back to the corresponding folders under your home if environment variables
are absent. Earlier experimental Windows `.config`/`.cache` files are not migrated.
A value Codepulse can't use is ignored, and Debug (`:debug`) names it and why, as
it does for a custom theme it skips.

Local auto-refresh reloads repository state from disk. Remote fetching stays
manual by default (`f` / `:fetch`). Enable auto-fetch separately in repository
configuration.

By default a fetch moves only the remote branches (`origin/main`), not your local
ones (Auto fast-forward, below, changes that).
`ctrl+f` / `:pull` fetches and then fast-forwards each local branch that is only
behind its remote branch, like `git pull --ff-only`, and says what moved. The
checked-out branch moves with its files only while no tracked file has changes.
A branch with commits of its own, or one checked out in another worktree, stays
where it is, and the message says why. **Menu → Repository → Preferences →
Auto fast-forward** (off by default, saved per repository as
`autoFastForward`) makes `f` and Auto fetch fast-forward too. They only
report a branch that stayed behind. Provider request, cache, and diagnostic behavior is described in
the [provider guide](providers/README.md).

Use `:cache` to inspect storage across repositories. See the [cache guide](cache.md)
for inactivity cleanup, timer resets, and confirmed repository eviction.
