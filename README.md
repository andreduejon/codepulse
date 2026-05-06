# codepulse

A terminal git graph visualizer that is read-only by default. Navigate your
repository history, inspect commits, view diffs with blame, and browse
branches — all from the terminal.

Built with [Bun](https://bun.sh), [SolidJS](https://solidjs.com), and [@opentui/solid](https://github.com/anomalyco/opentui).

## Vision

`codepulse` starts as a git-first terminal UI and is planned to grow into a
read-only by default codebase dashboard: git history as the primary navigation
surface, with CI/CD, security, and code quality signals layered onto the same
commit and branch context.

The current release adds GitHub Actions and Jenkins provider support on top of
the git experience, including commit-linked run views, shared log browsing, and
provider configuration from the TUI.
Integration planning for future milestones lives in `planning/` locally and is
summarized in the roadmap below.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- Git

## Install

```sh
bun install -g @andreduejon/codepulse
```

Global installs are supported directly through the packaged `codepulse` binary.

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
| `enter`                   | Open detail dialog in compact layout |
| `a`                       | Enter ancestry mode                  |
| `p`                       | Enter path mode                      |
| `shift + ←` / `shift + →` | Cycle modes                          |

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

## Roadmap

Planned milestones currently follow this shape:

- `0.1.0`: configuration file support, richer search, lazy commit loading, and
  core UX polish
- `0.2.0`: graph power features such as ancestry workflows and path-aware
  history views
- `0.3.0`: GitHub Actions integration, provider status surfacing, and repo
  trust cleanup
- `0.4.0`: Jenkins provider MVP, shared provider run tree, shared log dialog,
  and provider polish
- `0.5.0+`: read-only integrations for Snyk, SonarQube, and deeper debug tooling

The intent is to reach `1.0.0` once the integration model and configuration
surface are stable.

## License

[MIT](LICENSE) © andreduejon
