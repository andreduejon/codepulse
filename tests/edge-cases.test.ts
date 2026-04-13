/**
 * Test: verifies edge cases in the graph engine.
 *
 * Covers: octopus merges, single-commit repos, lane reuse,
 * multiple refs on same commit, root commit handling,
 * already-processed parent merging, and detached HEAD states.
 */
import { describe, expect, test } from "bun:test";
import { buildGraph } from "../src/git/graph";
import {
  assertDefined,
  CONNECTION_TYPES,
  findConnector,
  findRow,
  hasConnector,
  makeCommit,
  printGraph,
} from "./test-helpers";

describe("Edge Cases", () => {
  test("Octopus merge (3 parents)", () => {
    const commits = [
      makeCommit("m1", ["d1", "a1", "b1"], [{ name: "develop", type: "branch", isCurrent: true }], "Octopus merge"),
      makeCommit("a1", ["d0"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A"),
      makeCommit("b1", ["d0"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B"),
      makeCommit("d1", ["d0"], [], "develop work"),
      makeCommit("d0", [], [], "initial"),
    ];

    // Should not throw
    const rows = buildGraph(commits);
    printGraph(rows);

    // Merge row should exist and have a node
    const mergeRow = rows[0];
    expect(mergeRow.commit.hash).toBe("m1");
    expect(hasConnector(mergeRow.connectors, "node", mergeRow.nodeColumn)).toBe(true);

    // Should have spanning connectors for each secondary parent
    const spanConnectors = mergeRow.connectors.filter(c => CONNECTION_TYPES.has(c.type));
    expect(spanConnectors.length).toBeGreaterThanOrEqual(2);
  });

  test("Single-commit repo", () => {
    const commits = [makeCommit("abc123", [], [{ name: "main", type: "branch", isCurrent: true }], "Initial commit")];

    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows.length).toBe(1);
    expect(rows[0].nodeColumn).toBe(0);

    const nodeConn = findConnector(rows[0].connectors, "node");
    assertDefined(nodeConn, "nodeConn");
    expect(nodeConn.column).toBe(0);

    // Should only have one meaningful connector (the node)
    const nonEmpty = rows[0].connectors.filter(c => c.type !== "empty");
    expect(nonEmpty.length).toBe(1);

    // No fan-out rows
    expect(rows[0].fanOutRows).toBeUndefined();
  });

  test("Lane reuse (freed interior column)", () => {
    const commits = [
      makeCommit("d5", ["m2"], [{ name: "develop", type: "branch", isCurrent: true }], "develop after merge B"),
      makeCommit("m2", ["d4", "b1"], [], "Merge feat-B"),
      makeCommit("b1", ["d3"], [{ name: "feat-B", type: "branch", isCurrent: false }], "feat-B work"),
      makeCommit("d4", ["m1"], [], "develop after merge A"),
      makeCommit("m1", ["d3", "a1"], [], "Merge feat-A"),
      makeCommit("a1", ["d2"], [{ name: "feat-A", type: "branch", isCurrent: false }], "feat-A work"),
      makeCommit("d3", ["d2"], [], "develop work 3"),
      makeCommit("r1", ["d2"], [{ name: "release", type: "branch", isCurrent: false }], "release tip"),
      makeCommit("d2", ["d1"], [], "develop work 2"),
      makeCommit("d1", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows.length).toBe(10);

    const aRow = rows.find(r => r.commit.hash === "a1");
    const bRow = rows.find(r => r.commit.hash === "b1");
    expect(aRow).toBeDefined();
    expect(bRow).toBeDefined();

    const maxUsedCol = Math.max(...rows.map(r => r.nodeColumn));
    expect(maxUsedCol).toBeLessThanOrEqual(3);
  });

  test("Multiple refs on same commit", () => {
    const commits = [
      makeCommit(
        "d2",
        ["d1"],
        [
          { name: "develop", type: "branch", isCurrent: true },
          { name: "origin/develop", type: "remote", isCurrent: false },
          { name: "origin/HEAD", type: "remote", isCurrent: false },
        ],
        "develop tip",
      ),
      makeCommit("d1", [], [], "initial"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows.length).toBe(2);
    expect(rows[0].nodeColumn).toBe(0);
    expect(rows[0].columns.length).toBeLessThanOrEqual(1);
    expect(rows[1].columns.length).toBeLessThanOrEqual(1);
  });

  test("Root commit handling", () => {
    const commits = [
      makeCommit("d2", ["d1"], [{ name: "develop", type: "branch", isCurrent: true }], "develop tip"),
      makeCommit("d1", [], [], "initial (root)"),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);

    const rootRow = rows[1];
    expect(rootRow.commit.hash).toBe("d1");
    expect(hasConnector(rootRow.connectors, "node", rootRow.nodeColumn)).toBe(true);

    const activeColumns = rootRow.columns.filter(c => c.active);
    expect(activeColumns.length).toBe(0);
  });

  test("Single-parent, parent already processed — lane closes", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("p1", ["root"], []),
      makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: true }]),
      makeCommit("root", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const c2Row = rows.find(r => r.commit.hash === "c2");
    assertDefined(c2Row, "c2Row");

    const closeConns = c2Row.connectors.filter(
      c =>
        c.type === "corner-bottom-right" ||
        c.type === "corner-bottom-left" ||
        c.type === "tee-left" ||
        c.type === "tee-right" ||
        c.type === "horizontal",
    );
    expect(closeConns.length).toBeGreaterThan(0);

    const p1Row = rows.find(r => r.commit.hash === "p1");
    assertDefined(p1Row, "p1Row");
    expect(p1Row.columns.some(c => c.active)).toBe(true);
  });

  test("Single-parent, parent already processed with existing lane — merge", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
      makeCommit("root", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const c2Row = rows.find(r => r.commit.hash === "c2");
    assertDefined(c2Row, "c2Row");

    const spanConns = c2Row.connectors.filter(
      c =>
        c.type === "corner-bottom-right" ||
        c.type === "corner-bottom-left" ||
        c.type === "tee-left" ||
        c.type === "tee-right" ||
        c.type === "horizontal",
    );
    expect(spanConns.length).toBeGreaterThan(0);
  });

  test("parentColors set correctly after already-processed merge", () => {
    const commits = [
      makeCommit("c1", ["p1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("p1", ["root"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("c2", ["p1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
      makeCommit("root", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const c2Row = findRow(rows, "c2");
    expect(c2Row.parentColors.length).toBe(1);
    expect(typeof c2Row.parentColors[0]).toBe("number");
  });

  test("Detached HEAD: on current branch, not remote-only, branchName from branchNameMap", () => {
    const commits = [
      makeCommit("d2", ["d1"], [{ name: "HEAD", type: "head", isCurrent: true }]),
      makeCommit("d1", [], [{ name: "main", type: "branch", isCurrent: false }]),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].isOnCurrentBranch).toBe(true);
    expect(rows[0].isRemoteOnly).toBe(false);
    expect(rows[0].branchName).toBe("HEAD");
  });

  test("Standalone detached HEAD (no other branches)", () => {
    const commits = [makeCommit("d1", [], [{ name: "HEAD", type: "head", isCurrent: true }])];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].isOnCurrentBranch).toBe(true);
    expect(rows[0].branchName).toBe("HEAD");
    expect(hasConnector(rows[0].connectors, "node", 0)).toBe(true);
  });
});
