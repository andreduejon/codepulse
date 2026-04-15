# codepulse

A read-only terminal git graph visualizer. Navigate your repository history, inspect commits, view diffs with blame, and browse branches — all from the terminal.

Built with [Bun](https://bun.sh), [SolidJS](https://solidjs.com), and [@opentui/solid](https://github.com/anomalyco/opentui).

## Vision

codepulse starts as a git-first terminal UI and is planned to grow into a read-only
codebase dashboard: git history as the primary navigation surface, with CI/CD,
security, and code quality signals layered onto the same commit and branch context.

The current release is focused on the git experience. Integration planning for future
milestones lives in `.planning/` locally and is summarized in the roadmap below.

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
codepulse [options] [path]
```

If no path is given, the current directory is used.

## Options

| Flag | Description |
|------|-------------|
| `-b, --branch <name>` | Show only a specific branch |
| `-n, --max-count <n>` | Maximum number of commits to show (default: 500) |
| `--theme <name>` | Color theme (see [Themes](#themes) below) |
| `--no-all` | Don't show all branches |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Keyboard Shortcuts

### Graph

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate commits |
| `Shift+↑` / `Shift+↓` | Jump 10 commits |
| `PgUp` / `PgDn` | Jump 20 commits |
| `g` / `G` | First / last commit |
| `Enter` / `→` | Focus detail panel |
| `←` / `Esc` / `q` | Back |
| `/` | Search commits |
| `f` | Fetch from remote |
| `R` | Reload |
| `m` | Menu (repository, branches) |
| `:theme` | Change theme |
| `?` | Show help |

### Detail panel

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate items |
| `Tab` | Switch tabs (Files / Stashes / Details) |
| `Enter` | Open diff+blame for selected file |
| `←` / `Esc` / `q` | Return to graph |

### Diff+blame dialog

| Key | Action |
|-----|--------|
| `↑` / `↓` | Scroll diff |
| `←` / `→` | Navigate files |
| `b` | Toggle blame column |
| `d` / `u` / `s` | Diff / unified / split view |
| `Esc` / `q` | Close |

## Themes

Pass the theme name via `--theme <name>` or switch live with `:theme`.

| Name | `--theme` value |
|------|----------------|
| Catppuccin Mocha *(default)* | `catppuccin-mocha` |
| OpenCode Original | `open-code-original` |
| Tokyo Night | `tokyo-night` |
| Dracula | `dracula` |
| Nord | `nord` |
| One Dark Pro | `one-dark` |
| Gruvbox Dark | `gruvbox` |
| Monokai Pro | `monokai` |
| Ayu Mirage | `ayu-mirage` |
| Synthwave '84 | `synthwave` |
| Rosé Pine | `rose-pine` |

## Roadmap

Planned milestones currently follow this shape:

- `0.1.0`: config file support, richer search, lazy commit loading, and core UX polish
- `0.2.0`: graph power features such as ancestry workflows and path-aware history views
- `0.3.0+`: read-only integrations for GitHub Actions, Jenkins, Snyk, and SonarQube

The intent is to reach `1.0.0` once the integration model and configuration surface are
stable.

## License

[MIT](LICENSE) © andreduejon
