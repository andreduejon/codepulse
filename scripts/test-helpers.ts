/**
 * Shared test helpers for graph engine tests.
 */
import type { Commit, Connector, GraphRow } from "../src/git/types";
import { type GraphChar, type RenderOptions, renderGraphRow, renderFanOutRow, renderConnectorRow, getMaxGraphColumns } from "../src/git/graph";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Error thrown by assert/assertEqual on failure.
 * Caught by `runTest()` to prevent cascading crashes from `!` assertions
 * after a failed check, while still allowing later tests to run.
 */
class TestAssertionError extends Error {
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

/** Convert GraphChar[] to a plain ASCII string (no colors). */
export function graphCharsToAscii(chars: GraphChar[]): string {
  return chars.map(gc => gc.char).join("");
}

export const THEME_COLORS = [
  "#c0c001", "#c0c002", "#c0c003", "#c0c004",
  "#c0c005", "#c0c006", "#c0c007", "#c0c008",
];

/** Build render options with the shared test theme colors. */
export function renderOpts(padToColumns?: number): RenderOptions {
  return { themeColors: THEME_COLORS, padToColumns };
}

/** Check if any GraphChar in an array contains a specific character. */
export function hasChar(chars: GraphChar[], ch: string): boolean {
  return chars.some(gc => gc.char === ch || gc.char.includes(ch));
}

/** Find all GraphChars containing a specific character. */
export function findChars(chars: GraphChar[], ch: string): GraphChar[] {
  return chars.filter(gc => gc.char === ch || gc.char.includes(ch));
}

/** Get total character width of a GraphChar array. */
export function totalCharWidth(chars: GraphChar[]): number {
  return chars.reduce((sum, gc) => sum + gc.char.length, 0);
}

/**
 * Assert that every connector, column, and fan-out connector on the given row
 * has `isRemoteOnly === true`. Used by tests that verify post-pass dimming.
 */
export function assertRowFullyDimmed(row: GraphRow, rowIdx: number) {
  const label = `Row ${rowIdx} (${row.commit.hash})`;

  for (const conn of row.connectors) {
    assert(conn.isRemoteOnly === true,
      `${label}: connector ${conn.type}@col${conn.column} should be remote-only`);
  }

  for (let col = 0; col < row.columns.length; col++) {
    const column = row.columns[col];
    assert(column.isRemoteOnly !== undefined, `${label}: column ${col} should have isRemoteOnly defined`);
    assert(column.isRemoteOnly, `${label}: column ${col} should be remote-only`);
  }

  if (row.fanOutRows) {
    for (let foIdx = 0; foIdx < row.fanOutRows.length; foIdx++) {
      for (const conn of row.fanOutRows[foIdx]) {
        assert(conn.isRemoteOnly === true,
          `${label}: fan-out[${foIdx}] ${conn.type}@col${conn.column} should be remote-only`);
      }
    }
  }
}

/**
 * Print the full rendered graph for a set of rows, matching the real app's
 * visual output. Mirrors the `canMergeFanOut` optimization from graph.tsx:
 * when a commit row has no merge/branch connectors, the last fan-out row
 * is used as the commit row's graph (single █ block).
 */
export function printGraph(rows: GraphRow[], themeColors: string[] = THEME_COLORS) {
  const maxCols = getMaxGraphColumns(rows);
  const opts = { themeColors, padToColumns: maxCols };
  for (const row of rows) {
    const foRows = row.fanOutRows;

    // Mirror canMergeFanOut: commit row has no merge/branch connectors?
    const commitHasConnections = row.connectors.some(c =>
      c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
      c.type === "corner-top-right" || c.type === "corner-top-left" ||
      c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
    );
    const canMerge = foRows && foRows.length > 0 && !commitHasConnections;

    if (foRows) {
      // Print fan-out rows above the commit.
      // If merging, print all except the last (last becomes the commit row).
      const count = canMerge ? foRows.length - 1 : foRows.length;
      for (let i = 0; i < count; i++) {
        const foAscii = graphCharsToAscii(renderFanOutRow(foRows[i], opts, row.nodeColumn));
        console.log(`        ${foAscii}`);
      }
    }

    // Commit row: use last fan-out row's graph if merging, else normal
    const refs = row.commit.refs.map(r => r.name).join(", ");
    const ro = row.isRemoteOnly ? " [RO]" : "";
    if (canMerge && foRows) {
      const lastFO = foRows.at(-1);

      assert(lastFO !== undefined, "Last fan-out row should exist when canMerge is true");

      const foAscii = graphCharsToAscii(renderFanOutRow(lastFO, opts, row.nodeColumn));
      console.log(`        ${foAscii}  ${row.commit.hash}  (${refs})${ro}`);
    } else {
      const commitAscii = graphCharsToAscii(renderGraphRow(row, opts));
      console.log(`        ${commitAscii}  ${row.commit.hash}  (${refs})${ro}`);
    }

    // Connector row below the commit
    const connAscii = graphCharsToAscii(renderConnectorRow(row, opts));
    if (connAscii.trim()) {
      console.log(`        ${connAscii}`);
    }
  }
}
