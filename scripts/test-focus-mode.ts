#!/usr/bin/env bun
/**
 * Test script: verifies focus mode graph rendering.
 *
 * In focus mode, only the focused branch's lane verticals (│) and node dots (●)
 * should use the focus color. All spanning connectors (horizontals ──, corners ╭╮╯╰,
 * trailing dashes after corners, and tee connectors) must be dimmed.
 *
 * This script:
 * 1. Builds synthetic graphs with merges/branches
 * 2. Renders them in focus mode with known colors
 * 3. Asserts that only expected characters use the focus color
 * 4. Asserts consistent character width (2 chars per column) for alignment
 */

import { buildGraph, renderGraphRow, renderConnectorRow, type GraphChar } from "../src/git/graph";
import type { Commit } from "../src/git/types";

const FOCUS_COLOR = "#ff0000";
const DIM_COLOR = "#555555";
const THEME_COLORS = [
  "#c0c001", "#c0c002", "#c0c003", "#c0c004",
  "#c0c005", "#c0c006", "#c0c007", "#c0c008",
  "#c0c009", "#c0c010", "#c0c011", "#c0c012",
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    console.error(`  FAIL: ${message}`);
  }
}

function makeCommit(
  hash: string,
  parents: string[],
  refs: { name: string; type: "branch" | "tag" | "remote" | "head"; isCurrent: boolean }[] = [],
  subject = `commit ${hash}`,
): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    message: subject,
    subject,
    body: "",
    author: "test",
    authorEmail: "test@test.com",
    authorDate: new Date().toISOString(),
    refs,
  };
}

/**
 * Get total character width of a GraphChar array.
 */
function totalCharWidth(chars: GraphChar[]): number {
  return chars.reduce((sum, gc) => sum + gc.char.length, 0);
}

/**
 * Find all GraphChar entries that use the focus color.
 */
function focusedChars(chars: GraphChar[]): { char: string; index: number }[] {
  return chars
    .map((gc, i) => ({ char: gc.char, color: gc.color, index: i }))
    .filter((gc) => gc.color === FOCUS_COLOR);
}

/**
 * Render options for focus mode testing.
 */
function focusOpts(isNodeFocused: boolean, padToColumns: number) {
  return {
    themeColors: THEME_COLORS,
    focusMode: true,
    dimColor: DIM_COLOR,
    focusBranchColor: FOCUS_COLOR,
    isNodeFocused,
    padToColumns,
  };
}

