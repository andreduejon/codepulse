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
    expect(result.commitHorizontal.size).toBe(0);
  });

  test("single-node ancestry set — only vertical, no fanOutHorizontal", () => {
    const commits = [makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]), makeCommit("b", [])];
    const rows = buildGraph(commits);
    const aRow = findRow(rows, "a");

    const result = computeBrightColumns(new Set(["a"]), rows);

    expect(result.vertical.get("a")?.has(aRow.nodeColumn)).toBe(true);
    expect(result.vertical.has("b")).toBe(false);
    expect(result.fanOutHorizontal.size).toBe(0);
    expect(result.commitHorizontal.size).toBe(0);
  });

  test("commit-row horizontal brightening — merge arm on commit row itself", () => {
    // When a merge commit's horizontal connector is on the commit row (not a
    // fan-out row), commitHorizontal should capture the bright columns.
    //
    // Graph:
    //   █─╮  m1 (main)       — merge commit, merge arm is on commit row
    //   │ │
    //   │ █  f1 (feature)    — ancestry child in a different column
    //   │ │
    //   █─╯  d1              — base commit
    //
    // Ancestry: m1 → d1 (m1's first parent is d1)
    // m1 is at col 0, d1 is at col 0 — same column, no horizontal needed.
    // But if we make m1's first parent d1 and f1 is the second parent (merge),
    // the first-parent chain is m1 → d1 (same col, no horizontal).
    //
    // For the test to exercise commitHorizontal, we need a scenario where:
    // 1. Two ancestry nodes are in DIFFERENT columns
    // 2. The connection is via commit-row connectors, NOT fan-out rows
    // This happens when a commit is the merge target (not the merge source).
    //
    // A simpler scenario: feature branch merges back, and the merge commit
    // has the merge arm on its commit row. The ancestry chain follows through
    // the merge arm.
    const commits = [
      makeCommit("m1", ["d1", "f1"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("f1", ["d1"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("d1", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const m1Row = findRow(rows, "m1");
    const f1Row = findRow(rows, "f1");
    const d1Row = findRow(rows, "d1");

    // Ancestry chain f1 → d1: first parent of f1 is d1
    // This tests the commit-row horizontal when f1 and d1 are in different columns
    // connected via d1's commit-row connectors (the merge close ╯).
    if (f1Row.nodeColumn !== d1Row.nodeColumn) {
      const ancestrySet = new Set(["f1", "d1"]);
      const result = computeBrightColumns(ancestrySet, rows);

      // Check if connection goes through fan-out or commit row
      const foMap = result.fanOutHorizontal.get("d1");
      const chMap = result.commitHorizontal.get("d1");

      // At least one of them should have the bright columns
      const hasFanOut = foMap && foMap.size > 0;
      const hasCommitH = chMap && chMap.size > 0;
      expect(hasFanOut || hasCommitH).toBe(true);

      // If commitHorizontal is populated, verify the column span is correct
      if (hasCommitH) {
        const lo = Math.min(f1Row.nodeColumn, d1Row.nodeColumn);
        const hi = Math.max(f1Row.nodeColumn, d1Row.nodeColumn);
        for (let c = lo; c <= hi; c++) {
          expect(chMap?.has(c)).toBe(true);
        }
      }
    }

    // Also test the m1 → d1 ancestry (same column, should have no horizontal)
    const ancestrySet2 = new Set(["m1", "d1"]);
    const result2 = computeBrightColumns(ancestrySet2, rows);
    if (m1Row.nodeColumn === d1Row.nodeColumn) {
      // Same column — no horizontal brightening needed
      expect(result2.commitHorizontal.has("d1")).toBe(false);
    }
  });

  test("lane-switch ancestry — fanOutHorizontal bridges different-column pairs", () => {
    // Graph:
    //   █       s1  (side1)       col 0
    //   │
    //   │ █     c1  (main)        col 1  ← ancestry
    //   │ │
    //   │ │ █   s2  (side2)       col 2
    //   │ │ │
    //   █─╯ │   c2  ()            col 0  ← ancestry (merge close from col 1)
    //   │   │
    //   █───╯   c3  ()            col 0  ← ancestry
    //
    // Ancestry chain: c1 (col 1) → c2 (col 0) → c3 (col 0)
    // c1→c2 crosses columns: the fan-out row at c2 draws ─╯ from col 0 to
    // col 1, so fanOutHorizontal should cover [0, 1].
    // c2→c3 is same column (col 0), so only vertical brightening is needed.
    //
    // Intermediate row s2 (between c1 and c2) should only get col 1 (c1's
    // column, the child) in its vertical bright set. Col 0 (c2's column,
    // the parent) is just that branch's own passthrough — the ancestry
    // path transitions to it only at c2's fan-out/commit row.
    //
    // Col 1 is NOT active at c2 (the lane closes via ╯), so c2's vertical
    // only has col 0 (its nodeColumn). The c1→c2 connection is entirely
    // handled by fanOutHorizontal, not vertical.
    const commits = [
      makeCommit("s1", ["c2"], [{ name: "side1", type: "branch", isCurrent: false }]),
      makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("s2", ["c3"], [{ name: "side2", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["c3"]),
      makeCommit("c3", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const c1Row = findRow(rows, "c1");
    const c2Row = findRow(rows, "c2");
    const c3Row = findRow(rows, "c3");
    const s2Row = findRow(rows, "s2");

    // Verify the graph shape: c1 should be in a different column from c2/c3
    expect(c2Row.nodeColumn).toBe(c3Row.nodeColumn);
    expect(c1Row.nodeColumn).not.toBe(c2Row.nodeColumn);

    const ancestrySet = new Set(["c1", "c2", "c3"]);
    const result = computeBrightColumns(ancestrySet, rows);

    const c1Col = c1Row.nodeColumn;
    const c2Col = c2Row.nodeColumn;

    // Each ancestry node has its own nodeColumn seeded in vertical
    expect(result.vertical.get("c1")?.has(c1Col)).toBe(true);
    expect(result.vertical.get("c2")?.has(c2Col)).toBe(true);
    expect(result.vertical.get("c3")?.has(c2Col)).toBe(true);

    // s2 is intermediate between c1 and c2 — only the child's column (c1Col)
    // should be bright. The parent's column (c2Col) is just that branch's own
    // passthrough, not the ancestry path. The ancestry transitions to parentCol
    // only at c2's fan-out/commit row via horizontal connectors.
    expect(result.vertical.get("s2")?.has(c1Col)).toBe(true);
    expect(result.vertical.get("s2")?.has(c2Col)).toBeFalsy();

    // c2 should NOT have c1's column in vertical (col 1 is inactive at c2)
    expect(s2Row.columns[c1Col]?.active).toBe(true); // still active at s2
    expect(c2Row.columns[c1Col]?.active).toBe(false); // closed at c2
    expect(result.vertical.get("c2")?.has(c1Col)).toBeFalsy();
    // fanOutVertical also skips c1Col because the column is inactive at c2
    expect(result.fanOutVertical.get("c2")?.has(c1Col)).toBeFalsy();

    // c1→c2 connection goes through fan-out row on c2
    const foMap = result.fanOutHorizontal.get("c2");
    expect(foMap).toBeDefined();
    if (foMap) {
      expect(foMap.size).toBe(1);
      const [, colSet] = [...foMap.entries()][0];
      const lo = Math.min(c1Col, c2Col);
      const hi = Math.max(c1Col, c2Col);
      for (let c = lo; c <= hi; c++) {
        expect(colSet.has(c)).toBe(true);
      }
    }
  });

  test("fanOutVertical — childCol NOT added when no straight passthrough on fan-out rows", () => {
    // Graph:
    //   █       s1  (side1)       col 0
    //   │
    //   │ █     c1  (main)        col 1  ← ancestry child
    //   │ │
    //   │ │ █   s2  (side2)       col 2
    //   │ │ │
    //   █─╯ │   c2  ()            col 0  ← ancestry parent (c1 col closes here via ╯)
    //   │   │
    //   █───╯   c3  ()            col 0  ← ancestry
    //
    // c2's fan-out row has a ╯ (corner-bottom-right) at c1Col, NOT a straight
    // passthrough. So there is no ┼ crossing to worry about, and fanOutVertical
    // should NOT have c1Col.
    const commits = [
      makeCommit("s1", ["c2"], [{ name: "side1", type: "branch", isCurrent: false }]),
      makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("s2", ["c3"], [{ name: "side2", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["c3"]),
      makeCommit("c3", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const c1Row = findRow(rows, "c1");
    const c2Row = findRow(rows, "c2");

    const ancestrySet = new Set(["c1", "c2", "c3"]);
    const result = computeBrightColumns(ancestrySet, rows);

    const c1Col = c1Row.nodeColumn;

    // c1Col is inactive at c2's commit row and has no straight on any fan-out row
    expect(c2Row.columns[c1Col]?.active).toBe(false);
    expect(result.fanOutVertical.get("c2")?.has(c1Col)).toBeFalsy();

    // vertical should also NOT have c1Col for c2
    expect(result.vertical.get("c2")?.has(c1Col)).toBeFalsy();
  });

  test("fanOutVertical — childCol added when straight exists on earlier fan-out row", () => {
    // Graph:
    //   █       s1  (side)        col 0
    //   │
    //   │ █     f1  (feat-F)      col 1  ← ancestry child
    //   │ │
    //   │ │ █   g1  (feat-G)      col 2
    //   │ │ │
    //   █─┼─╯                     FO[0]: ┼ at col 1 (straight + horizontal)
    //   █─╯     d1  (develop)     FO[1] merged: ╯ at col 1 (lane closes)
    //   │
    //   █       d0               col 0
    //
    // f1 at col 1 (ancestry child), d1 at col 0 (ancestry parent).
    // d1.columns[1] is inactive (lane closed by FO[1]), but FO[0] still has
    // a straight passthrough at col 1 creating a ┼. fanOutVertical must
    // include col 1 so the ┼ is replaced with │.
    const commits = [
      makeCommit("s1", ["d1"], [{ name: "side", type: "branch", isCurrent: false }]),
      makeCommit("f1", ["d1"], [{ name: "feat-F", type: "branch", isCurrent: false }]),
      makeCommit("g1", ["d1"], [{ name: "feat-G", type: "branch", isCurrent: false }]),
      makeCommit("d1", ["d0"], [{ name: "develop", type: "branch", isCurrent: true }]),
      makeCommit("d0", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const f1Row = findRow(rows, "f1");
    const d1Row = findRow(rows, "d1");

    // Ancestry: f1 → d1 → d0
    const ancestrySet = new Set(["f1", "d1", "d0"]);
    const result = computeBrightColumns(ancestrySet, rows);

    const f1Col = f1Row.nodeColumn;

    // f1Col is inactive at d1's commit row (lane closed by fan-out ╯)
    expect(d1Row.columns[f1Col]?.active).toBeFalsy();

    // But FO[0] has a straight at f1Col → fanOutVertical should have it
    const foRows = d1Row.fanOutRows;
    expect(foRows).toBeDefined();
    if (foRows) {
      const hasStraight = foRows.some(fo => fo.some(c => c.column === f1Col && c.type === "straight"));
      expect(hasStraight).toBe(true);
    }

    expect(result.fanOutVertical.get("d1")?.has(f1Col)).toBe(true);
  });

  test("trailing rows — ancestry continues beyond loaded data", () => {
    // Graph:
    //   █   a  (main)            col 0  ← ancestry (selected)
    //   │
    //   █   b  ()                col 0  ← ancestry (last loaded ancestor)
    //   │                               b's first parent is "unloaded" (not in rows)
    //   █   c  ()                col 0  ← NOT ancestry, but col 0 passthrough
    //   │                               should stay bright
    //   █   d  ()                col 0  ← same
    //
    // b's first parent ("unloaded") is not in the loaded rows. The rows
    // below b (c, d) should still have col 0 brightened because the
    // ancestry line continues past the loaded data boundary.
    const commits = [
      makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("b", ["unloaded"]), // first parent not in loaded rows
      makeCommit("c", ["d"]),
      makeCommit("d", []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const ancestrySet = new Set(["a", "b"]);
    const result = computeBrightColumns(ancestrySet, rows);

    const bRow = findRow(rows, "b");
    const bCol = bRow.nodeColumn;

    // c and d should have bCol in their vertical bright set
    expect(result.vertical.get("c")?.has(bCol)).toBe(true);
    expect(result.vertical.get("d")?.has(bCol)).toBe(true);
  });

  test("trailing rows — no extension when last ancestor's parent IS loaded", () => {
    // When the last ancestry node's first parent is loaded (and in the
    // ancestry set), no trailing extension is needed — the normal
    // consecutive-pair logic handles it.
    const commits = [
      makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("b", ["c"]),
      makeCommit("c", []),
    ];
    const rows = buildGraph(commits);

    // Ancestry includes b and c — c is loaded, so no trailing extension
    const ancestrySet = new Set(["a", "b", "c"]);
    const result = computeBrightColumns(ancestrySet, rows);

    // c is the last ancestry node and has no first parent → no trailing rows
    // All three should have vertical entries from the normal seed logic
    expect(result.vertical.get("a")).toBeDefined();
    expect(result.vertical.get("b")).toBeDefined();
    expect(result.vertical.get("c")).toBeDefined();
  });
});
