# Agent Notes

## SolidJS Rules (prevent known bugs)

### 1. `createMemo` is eager — beware TDZ
- `createMemo` evaluates **immediately** on creation. `createEffect` is **deferred** (runs after component setup).
- A `createMemo` that references a `const` declared later in the component body hits the **Temporal Dead Zone** and throws a `ReferenceError`. SolidJS swallows this error silently, leaving the reactive system broken (app freezes).
- **Rule**: Every `createMemo` must appear **after** all `const` declarations it references. When refactoring `createEffect` to `createMemo`, check for forward references.

### 2. `batch()` is a no-op inside effects
- `batch()` calls `runUpdates(fn, false)` which checks `if (Updates) return fn()`. Inside an effect, `Updates` is already set, so `batch()` just calls `fn()` directly with no deferred behavior.
- **Rule**: Never rely on `batch()` inside `createEffect` to prevent intermediate reactive firings. Use mutable refs or restructure the reactive graph instead.

### 3. Signals are consumed on read — mutable refs persist
- Reading a signal inside an effect and then setting it to `null` means subsequent effect firings see `null`. A mutable ref (plain JS property on an object) persists across multiple effect firings within the same reactive cascade.
- **Rule**: When state must survive multiple effect firings in a single reactive flush, use a mutable ref (e.g., a property on a ref object) instead of a signal.

### 4. Effect re-tracking
- SolidJS effects re-track dependencies on each run. If an effect reads signal X on run 1 but signal Y on run 2, it only depends on signals from the latest run.
- **Rule**: Be aware that conditional branches in effects change the dependency set. An effect may stop reacting to a signal it read in a previous run.

### 5. Hooks called during setup cannot read their own component's Providers
- A component's JSX return (where `Context.Provider` lives) is rendered **after** the setup phase completes. Any hook called during setup that does `useContext()` for a Provider the same component owns will get `undefined` — the Provider hasn't been created yet.
- The failure is **silent**: no crash, no console error. The hook operates on `undefined` state, causing subtle breakage (e.g. terminal garbage strings leaking through before opentui's input parser attaches).
- When extracting inline code into a hook, the inline code used local variables directly. The extracted hook naturally reaches for `useContext()` — but that context isn't available at setup time.
- **Rule**: Hooks called during a component's setup phase must receive `state`/`actions` (or any context value) as **parameters**, not via `useContext()`. Only child components rendered *inside* the Provider's JSX subtree can safely call `useContext()`.