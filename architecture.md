# CodePulse Architecture

## High-Level Architecture

```mermaid
flowchart TD
    Entry["Entry\n<small>index.tsx &rarr; main.tsx</small>"]
    CLI["CLI\n<small>parse-args, help</small>"]
    App["App\n<small>app.tsx, config, search, constants</small>"]
    Context["Context / State\n<small>state, theme, theme-definitions</small>"]
    Hooks["Hooks\n<small>9 use-*.ts modules</small>"]
    Components["Components\n<small>graph, detail, footer, etc.</small>"]
    Dialogs["Dialogs\n<small>diff/blame, menu, help, theme</small>"]
    Git["Git Layer\n<small>repo, diff, status, graph algo, types</small>"]
    Utils["Utils\n<small>date, scroll, cursor, file-tree</small>"]

    Entry --> CLI
    Entry --> App
    App --> Context
    App --> Hooks
    App --> Components
    App --> Dialogs
    Context --> Git
    Hooks --> Context
    Hooks --> Git
    Hooks --> Utils
    Components --> Context
    Components --> Hooks
    Components --> Git
    Components --> Utils
    Dialogs --> Context
    Dialogs --> Hooks
    Dialogs --> Git
    Dialogs --> Utils

    classDef entry fill:#4a9eff,color:#fff,stroke:#2670c4
    classDef cli fill:#6a9fd8,color:#fff,stroke:#4a7db0
    classDef app fill:#7c5cbf,color:#fff,stroke:#5a3d94
    classDef ctx fill:#e07b39,color:#fff,stroke:#b85e24
    classDef hook fill:#3db88c,color:#fff,stroke:#2a8c66
    classDef comp fill:#d94f7a,color:#fff,stroke:#b33560
    classDef dlg fill:#c44d9e,color:#fff,stroke:#9c3580
    classDef git fill:#5882a8,color:#fff,stroke:#3e6585
    classDef util fill:#8a8a8a,color:#fff,stroke:#666

    class Entry entry
    class CLI cli
    class App app
    class Context ctx
    class Hooks hook
    class Components comp
    class Dialogs dlg
    class Git git
    class Utils util
```

## Layer Summary

| Layer | Files | Role |
|-------|-------|------|
| **Entry** | `index.tsx`, `main.tsx` | Shebang entry, CLI bootstrap, config loading, render |
| **CLI** | `parse-args.ts`, `help.ts` | Argument parsing and `--help` output |
| **App** | `app.tsx`, `config.ts`, `search.ts`, `constants.ts` | Root component orchestration, config I/O, search engine |
| **Context** | `state.ts`, `theme.ts`, `theme-definitions.ts` | SolidJS reactive state and 11 color themes |
| **Hooks** | 9 `use-*.ts` files | Extracted logic: data fetching, keyboard nav, clipboard, etc. |
| **Components** | 9 component files | UI: graph table, detail panel, footer, file tree entries |
| **Dialogs** | 5 dialog files | Overlay UI: diff/blame viewer, menus, help, theme picker |
| **Git** | 10 files | Pure TS git operations: log, diff, blame, graph layout, status |
| **Utils** | 6 utility files | Pure functions: date formatting, scrolling, cursor math |

## Key Observations

- **Clean layering** -- the Git layer has zero UI/framework imports; it is a pure TypeScript data layer.
- **`git/types.ts`** is the most-imported file (~20 importers), acting as the shared vocabulary.
- **`app.tsx`** is the main orchestrator with 18+ internal imports spanning every layer.
- **Components never import other components' hooks** -- hooks are injected from the app level or consumed locally.
- **No circular dependencies** between layers. Data flows top-down: Entry -> App -> Context/Hooks -> Components -> Git/Utils.
