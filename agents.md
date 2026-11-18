# Agent Notes

## SolidJS Rules (prevent known bugs)

### 1. `createMemo` is eager — beware Temporal Dead Zone (TDZ)

- `createMemo` evaluates **immediately** on creation. `createEffect` is
  **deferred** (runs after component setup).
- A `createMemo` that references a `const` declared later in the component body
  hits the **Temporal Dead Zone** and throws a `ReferenceError`. SolidJS swallows
  this error silently, leaving the reactive system broken (app freezes).
- **Rule**: Every `createMemo` must appear **after** all `const` declarations it
  references. When refactoring `createEffect` to `createMemo`, check for forward
  references.

### 2. `batch()` is a no-op inside effects

- `batch()` calls `runUpdates(fn, false)` which checks `if (Updates)
  return fn()`. Inside an effect, `Updates` is already set, so `batch()` just
  calls `fn()` directly with no deferred behavior.
- **Rule**: Never rely on `batch()` inside `createEffect` to prevent intermediate
  reactive firings. Use mutable refs or restructure the reactive graph instead.

### 3. Signals are consumed on read — mutable refs persist

- Reading a signal inside an effect and then setting it to `null` means
  subsequent effect firings see `null`. A mutable ref (plain JS property
  on an object) persists across multiple effect firings within the same
  reactive cascade.
- **Rule**: When state must survive multiple effect firings in a single reactive
  flush, use a mutable ref (e.g., a property on a ref object) instead of a signal.

### 4. Effect re-tracking

- SolidJS effects re-track dependencies on each run. If an effect reads signal X
  on run 1 but signal Y on run 2, it only depends on signals from the latest run.
- **Rule**: Be aware that conditional branches in effects change the dependency
  set. An effect may stop reacting to a signal it read in a previous run.

### 5. Hooks called during setup cannot read their own component's Providers

- A component's JSX return (where `Context.Provider` lives) is rendered **after**
  the setup phase completes. Any hook called during setup that does
  `useContext()` for a Provider the same component owns will get `undefined`
  — the Provider hasn't been created yet.
- The failure is **silent**: no crash, no console error. The hook operates on
  `undefined` state, causing subtle breakage (e.g. terminal garbage strings
  leaking through before opentui's input parser attaches).
- When extracting inline code into a hook, the inline code used local variables
  directly. The extracted hook naturally reaches for `useContext()` — but that
  context isn't available at setup time.
- **Rule**: Hooks called during a component's setup phase must receive `state`/
  `actions` (or any context value) as **parameters**, not via `useContext()`.
  Only child components rendered *inside* the Provider's JSX subtree can safely
  call `useContext()`.

## Layers

`src` has four layers, one folder each ([docs/architecture.md](docs/architecture.md) has the details):

| Folder | What | May import |
|--------|------|------------|
| `src/core` | the app's logic and its ports: plain TypeScript, no Solid, OpenTUI, Bun or Node runtime APIs | core |
| `src/adapters` | what implements the ports: Git, HTTP, the SQLite cache, the settings file, the system | core, adapters |
| `src/tui` | the terminal front end: Solid and OpenTUI | core, tui |
| root: `src/*.ts`, `src/cli` | `main.tsx`, `ports.ts`: builds the adapters and hands them to the front end | everything |

`src/layers.test.ts` checks every import against this table, and the linter refuses the same by folder name. What core
needs from outside (Git, requests, the app's state, the time) comes in through its ports, so it runs in a plain test;
a Solid hook in `src/tui` adapts a core service (`core/git/data-service.ts` and `tui/hooks/use-data-loader.ts`). New
logic that doesn't draw goes in `src/core`; a new way to reach the outside is a port in core and an adapter in
`src/adapters`, built in `src/ports.ts`. A new provider is its own files in each layer (a definition in core, its
adapters, its terminal module), listed once in `src/providers.ts`; no other file names it.

## Keys

Every key handler goes through `src/tui/keyboard/dispatcher.ts`, never OpenTUI's `useKeyboard` (the linter refuses it in
`src`). The newest handler sees a key first. A dialog or a screen uses `useModalKeys`: nothing beneath it, the app's
keys included, sees a key while it is open, so it handles Esc itself. Other handlers use `useKeys` and can keep one key
from those below with `stopPropagation()`. A handler removed while a key is handled never sees that key.

## Checking UI changes

Check a UI change in the demo before calling it done: `bun run demo` runs codepulse on made-up data, and `--play`
runs it headless and prints the screens as text. See [docs/demo.md](docs/demo.md) for every option and step.

```sh
bun run demo --play 'j j enter tab wait:"CI #812" shot'      # the screen after those keys
bun run demo --github error:401 --play 'tab sleep:500 shot'  # a provider failing
bun run demo --colors --play 'click:Dashboard sleep:2000 shot' # each color named: «severityHigh:3 high»
bun run demo --play "$(cat play.txt)" > after.txt            # the same play prints the same screens: diff it
bun run demo:golden                                          # the kept screens: a refactoring changes none
```

- A play that fails prints the step, why and the screen, and exits with 1.
- `bun run demo:golden` must pass after a refactoring. After a UI change, `bun run demo:golden --update` writes the
  new screens; check their diff shows only the intended change.
- When a state you need is missing, add it to `scripts/demo/scenario.ts` (or `packages.ts`) instead of testing
  against a real server.

## Checking performance

`bun run bench --compare` measures speed and memory on large generated repositories and prints each number beside
the baseline's (see [docs/bench.md](docs/bench.md)). Run it before and after a change that touches loading,
rendering, caches or memory. Compare on the same machine only.
