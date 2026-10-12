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

## Prerequisites

- Git installed and available on `PATH` (Git for Windows on Windows).
- An interactive terminal at least **90 columns × 30 rows**.

| Operating system | Architectures | Terminal |
|------------------|---------------|----------|
| macOS | x64, ARM64 | Terminal emulator |
| Linux (glibc) | x64, ARM64 | Terminal emulator |
| Windows 11 | x64, ARM64 | Windows Terminal |

Release binaries are standalone. Bun and Node.js are not required.
Musl-based Linux distributions such as Alpine are not supported.

## Install

Installer commands require `curl` and `sh` on macOS/Linux, or `curl.exe` and
PowerShell on Windows. Manual release archives are also available.

### macOS / Linux

```sh
curl -fsSL https://github.com/andreduejon/codepulse/releases/latest/download/install.sh | sh
```

The installer downloads the binary for your platform, verifies its SHA-256
checksum, and installs `codepulse` to `~/.local/bin`.

### Windows

Download the installer in PowerShell, then run it after the download succeeds:

```powershell
curl.exe -fsSL https://github.com/andreduejon/codepulse/releases/latest/download/install.ps1 -o "$env:TEMP/codepulse-install.ps1"
& "$env:TEMP/codepulse-install.ps1"
```

The installer detects native x64/ARM64 architecture, verifies SHA-256, and installs
to `%LOCALAPPDATA%\codepulse\bin`. Add that folder to your user PATH, then open
a new terminal to use `codepulse` from any directory.
If local policy blocks scripts, use the release ZIP rather than weakening policy.

Windows binaries are unsigned.
SmartScreen reputation warnings are possible. Checksums verify file integrity,
not publisher trust. Do not disable security protections for a malware detection.

See [installation options](docs/usage.md#installation-options) for custom
locations, specific versions, and manual installation.

## Usage

```sh
codepulse [path]
```

If no path is given, the current directory is used.

Navigate commits with `↑`/`↓` or `j`/`k`, inspect details with `→`, and press `?`
for help. Use `codepulse --help` for CLI help or `--version` for the version.

Settings are saved per repository. Remote fetching is manual by default.
See the [usage guide](docs/usage.md) for shortcuts, commands, configuration,
and refresh behavior.

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

Choose from 12 predefined themes or create custom themes by extending a built-in
palette or defining every color independently. Preview themes live with `:theme`
and save selections per repository. Built-in themes remain unchanged.

See the [theme guide](docs/themes.md) for controls, available themes, and custom
configuration examples.

## Roadmap

Codepulse is working toward `1.0.0` by stabilizing provider behavior,
configuration, cache semantics, and cross-platform distribution. See the
[changelog](CHANGELOG.md) for completed releases.

## License

[MIT](LICENSE) © andreduejon
