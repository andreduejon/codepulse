# Architecture

codepulse is a terminal app in Solid and OpenTUI on Bun, built as ports and adapters. Its logic lives in `src/core`,
plain TypeScript that knows nothing of Solid, the terminal, Bun or the outside world. Everything it needs from outside
comes in through ports: interfaces core declares. `src/adapters` implements them, `src/tui` is the terminal front end
on top of core, and the root (`src/main.tsx`, `src/ports.ts`) builds the adapters and hands them to the front end.

```mermaid
flowchart LR
  subgraph Root["Root: src/main.tsx, src/ports.ts"]
    Main["startupProps"]
  end
  subgraph TUI["src/tui: Solid + OpenTUI"]
    Components["components, providers' tabs and dialogs"]
    Hooks["hooks, app controllers"]
    Keys["keyboard dispatcher"]
    State["app state (Solid signals)"]
  end
  subgraph Core["src/core"]
    Services["services: Git data, details, path mode, Dashboard, GitHub, Jenkins, OpenShift, Snyk"]
    Commands["commands: graph navigation, highlights"]
    Model["model: Git, graph, provider runs and badges, settings, Dashboard events, app state's rules"]
    Ports["ports: AppPorts (Git, settings, cache store, system, Dashboard, providers' API, cache and token)"]
  end
  subgraph Adapters["src/adapters"]
    Git["git: the Git command line"]
    Http["github, jenkins, openshift: HTTP clients and caches"]
    Snyk["snyk: the Snyk CLI"]
    Cache["cache: SQLite"]
    Settings["settings: the settings and themes files"]
    System["system: browser, clipboard, environment, storage paths, restart"]
  end
  Main -- builds --> Adapters
  Main -- hands the ports to --> TUI
  Keys --> Hooks --> Commands & Services
  Components --> Hooks
  Hooks --> State
  Services & Commands --> Model
  Services -. through ports .-> Ports
  Adapters -. implement .-> Ports
```

## Layers

| Folder | What | May import |
|--------|------|------------|
| `src/core` | the app's logic and its ports: no Solid, OpenTUI, `node:*` or `bun:*` | core |
| `src/adapters` | what implements the ports | core, adapters |
| `src/tui` | the terminal front end | core, tui |
| root: `src/*.ts`, `src/cli` | builds the adapters, starts the front end | everything |

`src/layers.test.ts` resolves every import and fails on one that crosses into a layer its folder may not use. Biome
refuses the same by folder name as the import is written, and refuses Solid, OpenTUI and the runtime in core.

```
src/
  core/        model, services, commands, ports
    git/  github/  jenkins/  openshift/  snyk/  dashboard/  settings/
  adapters/    git/  github/  jenkins/  openshift/  snyk/  cache/  settings/  system/  dashboard/  http.ts
  tui/         app/  components/  context/  dashboard/  graph/  hooks/  keyboard/  providers/  utils/
  cli/         arguments and help
  main.tsx     startupProps: the ports, the settings, which screen to open
  ports.ts     the terminal app's adapters, in one place
```

## Ports

`AppPorts` (`core/app-ports.ts`) is every port the app runs on. `src/ports.ts` builds the terminal app's, `startupProps`
hands them to the app and registers them (`tui/context/ports.ts`) for a component rendered without them, as in a
test. A hook called while its component sets up takes a port as a parameter; a component below the root reads it from
its context (see the Solid rules in AGENTS.md). The adapters' port objects call their modules' functions when they run,
so a test's `spyOn` on such a function sees the app's calls.

