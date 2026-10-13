# Themes

Codepulse supports predefined themes and separate custom themes. Custom themes
can inherit a predefined palette or provide a complete standalone definition.

## Choosing and inspecting themes

Open `:theme` to browse the Predefined and Custom sections.

## Predefined themes

| Name | ID |
|------|----|
| Catppuccin Mocha (default) | `catppuccin-mocha` |
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
| Olive Garden | `olive-garden` |

## Custom themes

Create `themes.json` beside the global `config.json`:

| Platform | File |
|----------|------|
| macOS / Linux | `~/.config/codepulse/themes.json` |
| Windows | `%APPDATA%\codepulse\themes.json` |

The file is a JSON object keyed by unique lowercase kebab-case IDs of at most
64 characters. Predefined IDs are reserved. Each entry has a nonempty printable
`name` of at most 64 characters, optional `base`, and a `colors` object.
A base must be a predefined ID. Custom-to-custom inheritance is not supported.

### Inheriting a predefined palette

```json
{
  "my-mocha": {
    "name": "My Mocha",
    "base": "catppuccin-mocha",
    "colors": {
      "accent": "#89b4fa",
      "graphColors": ["#89b4fa", "#a6e3a1", "#f9e2af"]
    }
  }
}
```

Omitted colors inherit from the base. Overrides use the exact configuration
keys below, not the user-friendly labels displayed in Details. Scalar colors must
be `#RRGGBB`. Loaded values are normalized to lowercase. `graphColors` must be
a nonempty array of these HEX values and replaces the whole base array rather
than merging individual entries. Unknown definition or color keys invalidate
the entry.

### Standalone definitions

Omit `base` to create an independent theme. Every color key below is then
required, including `graphColors`. Omitted values are not filled automatically.

```text
background, backgroundPanel, backgroundElement, backgroundElementActive,
foreground, foregroundMuted, border, primary, gitBg, accent,
info, error, warning, success,
severityCritical, severityHigh, severityMedium, severityLow,
graphColors, diffAdded, diffRemoved, diffAddedBg, diffRemovedBg,
githubActionsFg, githubActionsBg, jenkinsFg, jenkinsBg,
snykFg, snykBg, openShiftFg, openShiftBg
```

## Loading and diagnostics

Themes load at startup. Restart Codepulse after editing `themes.json`. Invalid
entries are skipped independently with diagnostics in `:debug`. A malformed
file does not break predefined themes. A missing or invalid selected custom
theme falls back to the default theme.

The dialog inspects colors but does not edit or export definitions.
