/**
 * Shared test helpers for graph engine tests.
 */

import type { Commit, Connector } from "../src/git/types";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

export function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    console.error(`  FAIL: ${message}`);
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