| Port | Declared in | Implemented in | The UI reaches it through |
|------|-------------|----------------|---------------------------|
| `GitPort` | `core/git/port.ts` | `adapters/git/git-cli.ts` | hook parameters, `useGit()` |
| `SettingsPort` | `core/settings/port.ts` | `adapters/settings/settings-file.ts` | hook parameters, `useSettings()` |
| `CacheStorePort` | `core/cache-store.ts` | `adapters/cache/cache-store.ts` | hook parameters, `useCacheStore()` |
| `SystemPort` | `core/system.ts` | `adapters/system/system-port.ts` | hook parameters, `useSystem()` |
| `DashboardReader` | `core/dashboard/load.ts` | `src/ports.ts` over `adapters/dashboard/load.ts` | the Dashboard controller |
| a provider's adapters (API, cache, token) | `core/<provider>/service.ts` | `adapters/<provider>/adapters.ts` | the provider's module |
| the app's state, for a provider | `core/provider-ports.ts` | `tui/providers/shared/app-port.ts` | the provider's hook |

## Services

Each service is a plain function or class in core with its ports as parameters, tested without Solid; a hook in
`src/tui` adapts it: it runs the effects, makes the service's reads reactive and stops it on cleanup.

| Service | Core | Hook |
|---------|------|------|
| the graph's Git data: load, pages, fetch | `core/git/data-service.ts` | `tui/hooks/use-data-loader.ts` |
| the selected commit's details | `core/git/commit-detail.ts` | `tui/hooks/use-detail-loader.ts` |
| path mode | `core/git/path-filter.ts` | `tui/hooks/use-path-filter.ts` |
| the Dashboard's events | `core/dashboard/load.ts` | `tui/dashboard/use-dashboard.ts` |
| a provider's fetch lifecycle (when, how often, backoff) | `core/fetch-lifecycle.ts` | `tui/providers/shared/use-provider-fetch-lifecycle.ts` |
| GitHub, Jenkins, OpenShift, Snyk | `core/<provider>/service.ts` | `tui/providers/<provider>/use-*.ts` |
| which rows a long list mounts | `core/scroll-window.ts` | `tui/hooks/use-scroll-window.ts` |

## Providers

Each provider is a module (`tui/providers/<provider>/module.ts`) that meets one contract (`tui/providers/module.ts`):
`start` gets the app's state, its settings, its adapters and where its rows open, and returns the provider with what
every caller reads from it: its data for a commit, starting over, fetching again, the events it holds for the
Dashboard, and its detail tab's source. The provider host (`tui/app/providers.ts`) starts the modules and is the rest
of the app's one way to them.

## State and commands

The app's state is Solid signals in `tui/context/state.ts`: the repository, the graph, the cursor, the providers'
status and badges, and one detail slot each for the graph and the Dashboard. Its shape and rules are a port in core
(`core/app-state.ts`): which highlight wins, which commits a search matches, how far a cursor moves. What the app does
is core commands over that port: moving through the graph (`core/navigation.ts`) and turning highlights on and off
(`core/highlights.ts`). Core knows no terminal words: no characters, colors or column widths. It lays the graph out in
lanes and connectors (`core/git`) and sorts a status into passed, failed or running (`core/status.ts`); the terminal
draws them as box-drawing characters and ✓ ✗ ● (`tui/graph`, `tui/utils/status-icon.ts`) and sizes the columns. Focus, dialogs, the command bar and its `:` commands
(`tui/app/app-commands.ts`), and which step Esc takes back (`tui/keyboard/cascade.ts`) are the terminal's: its keys and
commands call the core commands and the services.

The app's root (`tui/app/app-content.tsx`) builds the state and the controllers and provides the contexts;
`tui/app/layout.tsx` draws the screens from them.

## Process-wide objects

The cache registry (`ProviderCacheRegistry`, `adapters/cache/sha-sqlite-cache.ts`) holds the open cache databases, one
per folder, and what belongs to each: the writes an eviction drops, the cache screen's pause, the listeners told about
a write. `terminalPorts({ cacheRoot, registry })` builds the providers' caches, the cache screen and the Dashboard on
one folder and one registry; the terminal app uses the process's (`providerCacheRegistry`). `src/ports.test.ts` checks
that ports built on a registry of their own write, evict and read through it alone.

The debug log (`debugLog`, `core/debug-events.ts`) is the process's: the adapters and services write to it directly,
so two apps in one process share it.
