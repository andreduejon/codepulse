# Themes

Codepulse supports predefined themes and separate custom themes. Custom themes
can inherit a predefined palette or provide a complete standalone definition.

## Choosing and inspecting themes

Open `:theme` to browse the Predefined and Custom sections.

| Control | Action |
|---------|--------|
| ↑/↓ | Preview a theme without saving |
| Shift + ↑/↓ | Jump 10 themes or scroll 10 color rows in Details |
| Enter / Select / theme click | Apply and save without closing |
| Esc / Close | Dismiss, retain the last saved theme, discard unsaved preview |
| d / Details hint | Switch between the theme list and Details |
| ↑/↓, PgUp/PgDn, mouse wheel in Details | Scroll colors |

Hovering highlights rows without changing the preview. Selections are saved per
repository in `config.json`.

Details show the theme ID, color swatches, and selectable HEX values. Custom
themes also show their base name and ID, such as `Nord (nord)`, or
`none (standalone)`. Predefined IDs can be copied for use in a custom theme's
`base` field.

- A tick inside the signature-color swatch marks the applied theme. A solid
  block shows the signature color of a previewed or hovered theme.
- In Details, `*` after a derived theme's name means it explicitly overrides a
  base color.
  It remains after saving and is not an unsaved-change indicator.
- In Details, overridden fields and graph colors have `*` and show
  **base → effective HEX**. Inherited colors show only the effective value.
- Explicit overrides are marked even when their value equals the base.
  Standalone definitions have no base and no override markers.

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
theme falls back to Catppuccin Mocha.

The dialog inspects colors but does not edit or export definitions.
