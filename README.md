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

The current release adds OpenShift runtime visibility alongside GitHub Actions
and Jenkins. Commits show matched resources and conservative health status;
resource API objects can be inspected as formatted JSON from the detail panel.

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
targets are macOS arm64/x64 and Linux arm64/x64 using glibc or musl. Windows is
not currently supported. Alpine Linux requires the `libstdc++` and `libgcc`
runtime packages.

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
| `enter`                   | Open detail dialog in compact layout |
| `a`                       | Enter ancestry mode                  |
| `p`                       | Enter path mode                      |
| `shift + ←` / `shift + →` | Switch project within current group  |

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

Remote providers are disabled by default and configured per repository from
the Providers menu (`:providers`). Credentials are read from environment
variables and are never stored in configuration.

- **GitHub Actions** — shows workflow runs, jobs, and logs for matching commits.
  See [GitHub Actions provider](docs/providers/github-actions.md).
- **Jenkins** — shows configured job builds, pipeline stages, and console logs.
  Job URLs are auto-detected; multibranch pipelines discover up to 25 enabled
  branch jobs across configured parents. See [Jenkins provider](docs/providers/jenkins.md).
- **OpenShift** — shows annotated Builds and ImageStreamTags, digest-matched
  Pods, and owner-resolved workloads. Enter opens cached resource JSON. See
  [OpenShift provider](docs/providers/openshift.md).

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
- `0.5.0`: grouped project switching, in-memory repo session cache, grouped
  switcher, and debug dialog
- `0.6.0`: OpenShift runtime inventory, resource health, and JSON inspection
- `0.7.0`: standalone macOS and Linux distributions with no Bun or Node.js runtime requirement
- Future: Snyk provider and further OpenShift features and polish

The intent is to reach `1.0.0` once the integration model and configuration
surface are stable.

## License

[MIT](LICENSE) © andreduejon
