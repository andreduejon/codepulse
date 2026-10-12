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
| `f` | Fetch from remote |
| `?` | Open help dialog |
| `q` | Quit |

### Graph

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate commits |
| `shift + ↑` / `shift + ↓` | Jump 10 commits |
| `g` / `G` | First / last commit |
| `→` / `l` | Focus detail panel |
| `enter` | Focus details / open compact dialog |
| `a` | Enter ancestry mode |
| `p` | Enter path mode |
| `shift + ←` / `shift + →` | Switch project within the current group |

Search (`/`) and path filtering (`p`) apply on Enter. Esc cancels without
changing the current filter. Badge clicks offer the same filtering controls.
Normal clears highlighting without changing branch perspective.

### Commit details

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate items |
| `shift + ↑` / `shift + ↓` | Jump 10 items |
| `←` / `h` | Previous tab / exit details on the first tab |
| `→` / `l` | Next tab |
| `g` / `G` | Top / bottom |
| `enter` | Activate selected item |

Theme controls and custom configuration are in the [theme guide](themes.md).

## Commands

| Command | Description |
|---------|-------------|
| `:ancestry` | Highlight ancestry for the selected commit |
| `:branches` | Open menu dialog on Branches tab |
| `:clear` | Dismiss the current status message |
| `:debug` | Toggle debug dialog |
| `:fetch` | Fetch from remote |
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

## Installation options

The installers download a native standalone binary and verify its SHA-256
checksum. Bun and Node.js are not required. Git must be on PATH (Git for Windows
on Windows). The terminal must be at least 90 columns × 30 rows. Supported
targets are macOS, glibc Linux, and Windows 11 on x64/ARM64. Windows requires
Windows Terminal. Musl-based Linux such as Alpine is unsupported.

Installer commands use `curl` and `sh` on macOS/Linux, or `curl.exe` and
PowerShell on Windows. Use `curl.exe` explicitly because Windows PowerShell can
treat `curl` as an alias for `Invoke-WebRequest`. Run the downloaded script only
after the download succeeds. A failed download can leave an older installer at
that path. PowerShell remains necessary to execute `install.ps1`.

- `CODEPULSE_INSTALL_DIR` overrides the installation folder. Ensure it is on PATH.
- `CODEPULSE_VERSION` selects a specific release instead of the latest version.
- Default folders are `~/.local/bin` on macOS/Linux and
  `%LOCALAPPDATA%\codepulse\bin` on Windows. Open a new terminal after updating PATH.

Archives are available for manual installation from
[GitHub Releases](https://github.com/andreduejon/codepulse/releases).
If local policy blocks PowerShell scripts, use the release ZIP rather than
weakening policy.

Windows binaries are unsigned. SmartScreen reputation warnings are possible.
Checksums verify integrity, not publisher trust. Do not disable security
protections for a malware detection.

Maintainers can follow the [release process](RELEASING.md).
