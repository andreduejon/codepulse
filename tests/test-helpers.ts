/**
 * Shared test helpers for graph engine tests.
 */
import { expect } from "bun:test";
import {
  type GraphChar,
  getMaxGraphColumns,
  type RenderOptions,
  renderConnectorRow,
  renderFanOutRow,
  renderGraphRow,
} from "../src/git/graph";
import type { Commit, Connector, GraphRow, RefInfo } from "../src/git/types";

/**
 * Assert that a value is defined (not `undefined` and not `null`), narrowing
 * the type to `NonNullable<T>`. Combines `expect(x).toBeDefined()` +
 * `if (!x) throw` into a single call.
 */
export function assertDefined<T>(value: T, label = "value"): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
  if (value == null) throw new Error(`Expected ${label} to be defined`);
}

/** Find a row by commit hash, failing the test if not found. */
export function findRow(rows: GraphRow[], hash: string): GraphRow {
  const row = rows.find(r => r.commit.hash === hash);
  if (!row) throw new Error(`Row with hash "${hash}" not found`);
  return row;
}

export function makeCommit(
  hash: string,
  parents: string[],
  refs: { name: string; type: RefInfo["type"]; isCurrent: boolean }[] = [],
  subject = `commit ${hash}`,
): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    subject,
    body: "",
    author: "test",
    authorEmail: "test@test.com",
    authorDate: new Date().toISOString(),
    committer: "test",
    committerEmail: "test@test.com",
    commitDate: new Date().toISOString(),
    refs,
  } as Commit;
}

/** Check that a row has a connector of the given type at the given column */
export function hasConnector(connectors: Connector[], type: string, column: number): boolean {
  return connectors.some(c => c.type === type && c.column === column);
}

/** Find a connector of the given type at the given column */
export function findConnector(connectors: Connector[], type: string, column?: number): Connector | undefined {
  if (column !== undefined) {
    return connectors.find(c => c.type === type && c.column === column);
  }
  return connectors.find(c => c.type === type);
}

/** Convert GraphChar[] to a plain ASCII string (no colors). */
export function graphCharsToAscii(chars: GraphChar[]): string {
  return chars.map(gc => gc.char).join("");
}

export const THEME_COLORS = ["#c0c001", "#c0c002", "#c0c003", "#c0c004", "#c0c005", "#c0c006", "#c0c007", "#c0c008"];

/** Connector types that indicate a merge/branch connection (not just a straight pass-through). */
export const CONNECTION_TYPES = new Set([
  "horizontal",
  "tee-left",
  "tee-right",
  "corner-top-right",
  "corner-top-left",
  "corner-bottom-right",
  "corner-bottom-left",
]);

/** Check whether a connector list has merge/branch connectors (mirrors canMergeFanOut from graph.tsx). */
export function hasMergeConnectors(connectors: Connector[]): boolean {
  return connectors.some(c => CONNECTION_TYPES.has(c.type));
}

/** Print fan-out rows above a commit, optionally excluding the last one when it will be merged. */
function printFanOutRows(foRows: Connector[][], count: number, opts: RenderOptions, nodeColumn: number): void {
  for (let i = 0; i < count; i++) {
    const foAscii = graphCharsToAscii(renderFanOutRow(foRows[i], opts, nodeColumn));
    console.log(`        ${foAscii}`);
  }
}

/**
 * Print the full rendered graph for a set of rows, matching the real app's
 * visual output. Mirrors the `canMergeFanOut` optimization from graph.tsx:
 * when a commit row has no merge/branch connectors, the last fan-out row
 * is used as the commit row's graph (single █ block).
 *
 * Only prints when `process.env.DEBUG` is set (e.g. `DEBUG=1 bun test`).
 */
export function printGraph(rows: GraphRow[], themeColors: string[] = THEME_COLORS) {
  if (!process.env.DEBUG) return;
  const maxCols = getMaxGraphColumns(rows);
  const opts = { themeColors, padToColumns: maxCols };

  for (const row of rows) {
    const foRows = row.fanOutRows;
    const canMerge = foRows && foRows.length > 0 && !hasMergeConnectors(row.connectors);

    if (foRows) {
      const count = canMerge ? foRows.length - 1 : foRows.length;
      printFanOutRows(foRows, count, opts, row.nodeColumn);
    }

    // Commit row: use last fan-out row's graph if merging, else normal
    const refs = row.commit.refs.map(r => r.name).join(", ");
    const ro = row.isRemoteOnly ? " [RO]" : "";
    if (canMerge && foRows) {
      const lastFO = foRows.at(-1);
      if (!lastFO) throw new Error("Expected lastFO to be defined");
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
