# Agent Notes

## Critical Bug Fix: Dialog Freeze (2026-03-27)

### Symptom
Pressing `m` (menu) or `?` (help) froze the app completely. Graph rendered fine, arrow keys worked, search worked — but opening any dialog caused a total freeze.

### Root Cause
**`createMemo` evaluates eagerly (immediately on creation), while `createEffect` defers.**

In `menu-dialog.tsx`, the `bannerOverflow` memo was placed at ~line 98 but referenced `selectedItemIndex()` (line 361) and `activeItems()` (line 338) — both `const` arrow functions not yet initialized at that point in the component function body.

The memo hit the **JavaScript Temporal Dead Zone (TDZ)**, threw a `ReferenceError`, which was swallowed by SolidJS, leaving the reactive system in a broken state. This caused the entire app to freeze on any subsequent dialog render (including unrelated dialogs like the help dialog).

### Why the old code worked
The original inline banner code used `createEffect` (which **defers** execution until after all synchronous component setup completes). By the time the effect ran, `selectedItemIndex` and `activeItems` were fully initialized. The refactor to `createMemo` (for use with the `useBannerScroll` hook) changed this to **eager** evaluation, triggering the TDZ.

### Fix
Move the `bannerOverflow` memo + `useBannerScroll()` call to **after** `selectedItemIndex` and `activeItems` are defined in the component body.

### Key SolidJS lesson
- `createEffect` — **deferred**: runs after component setup completes
- `createMemo` — **eager**: evaluates immediately on creation
- When refactoring from `createEffect` to `createMemo`, forward references to `const` declarations that worked in effects will cause TDZ errors in memos

### Bisect results
- Introduced by commit `f9b7267` (refactor: extract shared banner scroll hook)
- Isolated via binary search across 7 commits between `develop` and `cleanup/code-quality-review`
- Further narrowed by selective reverts: detail.tsx changes were innocent, menu-dialog.tsx `bannerOverflow` memo placement was the culprit

### Files involved
- `src/components/dialogs/menu-dialog.tsx` — the buggy memo placement (fixed)
- `src/hooks/use-banner-scroll.ts` — shared hook (innocent)
- `src/components/detail.tsx` — also uses `useBannerScroll` but had no TDZ issue (its memo references are all defined earlier in the component)
