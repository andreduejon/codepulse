/**
 * Shared test helpers for graph engine tests.
 */

import type { Commit, Connector, GraphRow } from "../src/git/types";
import { renderGraphRow, renderConnectorRow, renderFanOutRow, type GraphChar, type RenderOptions } from "../src/git/graph";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Error thrown by assert/assertEqual on failure.
 * Caught by `runTest()` to prevent cascading crashes from `!` assertions
 * after a failed check, while still allowing later tests to run.
 */
export class TestAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestAssertionError";
  }
}

export function assert(condition: boolean, message: string): asserts condition {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    console.error(`  FAIL: ${message}`);
    throw new TestAssertionError(message);
  }
}

/**
 * Assert that two values are strictly equal. On failure, shows both values
 * for easy comparison.
 */
export function assertEqual<T>(expected: T, actual: T, message: string): void {
  totalTests++;
  if (expected === actual) {
    passedTests++;
  } else {
    failedTests++;
    console.error(`  FAIL: ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    throw new TestAssertionError(message);
  }
}

/**
 * Run a test function, catching TestAssertionError so that one test failure
 * doesn't crash subsequent tests.
 */
export function runTest(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof TestAssertionError) {
      // Already counted and logged by assert/assertEqual — move on
    } else {
      // Unexpected error — count it as a failure
      failedTests++;
      totalTests++;
      console.error(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export function getResults() {
  return { totalTests, passedTests, failedTests };
}

export function resetResults() {
  totalTests = 0;
  passedTests = 0;
  failedTests = 0;
}

export function printResults(label: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results: ${passedTests}/${totalTests} passed, ${failedTests} failed`);
  if (failedTests === 0) {
    console.log(`\nAll ${label} tests PASSED!`);
  } else {
    console.log(`\n${failedTests} ${label} test(s) FAILED!`);
  }
}

export function makeCommit(
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
    committer: "test",
    committerEmail: "test@test.com",
    commitDate: new Date().toISOString(),
    refs,
  };
}

/** Check that a row has a connector of the given type at the given column */
export function hasConnector(
  connectors: Connector[],
  type: string,
  column: number,
): boolean {
  return connectors.some(c => c.type === type && c.column === column);
}

/** Find a connector of the given type at the given column */
export function findConnector(
  connectors: Connector[],
  type: string,
  column?: number,
): Connector | undefined {
  if (column !== undefined) {
    return connectors.find(c => c.type === type && c.column === column);
  }
  return connectors.find(c => c.type === type);
}

/** Count connectors of a given type */
export function countConnectors(connectors: Connector[], type: string): number {
  return connectors.filter(c => c.type === type).length;
}

// ============================================================
// Graph visualization helpers — for test failure diagnostics
// ============================================================

/** Convert GraphChar[] to a plain ASCII string (no colors). */
export function graphCharsToAscii(chars: GraphChar[]): string {
  return chars.map(gc => gc.char).join("");
}

/**
 * Render a complete GraphRow (commit row + connector row + fan-out rows)
 * as a multi-line ASCII string for test diagnostics.
 */
export function renderRowToAscii(row: GraphRow, opts: RenderOptions = {}): string[] {
  const lines: string[] = [];

  // Fan-out rows above the commit
  if (row.fanOutRows) {
    for (let i = 0; i < row.fanOutRows.length; i++) {
      const foChars = renderFanOutRow(row.fanOutRows[i], opts);
      lines.push(`  fo[${i}] ${graphCharsToAscii(foChars)}`);
    }
  }

  // Commit row
  const commitChars = renderGraphRow(row, opts);
  lines.push(`  node  ${graphCharsToAscii(commitChars)}  ${row.commit.shortHash} ${row.commit.subject}`);

  // Connector row
  const connChars = renderConnectorRow(row, opts);
  lines.push(`  conn  ${graphCharsToAscii(connChars)}`);

  return lines;
}

/**
 * Render an array of GraphRows as an ASCII graph.
 * Useful for printing expected vs actual in test failures.
 */
export function renderGraphToAscii(rows: GraphRow[], opts: RenderOptions = {}): string {
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    lines.push(...renderRowToAscii(rows[i], opts));
  }
  return lines.join("\n");
}

/**
 * Print expected and actual ASCII graphs side by side when a test fails.
 * Call this in test code after detecting a mismatch to aid debugging.
 */
export function printGraphComparison(
  label: string,
  expected: string[],
  actual: string[],
): void {
  const maxLen = Math.max(expected.length, actual.length);
  const colWidth = 50;
  console.error(`\n  ${label}:`);
  console.error(`  ${"EXPECTED".padEnd(colWidth)}  ACTUAL`);
  console.error(`  ${"-".repeat(colWidth)}  ${"-".repeat(colWidth)}`);
  for (let i = 0; i < maxLen; i++) {
    const exp = (expected[i] ?? "").padEnd(colWidth);
    const act = actual[i] ?? "";
    const marker = expected[i] !== actual[i] ? " <<<" : "";
    console.error(`  ${exp}  ${act}${marker}`);
  }
}
