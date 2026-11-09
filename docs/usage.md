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
| `?` | Open help dialog |
| `q` | Quit |

In the GitHub Actions, Jenkins, and OpenShift views, `f` fetches Git and then
refreshes that provider. In the Snyk view only Git is fetched: Snyk has no server
data to refetch, and scans run when started or when an auto-scan branch moves.

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
| `v` | Snyk Dependencies: show a vulnerable package's findings |
| `g` / `G` | Top / bottom |
| `enter` | Activate selected item |

### Logs (CI jobs and OpenShift resources)

| Key | Action |
|-----|--------|
| `/` | Search; Enter keeps the query, Esc clears it |
| `n` / `N` | Next / previous search hit |
| `c` | Cycle view mode (CI: all, issues, errors, raw; OpenShift: log, JSON) |
| `w` | Toggle line wrap |
| `r` | Refresh what is shown: the log (restarting a follow; a finished CI job's log reloads from cache) or the JSON object |
| `o` | Open the CI run in the browser |
| `←` / `→` or `h` / `l` | Previous / next CI job |
| `↑` / `↓` or `j` / `k`, `shift ↑` / `shift ↓`, space, `g` / `G` | Scroll |
| `esc` | Clear search / close |

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
| `:menu` | Open menu dialog |
| `:path` | Switch to path mode |
| `:providers` | Open menu dialog on Providers tab |
| `:quit` | Quit application |
| `:reload` | Reload repository data from disk |
| `:repo` | Open menu dialog on Repository tab |
| `:search` | Switch to search mode |
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

Local auto-refresh reloads repository state from disk. Remote fetching stays
manual by default (`f` / `:fetch`). Enable auto-fetch separately in repository
configuration. Provider request, cache, and diagnostic behavior is described in
the [provider guide](providers/README.md).

Use `:cache` to inspect storage across repositories. See the [cache guide](cache.md)
for inactivity cleanup, timer resets, and confirmed repository eviction.
