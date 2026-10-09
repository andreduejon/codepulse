# codepulse

A terminal git graph visualizer that is read-only by default. Navigate your
repository history, inspect commits, view diffs with blame, and browse
branches — all from the terminal.

Built with [Bun](https://bun.sh), [SolidJS](https://solidjs.com), and [@opentui/solid](https://github.com/anomalyco/opentui).

## Vision

`codepulse` is a git-first, read-only-by-default codebase dashboard. Git history
is the primary navigation surface, with optional CI/CD, runtime, and vulnerability
signals from GitHub Actions, Jenkins, OpenShift, and Snyk layered onto the same
commit and branch context.

## Requirements

- Git
- macOS or Linux on arm64 or x64

## Install

```sh
curl -fsSL https://github.com/andreduejon/codepulse/releases/latest/download/install.sh | sh
```

The installer downloads the binary for your platform, verifies its SHA-256
checksum, and installs `codepulse` to `~/.local/bin`. Bun and Node.js are not
required. Set `CODEPULSE_INSTALL_DIR` to install into another directory on your
`PATH`.

Release archives are also available for manual installation from
[GitHub Releases](https://github.com/andreduejon/codepulse/releases). Supported
targets are macOS arm64/x64 and glibc Linux arm64/x64. Windows and musl-based
Linux distributions such as Alpine are not currently supported.

## Usage

```sh
codepulse [path]
```

If no path is given, the current directory is used.

Local auto-refresh only reloads repository state from disk. Remote fetching
stays manual by default (`f` / `:fetch`) and can be enabled separately via
repo configuration.

## Options

| Flag            | Description  |
|-----------------|--------------|
| `-h, --help`    | Show help    |
| `-v, --version` | Show version |

## Releasing

See the [release process](docs/RELEASING.md).

## Keyboard Shortcuts

Use `codepulse -h` for complete shortcuts, commands, and provider setup.

### General

| Key   | Action                    |
|-------|---------------------------|
| `esc` | Back / clear current mode |
| `tab` | Cycle provider view       |
| `:`   | Open command mode         |
| `/`   | Open search mode          |
| `m`   | Open menu dialog          |
| `f`   | Fetch from remote         |
| `?`   | Open help dialog          |
| `q`   | Quit                      |

### Graph

| Key                       | Action                               |
|---------------------------|--------------------------------------|
| `↑` / `↓` or `j` / `k`    | Navigate commits                     |
| `shift + ↑` / `shift + ↓` | Jump 10 commits                      |
| `g` / `G`                 | First / last commit                  |
| `→` / `l`                 | Focus detail panel                   |
| `enter`                   | Focus details / open compact dialog  |
| `a`                       | Enter ancestry mode                  |
| `p`                       | Enter path mode                      |
| `shift + ←` / `shift + →` | Switch project within current group  |

Mouse wheel scrolls the graph without changing the selected commit or details.
Scrolling near the end of loaded history fetches the next page automatically.
Hover highlights the commit block background without changing text colors.
Left-click anywhere in a commit block, including its connector row, to select
it and return keyboard focus to the graph.
Graph mouse input is blocked while a dialog is open.

The command bar shows all enabled providers on dark badges. Selected text uses
provider color; hovered text uses normal foreground. Click to switch directly
(`Tab` still cycles).
Wide graph panels show providers and lowercase normal/search/path/ancestry modes
on the first row, projects and branch/commit count on the second, with a blank
spacer between. Narrow panels use three rows: providers, modes, then projects
with branch and commit count on the right.
Click a project badge to switch repositories (`Shift+Left`/`Shift+Right` still work).
Search and Path badges include the applied term, capped at 10 characters;
click to edit the full value.
`/` and `p` open the same temporary inline input as badge clicks. Enter applies; Esc cancels
without changing the current filter. Normal clears highlighting, not branch
perspective. Colon commands share the inline input row.

### Details

| Key                       | Action                                   |
|---------------------------|------------------------------------------|
| `↑` / `↓` or `j` / `k`    | Navigate items                           |
| `shift + ↑` / `shift + ↓` | Jump 10 items                            |
| `←` / `h`                 | Previous tab / exit details on first tab |
| `→` / `l`                 | Next tab                                 |
| `g` / `G`                 | Top / bottom                             |
| `enter`                   | Activate selected item                   |

## Commands

| Command       | Description                             |
|---------------|-----------------------------------------|
| `:ancestry`   | Highlight ancestry for selected commit  |
| `:branches`   | Open menu dialog on Branches tab        |
| `:clear`      | Dismiss current status message          |
| `:debug`      | Toggle debug dialog                     |
| `:fetch`      | Fetch from remote                       |
| `:help`       | Open help dialog                        |
| `:menu`       | Open menu dialog                        |
| `:path`       | Switch to path mode                     |
| `:providers`  | Open menu dialog on Providers tab       |
| `:quit`       | Quit application                        |
| `:reload`     | Reload repository data from disk        |
| `:repo`       | Open menu dialog on Repository tab      |
| `:search`     | Switch to search mode                   |
| `:switch`     | Open repository switcher                |
| `:theme`      | Open theme dialog                       |

## Providers

Provider integrations are disabled by default and configured per repository from
the Providers menu (`:providers`). Credentials are read from environment
variables and are never stored in configuration. See
[common provider behavior](docs/providers/README.md) for refresh, cache, and
diagnostic conventions.

- **GitHub Actions** — workflow runs, jobs, and logs matched to graph commits.
  See [GitHub Actions provider](docs/providers/github-actions.md).
- **Jenkins** — configured job builds, pipeline stages, and console logs,
  including limited multibranch discovery. See
  [Jenkins provider](docs/providers/jenkins.md).
- **OpenShift** — commit-matched Builds and live workload health for configured
  namespaces. See [OpenShift provider](docs/providers/openshift.md).
- **Snyk** — exact-commit vulnerability snapshots with severity counts and
  finding details. See [Snyk provider](docs/providers/snyk.md).

## Themes

Switch themes live with `:theme`, or persist a theme in repo configuration.

| Name                         | Config value         |
|------------------------------|----------------------|
| Catppuccin Mocha *(default)* | `catppuccin-mocha`   |
| OpenCode Original            | `open-code-original` |
| Tokyo Night                  | `tokyo-night`        |
| Dracula                      | `dracula`            |
| Nord                         | `nord`               |
| One Dark Pro                 | `one-dark`           |
| Gruvbox Dark                 | `gruvbox`            |
| Monokai Pro                  | `monokai`            |
| Ayu Mirage                   | `ayu-mirage`         |
| Synthwave '84                | `synthwave`          |
| Rosé Pine                    | `rose-pine`          |
| Olive Garden                 | `olive-garden`       |

## Roadmap

Codepulse is working toward `1.0.0` by stabilizing provider behavior,
configuration, cache semantics, and cross-platform distribution. See the
[changelog](CHANGELOG.md) for completed releases.

## License

[MIT](LICENSE) © andreduejon
