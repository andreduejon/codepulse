/**
 * Test: lane colors are decoupled from column indices.
 *
 * When lanes reuse interior null slots, they should get fresh sequential
 * color indices rather than inheriting the color of the column position.
 * This prevents visually incorrect connector colors.
 */
import { describe, expect, test } from "bun:test";
import { buildGraph, getColorForColumn, renderGraphRow } from "../src/git/graph";
import { assertDefined, findRow, makeCommit, printGraph } from "./test-helpers";

describe("Lane Color Consistency", () => {
  test("New lane at reused interior slot gets fresh color", () => {
    const commits = [
      makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("C", ["D"], []),
      makeCommit("D", ["F", "E"], []),
      makeCommit("E", ["F"], [{ name: "hotfix", type: "branch", isCurrent: false }]),
      makeCommit("F", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const rowB = rows.find(r => r.commit.hash === "B");
    assertDefined(rowB, "rowB");

    const bNodeColor = rowB.nodeColor;

    const rowD = findRow(rows, "D");

    const branchCorner = rowD.connectors.find(c => c.type === "corner-top-right" || c.type === "corner-top-left");
    expect(branchCorner).toBeDefined();

    if (branchCorner) {
      expect(branchCorner.color).not.toBe(bNodeColor);
    }

    const rowA = findRow(rows, "A");
    const rowE = findRow(rows, "E");
    expect(rowA.nodeColor).not.toBe(rowE.nodeColor);
  });

  test("Color indices increase monotonically across lanes", () => {
    const commits = [
      makeCommit("A", ["D"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("B", ["D"], [{ name: "feat1", type: "branch", isCurrent: false }]),
      makeCommit("C", ["D"], [{ name: "feat2", type: "branch", isCurrent: false }]),
      makeCommit("D", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    expect(rows[0].nodeColor).not.toBe(rows[1].nodeColor);
    expect(rows[0].nodeColor).not.toBe(rows[2].nodeColor);
    expect(rows[1].nodeColor).not.toBe(rows[2].nodeColor);
  });

  test("Straight connector colors match lane color, not column index", () => {
    const commits = [
      makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("C", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const rowB = findRow(rows, "B");
    const straightAtCol0 = rowB.connectors.find(c => c.type === "straight" && c.column === 0);
    expect(straightAtCol0).toBeDefined();

    if (straightAtCol0) {
      const rowA = findRow(rows, "A");
      expect(straightAtCol0.color).toBe(rowA.nodeColor);
    }
  });

  test("GraphColumn.color matches lane color (not column index)", () => {
    const commits = [
      makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("C", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const rowB = findRow(rows, "B");
    const rowA = findRow(rows, "A");

    expect(rowB.columns.length).toBeGreaterThanOrEqual(2);

    if (rowB.columns.length >= 2) {
      expect(rowB.columns[0].color).toBe(rowA.nodeColor);
      expect(rowB.columns[1].color).toBe(rowB.nodeColor);
    }
  });

  test("Rendered graph row uses correct hex colors from lane colors", () => {
    const COLORS = [
      "#f38ba8",
      "#a6e3a1",
      "#89b4fa",
      "#f9e2af",
      "#cba6f7",
      "#94e2d5",
      "#fab387",
      "#74c7ec",
      "#f2cdcd",
      "#89dceb",
      "#b4befe",
      "#eba0ac",
    ];
    const commits = [
      makeCommit("A", ["C"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("B", ["C"], [{ name: "feature", type: "branch", isCurrent: false }]),
      makeCommit("C", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);
    const rowA = findRow(rows, "A");
    const rendered = renderGraphRow(rowA, { themeColors: COLORS });

    const nodeGlyph = rendered.find(gc => gc.char.includes("█"));
    expect(nodeGlyph).toBeDefined();
    if (nodeGlyph) {
      const expectedColor = getColorForColumn(rowA.nodeColor, COLORS);
      expect(nodeGlyph.color).toBe(expectedColor);
    }
  });

  test("Interior null slot reuse - new lane gets fresh color", () => {
    const commits = [
      makeCommit("A", ["B"], [{ name: "main", type: "branch", isCurrent: true }]),
      makeCommit("B1", ["D"], [{ name: "f1", type: "branch", isCurrent: false }]),
      makeCommit("B2", ["D"], [{ name: "f2", type: "branch", isCurrent: false }]),
      makeCommit("B3", ["D"], [{ name: "f3", type: "branch", isCurrent: false }]),
      makeCommit("B4", ["D"], [{ name: "f4", type: "branch", isCurrent: false }]),
      makeCommit("B", ["D", "E"], []), // merge commit — opens lane for E
      makeCommit("E", ["D"], [{ name: "hotfix", type: "branch", isCurrent: false }]),
      makeCommit("D", [], []),
    ];
    const rows = buildGraph(commits);
    printGraph(rows);

    const rowB = findRow(rows, "B");
    const rowB4 = findRow(rows, "B4");

    const branchCorner = rowB.connectors.find(c => c.type === "corner-top-right" || c.type === "corner-top-left");
    expect(branchCorner).toBeDefined();

    if (branchCorner) {
      expect(branchCorner.color).not.toBe(rowB4.nodeColor);
    }
  });
});
