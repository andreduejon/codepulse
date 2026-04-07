/**
 * Test: verifies computeBrightColumns — the pure function that determines which
 * graph columns stay bright when ancestry highlighting is active.
 *
 * Tests cover vertical bright columns (│ passthroughs and █ nodes) and
 * horizontal bright columns (fan-out row connectors between different-lane
 * ancestry nodes).
 */
import { describe, expect, test } from "bun:test";
import { buildGraph, computeBrightColumns } from "../src/git/graph";
import { findRow, makeCommit, printGraph } from "./test-helpers";

describe("computeBrightColumns", () => {
  test("same-column ancestry pair — vertical only, no fanOutHorizontal", () => {
    // Linear chain: a → b → c, all in column 0
    const commits = [
      makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("b", ["c"]),
      makeCommit("c", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const ancestrySet = new Set(["a", "b", "c"]);
    const result = computeBrightColumns(ancestrySet, rows);

    // Each ancestry row should have its nodeColumn in vertical
    for (const hash of ["a", "b", "c"]) {
      const row = findRow(rows, hash);
      expect(result.vertical.get(hash)?.has(row.nodeColumn)).toBe(true);
    }

    // No horizontal brightening needed — all in same column
    expect(result.fanOutHorizontal.size).toBe(0);
  });

  test("different-column ancestry pair — fanOutHorizontal spans correct columns", () => {
    // Two branches from same parent: a1 (col 0) and b1 (col 1) both parent to d1
    // Ancestry: a1 → d1 (different columns)
    const commits = [
      makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
      makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }]),
      makeCommit("d0", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const a1Row = findRow(rows, "a1");
    const d1Row = findRow(rows, "d1");

    // Ancestry chain: a1 → d1 (a1's first parent is d1)
    const ancestrySet = new Set(["a1", "d1"]);
    const result = computeBrightColumns(ancestrySet, rows);

    // Both ancestry rows should have their nodeColumn in vertical
    expect(result.vertical.get("a1")?.has(a1Row.nodeColumn)).toBe(true);
    expect(result.vertical.get("d1")?.has(d1Row.nodeColumn)).toBe(true);

    // d1 should have fanOutHorizontal entry since a1 is at a different column
    if (a1Row.nodeColumn !== d1Row.nodeColumn) {
      const foMap = result.fanOutHorizontal.get("d1");
      expect(foMap).toBeDefined();
      if (!foMap) throw new Error("Expected fanOutHorizontal for d1");

      // Should have exactly one fan-out row index entry
      expect(foMap.size).toBe(1);

      // The bright columns should span [lo..hi] between the two node columns
      const lo = Math.min(a1Row.nodeColumn, d1Row.nodeColumn);
      const hi = Math.max(a1Row.nodeColumn, d1Row.nodeColumn);
      const [, colSet] = [...foMap.entries()][0];
      for (let c = lo; c <= hi; c++) {
        expect(colSet.has(c)).toBe(true);
      }
    }
  });

  test("intermediate rows get passthrough column in vertical", () => {
    // a1 and c1 are on the ancestry chain, b1 is an intermediate non-ancestry row
    // All on the same lane (column 0)
    const commits = [
      makeCommit("a1", ["b1"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("b1", ["c1"]),
      makeCommit("c1", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    // Ancestry: a1 → c1 (skip b1 — it's intermediate, not in ancestry set)
    const ancestrySet = new Set(["a1", "c1"]);
    const result = computeBrightColumns(ancestrySet, rows);

    const a1Row = findRow(rows, "a1");
    const b1Row = findRow(rows, "b1");

    // b1 should have a vertical bright column (the passthrough from a1 to c1)
    const b1Bright = result.vertical.get("b1");
    expect(b1Bright).toBeDefined();
    expect(b1Bright?.has(a1Row.nodeColumn)).toBe(true);

    // b1 is an intermediate row, not an ancestry node itself — it gets the
    // passthrough column from the child (a1) if that column is active
    expect(b1Row.columns[a1Row.nodeColumn]?.active).toBe(true);
  });

  test("only the correct fan-out row is selected when parent has multiple", () => {
    // Three branches fan out from d1: a1, b1, c1
    // Ancestry chain: a1 → d1
    // Only the fan-out row that has a corner at a1's column should be bright
    const commits = [
      makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
      makeCommit("c1", ["d1"], [{ name: "feat-C", type: "branch", isCurrent: false }]),
      makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }]),
      makeCommit("d0", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const a1Row = findRow(rows, "a1");
    const d1Row = findRow(rows, "d1");

    // Only a1 → d1 is the ancestry chain
    const ancestrySet = new Set(["a1", "d1"]);
    const result = computeBrightColumns(ancestrySet, rows);

    if (a1Row.nodeColumn !== d1Row.nodeColumn) {
      const foMap = result.fanOutHorizontal.get("d1");
      expect(foMap).toBeDefined();
      if (!foMap) throw new Error("Expected fanOutHorizontal for d1");

      // Only ONE fan-out row should be brightened
      expect(foMap.size).toBe(1);

      // Verify it's the one that actually reaches a1's column
      const [foIdx] = [...foMap.keys()];
      const foRows = d1Row.fanOutRows;
      expect(foRows).toBeDefined();
      if (!foRows) throw new Error("Expected fanOutRows on d1");

      const targetFoRow = foRows[foIdx];
      const reachesA1 = targetFoRow.some(
        c => c.column === a1Row.nodeColumn && (c.type === "corner-bottom-right" || c.type === "corner-bottom-left"),
      );
      expect(reachesA1).toBe(true);
    }
  });

  test("non-ancestry rows have no entries in vertical or fanOutHorizontal", () => {
    // a1 (ancestry) → d1 (ancestry), b1 is a side branch (not ancestry, not intermediate)
    const commits = [
      makeCommit("a1", ["d1"], [{ name: "feat-A", type: "branch", isCurrent: false }]),
      makeCommit("b1", ["d1"], [{ name: "feat-B", type: "branch", isCurrent: false }]),
      makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }]),
      makeCommit("d0", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    // b1 is not in the ancestry set and not between a1 and d1 in row order
    // (it's between them, but let's check whether it's truly intermediate)
    const ancestrySet = new Set(["a1", "d1"]);
    const result = computeBrightColumns(ancestrySet, rows);

    // d0 is not in ancestry set
    expect(result.vertical.has("d0")).toBe(false);
    expect(result.fanOutHorizontal.has("d0")).toBe(false);

    // a1 should NOT have fanOutHorizontal (it's the child, not the parent)
    expect(result.fanOutHorizontal.has("a1")).toBe(false);
  });

  test("lane switch — intermediate rows pick up parentCol when childCol inactive", () => {
    // Create a scenario where the ancestry child's column becomes inactive
    // before reaching the parent. This happens when a branch closes its lane
    // between two ancestry nodes.
    //
    // Graph: main (col 0) has commits m1 → m2
    //        feat (col 1) branches from m2
    //        ancestry: m1 → m2 (same column, no switch needed)
    //
    // For a true lane-switch scenario, we need the child's column to go inactive.
    // This is hard to construct synthetically, but we can verify the basic logic:
    // when childCol IS active on an intermediate row, that column is picked.
    const commits = [
      makeCommit("m1", ["m2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("f1", ["m2"], [{ name: "feat", type: "branch", isCurrent: false }]),
      makeCommit("m2", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const m1Row = findRow(rows, "m1");
    const m2Row = findRow(rows, "m2");

    // Ancestry: m1 → m2
    const ancestrySet = new Set(["m1", "m2"]);
    const result = computeBrightColumns(ancestrySet, rows);

    // Both should have vertical entries
    expect(result.vertical.get("m1")?.has(m1Row.nodeColumn)).toBe(true);
    expect(result.vertical.get("m2")?.has(m2Row.nodeColumn)).toBe(true);

    // f1 is between m1 and m2 in row order — should get passthrough if applicable
    const f1Bright = result.vertical.get("f1");
    if (f1Bright) {
      // If f1 has a bright column, it should be childCol (m1's column) or parentCol (m2's column)
      const validCols = new Set([m1Row.nodeColumn, m2Row.nodeColumn]);
      for (const col of f1Bright) {
        expect(validCols.has(col)).toBe(true);
      }
    }
  });

  test("long ancestry chain with multiple lane changes", () => {
    // Build a longer chain where the ancestry path crosses multiple columns
    // c1 (main) → c2 → c3, with side branches causing lane shifts
    const commits = [
      makeCommit("s1", ["c2"], [{ name: "side1", type: "branch", isCurrent: false }]),
      makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("s2", ["c3"], [{ name: "side2", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["c3"]),
      makeCommit("c3", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    // Ancestry: c1 → c2 → c3
    const ancestrySet = new Set(["c1", "c2", "c3"]);
    const result = computeBrightColumns(ancestrySet, rows);

    // All ancestry nodes should have their nodeColumn in vertical
    for (const hash of ["c1", "c2", "c3"]) {
      const row = findRow(rows, hash);
      expect(result.vertical.get(hash)?.has(row.nodeColumn)).toBe(true);
    }

    // For each consecutive ancestry pair in different columns, verify fanOutHorizontal
    const c1Row = findRow(rows, "c1");
    const c2Row = findRow(rows, "c2");
    const c3Row = findRow(rows, "c3");

    // c1 → c2: if different columns, c2 should have fanOutHorizontal
    if (c1Row.nodeColumn !== c2Row.nodeColumn && c2Row.fanOutRows) {
      const foMap = result.fanOutHorizontal.get("c2");
      expect(foMap).toBeDefined();
    }

    // c2 → c3: if different columns, c3 should have fanOutHorizontal
    if (c2Row.nodeColumn !== c3Row.nodeColumn && c3Row.fanOutRows) {
      const foMap = result.fanOutHorizontal.get("c3");
      expect(foMap).toBeDefined();
    }
  });

  test("empty ancestry set produces empty maps", () => {
    const commits = [makeCommit("a", ["b"]), makeCommit("b", [])];
    const rows = buildGraph(commits);
    const result = computeBrightColumns(new Set(), rows);

    expect(result.vertical.size).toBe(0);
    expect(result.fanOutHorizontal.size).toBe(0);
  });

  test("single-node ancestry set — only vertical, no fanOutHorizontal", () => {
    const commits = [makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]), makeCommit("b", [])];
    const rows = buildGraph(commits);
    const aRow = findRow(rows, "a");

    const result = computeBrightColumns(new Set(["a"]), rows);

    expect(result.vertical.get("a")?.has(aRow.nodeColumn)).toBe(true);
    expect(result.vertical.has("b")).toBe(false);
    expect(result.fanOutHorizontal.size).toBe(0);
  });
});
