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
- macOS or glibc Linux on arm64 or x64; Windows 11 x64/ARM64 with Windows Terminal

## Install

### macOS / Linux

```sh
curl -fsSL https://github.com/andreduejon/codepulse/releases/latest/download/install.sh | sh
```

The installer downloads the binary for your platform, verifies its SHA-256
checksum, and installs `codepulse` to `~/.local/bin`. Bun and Node.js are not
required. Set `CODEPULSE_INSTALL_DIR` to install into another directory on your
`PATH`.

Release archives are also available for manual installation from
[GitHub Releases](https://github.com/andreduejon/codepulse/releases). Supported
targets are macOS, glibc Linux, and Windows on arm64/x64. Musl-based Linux
distributions such as Alpine are not currently supported.

### Windows

Download the installer in PowerShell, then run it after the download succeeds:

```powershell
curl.exe -fsSL https://github.com/andreduejon/codepulse/releases/latest/download/install.ps1 -o "$env:TEMP/codepulse-install.ps1"
& "$env:TEMP/codepulse-install.ps1"
```

The installer detects native x64/ARM64 architecture, verifies SHA-256, and installs
to `%LOCALAPPDATA%\codepulse\bin`. It adds that folder to your user PATH and
current PowerShell session, so `codepulse` works immediately. Restart other open
terminals to pick up the change. Set `CODEPULSE_INSTALL_DIR` for a custom location
or `CODEPULSE_VERSION` for a specific release. Git for Windows must be on PATH.
Bun and Node.js are not required to run Codepulse.
If local policy blocks scripts, use the release ZIP rather than weakening policy.

Windows binaries are unsigned;
SmartScreen reputation warnings are possible. Checksums verify file integrity,
not publisher trust. Do not disable security protections for a malware detection.

### Configuration and cache

| Platform | Configuration | Provider cache root |
|----------|---------------|---------------------|
| macOS / Linux | `~/.config/codepulse/config.json` | `~/.cache/codepulse` |
| Windows | `%APPDATA%\codepulse\config.json` | `%LOCALAPPDATA%\codepulse\Cache` |

Settings are saved per repository. Menu → Repository → Configuration shows the
full config path; click it or press Enter to copy. Windows AppData locations
fall back to the corresponding folders under your home if environment variables
are absent. Earlier experimental Windows `.config`/`.cache` files are not migrated.

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