// ============================================================
// Test 1: Simple merge — develop merges feature branch
// ============================================================
function test1() {
  console.log("\nTest 1: Simple merge (develop + one feature)");

  const commits: Commit[] = [
    makeCommit("d3", ["merge1"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("merge1", ["d2", "f1"], [], "Merge feature"),
    makeCommit("f1", ["d1"], [{ name: "feature", type: "branch", isCurrent: false }], "feature work"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  const padCols = Math.max(...rows.map((r) => r.columns.length), ...rows.map((r) => Math.max(...r.connectors.map((c) => c.column + 1))));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isOnCurrent = row.isOnCurrentBranch;
    const chars = renderGraphRow(row, focusOpts(isOnCurrent, padCols));
    const connChars = renderConnectorRow(row, focusOpts(isOnCurrent, padCols));

    // Check width consistency: should always be padCols * 2 characters
    const commitWidth = totalCharWidth(chars);
    assert(
      commitWidth === padCols * 2,
      `Row ${i} ("${row.commit.subject}"): commit row width=${commitWidth}, expected ${padCols * 2}`,
    );

    const connWidth = totalCharWidth(connChars);
    assert(
      connWidth === padCols * 2,
      `Row ${i} ("${row.commit.subject}"): connector row width=${connWidth}, expected ${padCols * 2}`,
    );

    // Check focus color usage
    const focused = focusedChars(chars);
    for (const fc of focused) {
      // Only ● and │ should be in focus color (on focused branch rows)
      // The ─ after ● on merge rows should NOT be focus-colored
      const allowed = fc.char === "●" || fc.char === "● " || fc.char === "│ " || fc.char === "│";
      assert(
        allowed,
        `Row ${i} ("${row.commit.subject}"): unexpected focus-colored char "${fc.char}" at index ${fc.index}`,
      );
    }

    // Non-focused rows should NOT have focus-colored dots (● or ● ),
    // but CAN have focus-colored verticals (│) from the focused lane passing through.
    if (!isOnCurrent) {
      const focusedDots = focused.filter((fc) => fc.char === "●" || fc.char === "● ");
      assert(
        focusedDots.length === 0,
        `Row ${i} ("${row.commit.subject}"): non-focused row has ${focusedDots.length} focus-colored dot(s)`,
      );
    }

    // Connector row: only focused lane verticals should be in focus color
    const connFocused = focusedChars(connChars);
    for (const fc of connFocused) {
      const allowed = fc.char === "│ " || fc.char === "│";
      assert(
        allowed,
        `Row ${i} ("${row.commit.subject}"): connector row has unexpected focus-colored char "${fc.char}" at index ${fc.index}`,
      );
    }
  }
}

// ============================================================
// Test 2: Wide merge — develop merges feature across 3+ columns
// ============================================================
function test2() {
  console.log("\nTest 2: Wide merge (3 columns apart)");

  // develop at col 0, two side branches at col 1 and 2
  // develop merges the branch at col 2, spanning horizontal across col 1
  const commits: Commit[] = [
    makeCommit("d4", ["merge2"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("merge2", ["d3", "b1"], [], "Merge branch-B"),
    makeCommit("b1", ["d1"], [{ name: "branch-B", type: "branch", isCurrent: false }], "branch-B work"),
    makeCommit("d3", ["merge1"], [], "develop after merge1"),
    makeCommit("merge1", ["d2", "a1"], [], "Merge branch-A"),
    makeCommit("a1", ["d1"], [{ name: "branch-A", type: "branch", isCurrent: false }], "branch-A work"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  const padCols = Math.max(...rows.map((r) => r.columns.length), ...rows.map((r) => Math.max(...r.connectors.map((c) => c.column + 1))));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isOnCurrent = row.isOnCurrentBranch;
    const chars = renderGraphRow(row, focusOpts(isOnCurrent, padCols));

    // Width check
    const width = totalCharWidth(chars);
    assert(
      width === padCols * 2,
      `Row ${i} ("${row.commit.subject}"): width=${width}, expected ${padCols * 2}`,
    );

    // Focus color: only ● and │ allowed
    const focused = focusedChars(chars);
    for (const fc of focused) {
      const allowed = fc.char === "●" || fc.char === "● " || fc.char === "│ " || fc.char === "│";
      assert(
        allowed,
        `Row ${i} ("${row.commit.subject}"): unexpected focus-colored "${fc.char}" at index ${fc.index}`,
      );
    }

    // Check specifically for horizontal connectors NOT being focus-colored
    for (const gc of chars) {
      if (gc.char === "──" || gc.char === "─") {
        assert(
          gc.color !== FOCUS_COLOR,
          `Row ${i} ("${row.commit.subject}"): horizontal dash "${gc.char}" is focus-colored — should be dimmed`,
        );
      }
    }
  }
}

// ============================================================
// Test 3: Branch-off from focused branch — feature branches from develop
// ============================================================
function test3() {
  console.log("\nTest 3: Branch-off (feature branches from focused develop)");

  const commits: Commit[] = [
    makeCommit("d3", ["d2"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("f2", ["f1"], [{ name: "feature", type: "branch", isCurrent: false }], "feature tip"),
    makeCommit("f1", ["d1"], [], "feature work"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  const padCols = Math.max(...rows.map((r) => r.columns.length), ...rows.map((r) => Math.max(...r.connectors.map((c) => c.column + 1))));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isOnCurrent = row.isOnCurrentBranch;
    const chars = renderGraphRow(row, focusOpts(isOnCurrent, padCols));
    const connChars = renderConnectorRow(row, focusOpts(isOnCurrent, padCols));

    // Width consistency
    assert(
      totalCharWidth(chars) === padCols * 2,
      `Row ${i}: commit row width=${totalCharWidth(chars)}, expected ${padCols * 2}`,
    );
    assert(
      totalCharWidth(connChars) === padCols * 2,
      `Row ${i}: connector row width=${totalCharWidth(connChars)}, expected ${padCols * 2}`,
    );

    // No corners/dashes should be focus-colored
    for (const gc of chars) {
      if (gc.color === FOCUS_COLOR) {
        const allowed = gc.char === "●" || gc.char === "● " || gc.char === "│ " || gc.char === "│";
        assert(
          allowed,
          `Row ${i} ("${row.commit.subject}"): focus-colored "${gc.char}" — only ● and │ allowed`,
        );
      }
    }
  }
}

// ============================================================
// Test 4: Merge back — side branch closing into focused lane
// This is the specific case where ╭ at the focused lane column
// had a trailing ─ picking up the focus color.
// ============================================================
function test4() {
  console.log("\nTest 4: Merge back (side branch closing into focused lane)");

  // renovate-style: side branches merge back one by one
  const commits: Commit[] = [
    makeCommit("d3", ["m2"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("m2", ["m1", "r2"], [], "Merge renovate/b"),
    makeCommit("r2", ["d1"], [{ name: "origin/renovate/b", type: "remote", isCurrent: false }], "renovate/b"),
    makeCommit("m1", ["d1", "r1"], [], "Merge renovate/a"),
    makeCommit("r1", ["d1"], [{ name: "origin/renovate/a", type: "remote", isCurrent: false }], "renovate/a"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  const padCols = Math.max(...rows.map((r) => r.columns.length), ...rows.map((r) => Math.max(...r.connectors.map((c) => c.column + 1))));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isOnCurrent = row.isOnCurrentBranch;
    const chars = renderGraphRow(row, focusOpts(isOnCurrent, padCols));

    // Width consistency
    assert(
      totalCharWidth(chars) === padCols * 2,
      `Row ${i} ("${row.commit.subject}"): width=${totalCharWidth(chars)}, expected ${padCols * 2}`,
    );

    // Check every char: only ● and │ may be focus-colored
    for (let j = 0; j < chars.length; j++) {
      const gc = chars[j];
      if (gc.color === FOCUS_COLOR) {
        const allowed = gc.char === "●" || gc.char === "● " || gc.char === "│ " || gc.char === "│";
        assert(
          allowed,
          `Row ${i} ("${row.commit.subject}"): focus-colored "${gc.char}" at position ${j} — corners/dashes must be dimmed`,
        );
      }
    }

    // Also check connector rows
    const connChars = renderConnectorRow(row, focusOpts(isOnCurrent, padCols));
    assert(
      totalCharWidth(connChars) === padCols * 2,
      `Row ${i}: connector row width=${totalCharWidth(connChars)}, expected ${padCols * 2}`,
    );
    for (let j = 0; j < connChars.length; j++) {
      const gc = connChars[j];
      if (gc.color === FOCUS_COLOR) {
        const allowed = gc.char === "│ " || gc.char === "│";
        assert(
          allowed,
          `Row ${i} connector: focus-colored "${gc.char}" at position ${j}`,
        );
      }
    }
  }
}

// ============================================================
// Test 5: Wide crossing — focused lane passes through while
// non-focused merge spans multiple columns
// ============================================================
function test5() {
  console.log("\nTest 5: Wide crossing (focused lane passes through non-focused merge)");

  // develop at col 0 (focused), release at col 2, hotfix at col 1
  // release merges hotfix: spanning cols 1-2 while develop passes through at col 0
  const commits: Commit[] = [
    makeCommit("d3", ["d2"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
    makeCommit("d2", ["d1"], [], "develop work"),
    makeCommit("r2", ["mr"], [{ name: "release", type: "branch", isCurrent: false }], "release tip"),
    makeCommit("mr", ["r1", "h1"], [], "Merge hotfix into release"),
    makeCommit("h1", ["d1"], [{ name: "hotfix", type: "branch", isCurrent: false }], "hotfix work"),
    makeCommit("r1", ["d1"], [], "release work"),
    makeCommit("d1", [], [], "initial"),
  ];

  const rows = buildGraph(commits);
  const padCols = Math.max(...rows.map((r) => r.columns.length), ...rows.map((r) => Math.max(...r.connectors.map((c) => c.column + 1))));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isOnCurrent = row.isOnCurrentBranch;
    const chars = renderGraphRow(row, focusOpts(isOnCurrent, padCols));

    // Width
    assert(
      totalCharWidth(chars) === padCols * 2,
      `Row ${i} ("${row.commit.subject}"): width=${totalCharWidth(chars)}, expected ${padCols * 2}`,
    );

    // Focus color discipline
    for (let j = 0; j < chars.length; j++) {
      const gc = chars[j];
      if (gc.color === FOCUS_COLOR) {
        const allowed = gc.char === "●" || gc.char === "● " || gc.char === "│ " || gc.char === "│";
        assert(
          allowed,
          `Row ${i} ("${row.commit.subject}"): focus-colored "${gc.char}" at position ${j}`,
        );
      }
    }
  }
}

// ============================================================
// Run all tests
// ============================================================
console.log("Focus Mode Tests");
console.log("=".repeat(60));

test1();
test2();
test3();
test4();
test5();

console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passedTests}/${totalTests} passed, ${failedTests} failed`);

if (failedTests > 0) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll tests PASSED!");
}
