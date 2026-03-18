# Graph Engine Fixes & Comprehensive Tests

## Phase 1: Bug Fixes (graph.ts)

### B1 — Fix renderFanOutRow else-if priority (MEDIUM)
**File:** `src/git/graph.ts` ~L847-884
**Problem:** `cornerBR` and `cornerBL` checks come AFTER standalone `horizontal` in the else-if chain. When both `cornerBR` and `horizontal` exist at the same column (a corner+horizontal crossing), `horizontal` matches first → renders `──` instead of junction `┴─`.
**Fix:** Reorder the chain to: `teeLeft → teeRight → straight && horizontal → cornerBR → cornerBL → straight → horizontal → empty`. This matches `renderGraphRow` where corners are checked before standalone horizontal/straight.

### B2 — Fix secondary parent merge connector remoteOnly (MEDIUM)
**File:** `src/git/graph.ts` L587, L593
**Problem:** These lines pass `pRemoteOnly` to `addSpanningConnectors`, but new-lane case (L612) uses `pLaneROValue = isCommitRemoteOnly || pRemoteOnly`. Inconsistent — remote-only commit merging non-remote-only parent via existing lane won't dim the horizontals.
**Fix:** Compute `pLaneROValue` at top of loop iteration (before if/else), use it in all three branches (L587, L593, L612).

### B3 — Add bold to straight connectors in renderGraphRow (LOW)
**File:** `src/git/graph.ts` L1103
**Problem:** `renderConnectorRow` and `renderFanOutRow` both set `bold: isBold` on straight connectors. `renderGraphRow` omits it — straight lines on commit rows won't be bold when focused.
**Fix:** Add `const isBold = !opts.focusMode || !!straight.isFocused;` and pass `bold: isBold` at L1103.

### B4 — Fix unused loop variable in renderGraphRow (LOW)
**File:** `src/git/graph.ts` L923-925
**Problem:** `for (const c of row.columns) { maxCol = Math.max(maxCol, row.columns.length); }` — `c` unused, same value computed N times.
**Fix:** Replace with single statement: `maxCol = Math.max(maxCol, row.columns.length);`

### B5 — Add fanOutRows to post-pass dimming (LOW)
**File:** `src/git/graph.ts` L662-672
**Problem:** Post-pass dimming iterates `row.connectors` and `row.columns` but skips `row.fanOutRows`.
**Fix:** After column loop, add: `if (row.fanOutRows) { for (const foRow of row.fanOutRows) { for (const conn of foRow) { conn.isRemoteOnly = true; } } }`

---

## Phase 2: Code Cleanup

### Q1 — Remove unused connector types
**File:** `src/git/types.ts` L76-79
Remove `merge-left`, `merge-right`, `branch-left`, `branch-right` from `ConnectorType` union.

### Q2 — Add duplication comment for connColor
**File:** `src/git/graph.ts` L794 and L910
Add comment noting the duplication: `// NOTE: duplicated in renderFanOutRow/renderGraphRow — keep in sync`

---

## Phase 3: New test file — scripts/test-graph-structure.ts

Comprehensive structural tests using same assertion pattern as test-focus-mode.ts.

### Test 1: Remote-only lane propagation (single parent)
- origin/feature (remote-only) → f1 → parent d1 (develop)
- Assert lane connectors/columns from f1 to d1 have isRemoteOnly=true
- Assert d1's row has isRemoteOnly=false

### Test 2: Remote-only lane propagation (merge first parent)
- origin/feature merges develop as first parent
- Assert lane stays isRemoteOnly=true down to develop

### Test 3: Remote-only merge connectors (secondary parent existing lane)
- Remote-only merge commit has secondary parent with existing lane
- Assert spanning connectors have isRemoteOnly=true (consistent with B2 fix)

### Test 4: Fan-out connector types
- Two branches from same parent d1
- Assert fan-out rows have corner-bottom-right/left (not top corners)
- Assert tee direction correct at parent column
- Assert crossings have both straight + horizontal

### Test 5: Fan-out remote-only flags
- Remote-only branch closes via fan-out into non-remote-only parent
- Assert fan-out corner connectors isRemoteOnly=true
- Assert non-remote-only lane straight connector isRemoteOnly=false

### Test 6: Octopus merge (3 parents)
- Merge commit with 3 parents
- Assert no crash, all parents get lanes, spanning connectors for each

### Test 7: Single-commit repo
- One commit, no parents
- Assert one row, nodeColumn=0, only node connector

### Test 8: Lane reuse
- feat-A merges (frees lane), feat-B starts later
- Assert feat-B reuses feat-A's freed column

### Test 9: Multiple refs on same commit
- develop, origin/develop, origin/HEAD all on same commit
- Assert no duplicate lanes, single nodeColumn

### Test 10: Column stability (no jumping)
- Key scenarios from diagnose-columns converted to assertions
- Assert each branch's commits all use same column index

### Test 11: Post-pass dimming includes fan-out rows
- Remote-only commit at top with fan-out, then non-remote-only commit
- Assert all fan-out connectors in dimmed rows have isRemoteOnly=true

---

## Phase 4: Enhance existing tests

### diagnose-columns.ts — add assertions
- Exit with code 1 when column jumping detected
- Add pass/fail counter and summary

### test-focus-mode.ts — add focus + remote-only test
- Test 6: focused develop + remote-only origin/renovate/foo
- Assert remote-only connectors get dimColor, focused lane gets focusBranchColor

---

## Execution Order
1. Bug fixes B1-B5
2. Code cleanup Q1-Q2
3. Create scripts/test-graph-structure.ts
4. Enhance diagnose-columns.ts and test-focus-mode.ts
5. Build check
6. Run all test scripts
7. Fix any failures
8. Visual verification
