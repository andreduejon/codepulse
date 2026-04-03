/**
 * Test: verifies the sliding graph viewport functions.
 *
 * Covers: computeSingleViewportOffset, sliceGraphToViewport,
 * getMaxGraphColumns, buildEdgeIndicator.
 */
import { describe, expect, test } from "bun:test";
import type { RenderOptions } from "../src/git/graph";
import {
  buildEdgeIndicator,
  buildGraph,
  computeSingleViewportOffset,
  getMaxGraphColumns,
  renderConnectorRow,
  renderGraphRow,
  sliceGraphToViewport,
} from "../src/git/graph";
import { makeCommit, printGraph } from "./test-helpers";

describe("Viewport", () => {
  test("No sliding when depth limit >= max columns", () => {
    const commits = [
      makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("c2", ["c3"]),
      makeCommit("c3", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const maxCols = getMaxGraphColumns(rows);

    let offset = 0;
    for (const row of rows) {
      offset = computeSingleViewportOffset(offset, row.nodeColumn, maxCols + 5, maxCols);
      expect(offset).toBe(0);
    }
  });

  test("Basic sliding for branched graph", () => {
    const commits = [
      makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("f1", ["c3"], [{ name: "feat-1", type: "branch", isCurrent: false }]),
      makeCommit("f2", ["c3"], [{ name: "feat-2", type: "branch", isCurrent: false }]),
      makeCommit("f3", ["c3"], [{ name: "feat-3", type: "branch", isCurrent: false }]),
      makeCommit("f4", ["c3"], [{ name: "feat-4", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["c3"]),
      makeCommit("c3", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const maxCols = getMaxGraphColumns(rows);

    const depthLimit = 3;
    let offset = 0;
    for (const row of rows) {
      offset = computeSingleViewportOffset(offset, row.nodeColumn, depthLimit, maxCols);
      const nc = row.nodeColumn;
      expect(nc >= offset && nc < offset + depthLimit).toBe(true);
    }
  });

  test("Smooth camera follow - offset doesn't jump unnecessarily", () => {
    const commits = [
      makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("b", ["c"]),
      makeCommit("c", ["d"]),
      makeCommit("d", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const maxCols = getMaxGraphColumns(rows);

    let offset = 0;
    for (const row of rows) {
      offset = computeSingleViewportOffset(offset, row.nodeColumn, 2, maxCols);
      expect(offset).toBe(0);
    }
  });

  test("Basic graph char slicing", () => {
    const commits = [
      makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("f1", ["c3"], [{ name: "f1", type: "branch", isCurrent: false }]),
      makeCommit("f2", ["c3"], [{ name: "f2", type: "branch", isCurrent: false }]),
      makeCommit("f3", ["c3"], [{ name: "f3", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["c3"]),
      makeCommit("c3", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const maxCols = getMaxGraphColumns(rows);
    const opts: RenderOptions = { padToColumns: maxCols };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const fullChars = renderGraphRow(row, opts);

      let fullWidth = 0;
      for (const gc of fullChars) fullWidth += gc.char.length;
      expect(fullWidth).toBe(maxCols * 2);

      const depthLimit = 3;
      const sliced = sliceGraphToViewport(fullChars, 0, depthLimit, row, opts);

      let slicedWidth = 0;
      for (const gc of sliced) slicedWidth += gc.char.length;
      expect(slicedWidth).toBe(depthLimit * 2);
    }
  });

  test("Edge indicator (single right-side column)", () => {
    const mutedColor = "#6c7086";
    const depthLimit = 4;
    const maxColumns = 12;

    // 5a: Node to the LEFT of viewport → ◀
    {
      const result = buildEdgeIndicator(0, 2, depthLimit, maxColumns, mutedColor, true);
      expect(result.char).toBe("◀ ");
      expect(result.color).toBe(mutedColor);
    }

    // 5b: Node to the RIGHT of viewport → ▶
    {
      const result = buildEdgeIndicator(10, 2, depthLimit, maxColumns, mutedColor, true);
      expect(result.char).toBe(" ▶");
      expect(result.color).toBe(mutedColor);
    }

    // 5c: Node WITHIN viewport → blank
    {
      const result = buildEdgeIndicator(3, 2, depthLimit, maxColumns, mutedColor, true);
      expect(result.char).toBe("  ");
    }

    // 5d: Node at left edge of viewport → blank
    {
      const result = buildEdgeIndicator(2, 2, depthLimit, maxColumns, mutedColor, true);
      expect(result.char).toBe("  ");
    }

    // 5e: Node at right edge → blank
    {
      const result = buildEdgeIndicator(5, 2, depthLimit, maxColumns, mutedColor, true);
      expect(result.char).toBe("  ");
    }

    // 5f: Connector row → always blank
    {
      const result = buildEdgeIndicator(0, 2, depthLimit, maxColumns, mutedColor, false);
      expect(result.char).toBe("  ");
    }

    // 5g: Viewport not active → blank
    {
      const result = buildEdgeIndicator(5, 0, maxColumns, maxColumns, mutedColor, true);
      expect(result.char).toBe("  ");
    }

    // 5h: Node exactly at viewportEnd → ▶
    {
      const result = buildEdgeIndicator(6, 2, depthLimit, maxColumns, mutedColor, true);
      expect(result.char).toBe(" ▶");
    }
  });

  test("No slicing when viewport covers full width", () => {
    const commits = [makeCommit("a", ["b"], [{ name: "main", type: "branch", isCurrent: true }]), makeCommit("b", [])];

    const rows = buildGraph(commits);
    printGraph(rows);
    const maxCols = getMaxGraphColumns(rows);
    const opts: RenderOptions = { padToColumns: maxCols };

    const row = rows[0];
    const fullChars = renderGraphRow(row, opts);
    const sliced = sliceGraphToViewport(fullChars, 0, maxCols, row, opts);

    expect(sliced).toBe(fullChars);
  });

  test("Node at high column triggers rightward shift", () => {
    const commits = [
      makeCommit("m1", ["m2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("f1", ["b1"], [{ name: "f1", type: "branch", isCurrent: false }]),
      makeCommit("f2", ["b1"], [{ name: "f2", type: "branch", isCurrent: false }]),
      makeCommit("f3", ["b1"], [{ name: "f3", type: "branch", isCurrent: false }]),
      makeCommit("f4", ["b1"], [{ name: "f4", type: "branch", isCurrent: false }]),
      makeCommit("f5", ["b1"], [{ name: "f5", type: "branch", isCurrent: false }]),
      makeCommit("m2", ["b1"]),
      makeCommit("b1", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const maxCols = getMaxGraphColumns(rows);
    const depthLimit = 4;

    if (maxCols > depthLimit) {
      let offset = 0;
      let maxNodeCol = 0;
      let maxNodeOffset = 0;
      for (const row of rows) {
        offset = computeSingleViewportOffset(offset, row.nodeColumn, depthLimit, maxCols);
        if (row.nodeColumn > maxNodeCol) {
          maxNodeCol = row.nodeColumn;
          maxNodeOffset = offset;
        }
      }

      if (maxNodeCol >= depthLimit) {
        expect(maxNodeOffset).toBeGreaterThan(0);
        expect(maxNodeCol >= maxNodeOffset && maxNodeCol < maxNodeOffset + depthLimit).toBe(true);
      }
    }
  });

  test("Connector row slicing", () => {
    const commits = [
      makeCommit("c1", ["c2"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("f1", ["c3"], [{ name: "f1", type: "branch", isCurrent: false }]),
      makeCommit("f2", ["c3"], [{ name: "f2", type: "branch", isCurrent: false }]),
      makeCommit("c2", ["c3"]),
      makeCommit("c3", []),
    ];

    const rows = buildGraph(commits);
    printGraph(rows);
    const maxCols = getMaxGraphColumns(rows);
    const opts: RenderOptions = { padToColumns: maxCols };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const connChars = renderConnectorRow(row, opts);
      const depthLimit = 2;
      const sliced = sliceGraphToViewport(connChars, 0, depthLimit, row, opts);

      let slicedWidth = 0;
      for (const gc of sliced) slicedWidth += gc.char.length;
      expect(slicedWidth).toBe(depthLimit * 2);
    }
  });

  test("Single viewport offset (reactive scrolling)", () => {
    const depthLimit = 4;
    const maxColumns = 12;

    let offset = computeSingleViewportOffset(0, 0, depthLimit, maxColumns);
    expect(offset).toBe(0);

    offset = computeSingleViewportOffset(offset, 3, depthLimit, maxColumns);
    expect(offset).toBe(0);

    offset = computeSingleViewportOffset(offset, 5, depthLimit, maxColumns);
    expect(offset).toBeGreaterThan(0);
    expect(5 >= offset && 5 < offset + depthLimit).toBe(true);

    offset = computeSingleViewportOffset(offset, 10, depthLimit, maxColumns);
    expect(10 >= offset && 10 < offset + depthLimit).toBe(true);
    expect(offset).toBeLessThanOrEqual(maxColumns - depthLimit);

    offset = computeSingleViewportOffset(offset, 0, depthLimit, maxColumns);
    expect(0 >= offset && 0 < offset + depthLimit).toBe(true);

    offset = computeSingleViewportOffset(5, 10, maxColumns, maxColumns);
    expect(offset).toBe(0);
  });
});
