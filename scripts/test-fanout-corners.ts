#!/usr/bin/env bun
/**
 * Test script: verifies that corner-top-left (╭) and corner-top-right (╮)
 * connectors render correctly in fan-out rows.
 *
 * This tests the fix for the bug where renderFanOutRow only handled
 * corner-bottom-* types. When the fan-out+commit-row merge optimization
 * absorbs corner-top-* connectors from the commit row into the last
 * fan-out row, they must render correctly (not as empty space).
 */
import { buildGraph, renderFanOutRow, type GraphChar } from "../src/git/graph";
import type { Connector } from "../src/git/types";
import {
  makeCommit,
  assert,
  printResults,
  runTest,
  printGraph,
} from "./test-helpers";

const THEME_COLORS = [
  "#c0c001", "#c0c002", "#c0c003", "#c0c004",
  "#c0c005", "#c0c006", "#c0c007", "#c0c008",
];

function charsToString(chars: GraphChar[]): string {
  return chars.map(c => c.char).join("");
}

// ============================================================
// Test 1: corner-top-left (╭) absorbed into fan-out row
//
// Graph (buildGraph output):
//   col: 0  1  2
//   ─────────────
//        █        t1  (trunk)
//        │
//        │  █     x1  (hotfix-X)
//        │  │
//        │  │  █  y1  (hotfix-Y)
//        │  │  │
//        █─█─╯    r1  (release, merge: parents [r0, t1])
//        │  │
//        █  │     t0
//           │
//           █     r0
//
// The fan-out+commit-row merge optimization absorbs the merge
// connector into the last fan-out row.
// ============================================================
function test1() {
  console.log("\nTest 1: corner-top-left (╭) absorbed into merged fan-out row");

  const commits = [
    makeCommit("t1", ["t0"], [{ name: "trunk", type: "branch", isCurrent: false }], "trunk tip"),
    makeCommit("x1", ["r1"], [{ name: "hotfix-X", type: "branch", isCurrent: false }], "hotfix-X"),
    makeCommit("y1", ["r1"], [{ name: "hotfix-Y", type: "branch", isCurrent: false }], "hotfix-Y"),
    makeCommit("r1", ["r0", "t1"], [{ name: "release", type: "branch", isCurrent: true }], "merge trunk into release"),
    makeCommit("t0", [], [], "trunk base"),
    makeCommit("r0", [], [], "release base"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
  const r1Row = rows.find(r => r.commit.hash === "r1");
  assert(r1Row !== undefined, "r1 row should exist");

  // r1 should have fan-out rows
  assert(r1Row.fanOutRows !== undefined && r1Row.fanOutRows.length > 0,
    "r1 should have fan-out rows");

  // Check the last fan-out row for absorbed corner-top connectors
  const lastFO = r1Row.fanOutRows.at(-1);
  assert(lastFO !== undefined, "r1 should have a last fan-out row");

  // Should have a corner-bottom-right or corner-bottom-left (from fan-out closing)
  const foCorner = lastFO.find(c =>
    c.type === "corner-bottom-right" || c.type === "corner-bottom-left"
  );
  assert(foCorner !== undefined, "Last fan-out row should have a bottom corner (fan-out closing)");

  // Should ALSO have a corner-top-left or corner-top-right (from absorbed merge connector)
  const topCorner = lastFO.find(c =>
    c.type === "corner-top-left" || c.type === "corner-top-right"
  );

  // It could also be a tee-left or tee-right if the merge target lane continues
  const teeAtMerge = lastFO.find(c =>
    (c.type === "tee-left" || c.type === "tee-right") &&
    c.column !== r1Row.nodeColumn
  );

  const hasAbsorbedMerge = topCorner !== undefined || teeAtMerge !== undefined;
  assert(hasAbsorbedMerge,
    "Last fan-out row should have an absorbed merge connector (corner-top or tee)");

  // Now render the fan-out row and check the output doesn't have blank spots
  const rendered = renderFanOutRow(lastFO, { themeColors: THEME_COLORS });
  const str = charsToString(rendered);

  // The rendered string should NOT have "  " at the position of the absorbed connector
  // (that was the original bug — corner-top-* rendered as empty space)
  if (topCorner) {
    // Find the position in the rendered string for this column
    // Each column is 2 chars wide
    const colPos = topCorner.column * 2;
    const glyphAtCol = str.slice(colPos, colPos + 2).trim();
    assert(glyphAtCol.length > 0,
      `Absorbed corner-top at col ${topCorner.column} should render a glyph, not empty space`);
    assert(glyphAtCol.includes("╭") || glyphAtCol.includes("╮") || glyphAtCol.includes("┬"),
      `Absorbed corner-top should render as ╭, ╮, or ┬, got "${glyphAtCol}"`);
  }

  // Verify the commit row itself no longer has the merge connectors (they were stripped)
  const commitHasMB = r1Row.connectors.some(c =>
    c.column !== r1Row.nodeColumn && (
      c.type === "horizontal" || c.type === "tee-left" || c.type === "tee-right" ||
      c.type === "corner-top-right" || c.type === "corner-top-left"
    )
  );
  assert(!commitHasMB,
    "Commit row merge connectors should be stripped (absorbed into fan-out)");
}

// ============================================================
// Test 2: corner-top-right (╮) absorbed into fan-out row
//
// Synthetic connector layout (no buildGraph):
//   col: 0  1  2  3
//   ─────────────────
//        │  █──╮
//
// Connectors:
//   col 0: straight  → "│ "
//   col 1: tee-left  → "█─"  (fan-out node block)
//   col 2: horizontal → "──"
//   col 3: corner-top-right → "╮ "
//
// Verifies that ╮ renders as a visible glyph (not blank space).
// ============================================================
function test2() {
  console.log("\nTest 2: corner-top-right (╮) absorbed into merged fan-out row");

  // Synthetic fan-out row with corner-top-right (╮) at col 3
  // Layout: │  █──╮
  const syntheticRow: Connector[] = [
    { type: "straight", color: 0, column: 0 },
    { type: "tee-left", color: 1, column: 1 },
    { type: "horizontal", color: 2, column: 2 },
    { type: "corner-top-right", color: 2, column: 3 },
  ];

  const rendered = renderFanOutRow(syntheticRow, { themeColors: THEME_COLORS });
  const str = charsToString(rendered);

  // Should render: │ █───╮
  // Col 0: "│ "  Col 1: "█─"  Col 2: "──"  Col 3: "╮ "
  assert(str.includes("╮"), `corner-top-right should render as ╮, got "${str}"`);
  assert(!str.includes("  ╮") && !str.endsWith("  "),
    `corner-top-right should not have blank space where ╮ should be`);

  // Verify the string has the right structure
  assert(str.startsWith("│"), `Should start with │, got "${str.charAt(0)}"`);
  assert(str.includes("█"), `Should contain █ (block node), got "${str}"`);
}

// ============================================================
// Test 3: corner-top-right with horizontal crossing → ┬ glyph
//
// Synthetic connector layout (no buildGraph):
//   col: 0  1  2  3  4
//   ─────────────────────
//        │  █──┬──╯
//
// Connectors:
//   col 0: straight          → "│ "
//   col 1: tee-left          → "█─"
//   col 2: horizontal        → "──"
//   col 3: corner-top-right  → "┬─"  (╮ + horizontal crossing = ┬)
//        + horizontal
//   col 4: corner-bottom-right → "╯ "  (fan-out closing)
//
// Verifies that overlapping corner-top-right + horizontal at the
// same column renders as the ┬ junction glyph.
// ============================================================
function test3() {
  console.log("\nTest 3: corner-top-right + horizontal crossing → ┬ glyph");

  const syntheticRow: Connector[] = [
    { type: "straight", color: 0, column: 0 },
    { type: "tee-left", color: 1, column: 1 },
    { type: "horizontal", color: 3, column: 2 },
    { type: "corner-top-right", color: 2, column: 3 },
    { type: "horizontal", color: 3, column: 3 },
    { type: "corner-bottom-right", color: 3, column: 4 },
  ];

  const rendered = renderFanOutRow(syntheticRow, { themeColors: THEME_COLORS });
  const str = charsToString(rendered);

  // Col 3 should be ┬─ (corner-top-right + horizontal = junction)
  assert(str.includes("┬"), `Should render ┬ at crossing of corner-top-right + horizontal, got "${str}"`);
  assert(str.includes("╯"), `Should have ╯ at col 4, got "${str}"`);
}

// ============================================================
// Test 4: corner-top-left (╭) renders correctly
//
// Synthetic connector layout (no buildGraph):
//   col: 0  1  2  3  4  5  6  7  8  9
//   ────────────────────────────────────
//        │  │  ────╭──█──────╯
//
// Connectors:
//   col 0: straight          → "│ "
//   col 1: straight          → "│ "
//   col 2: horizontal        → "──"
//   col 3: horizontal        → "──"
//   col 4: corner-top-left   → "╭─"  (branch opening — was invisible before fix)
//   col 5: horizontal        → "──"
//   col 6: tee-left          → "█─"  (fan-out node block)
//   col 7: horizontal        → "──"
//   col 8: horizontal        → "──"
//   col 9: corner-bottom-right → "╯ "  (fan-out closing)
//
// Regression test for the original bug (commit d84b3a0 scenario):
// corner-top-left at col 4 was rendering as empty space.
// ============================================================
function test4() {
  console.log("\nTest 4: corner-top-left (╭) renders correctly in fan-out row");

  // Layout: │  │  ────╭──█──────╯
  const syntheticRow: Connector[] = [
    { type: "straight", color: 0, column: 0 },
    { type: "straight", color: 1, column: 1 },
    { type: "horizontal", color: 3, column: 2 },
    { type: "horizontal", color: 3, column: 3 },
    { type: "corner-top-left", color: 3, column: 4 },
    { type: "horizontal", color: 3, column: 5 },
    { type: "tee-left", color: 2, column: 6 },
    { type: "horizontal", color: 4, column: 7 },
    { type: "horizontal", color: 4, column: 8 },
    { type: "corner-bottom-right", color: 4, column: 9 },
  ];

  const rendered = renderFanOutRow(syntheticRow, { themeColors: THEME_COLORS });
  const str = charsToString(rendered);

  // The ╭ at col 4 should be visible
  assert(str.includes("╭"), `corner-top-left should render as ╭, got "${str}"`);

  // Check the position: col 4 means char position ~8
  // Let's accumulate char widths to find the right position
  let pos = 0;
  let foundCorner = false;
  for (const gc of rendered) {
    if (gc.char.includes("╭")) {
      foundCorner = true;
      break;
    }
    pos += gc.char.length;
  }
  assert(foundCorner, `╭ glyph should be present in rendered output`);
}

// ============================================================
// Test 6: Verify renderFanOutRow handles all corner types
//
// Synthetic single-connector layouts (no buildGraph):
//   Each corner type is rendered alone at col 0:
//
//   corner-bottom-right → "╯ "
//   corner-bottom-left  → "╰─"
//   corner-top-right    → "╮ "
//   corner-top-left     → "╭─"
//
// Comprehensive check that no corner type renders as empty space.
// ============================================================
function test6() {
  console.log("\nTest 6: All corner types render non-empty in fan-out row");

  const cornerTypes: Array<{ type: string; glyph: string }> = [
    { type: "corner-bottom-right", glyph: "╯" },
    { type: "corner-bottom-left", glyph: "╰" },
    { type: "corner-top-right", glyph: "╮" },
    { type: "corner-top-left", glyph: "╭" },
  ];

  for (const { type, glyph } of cornerTypes) {
    const row: Connector[] = [
      { type: type as any, color: 0, column: 0 },
    ];
    const rendered = renderFanOutRow(row, { themeColors: THEME_COLORS });
    const str = charsToString(rendered);

    assert(str.includes(glyph),
      `${type} should render as ${glyph}, got "${str}"`);
    assert(str.trim().length > 0,
      `${type} should not render as empty space`);
  }
}

/**
 * Assert that every non-empty connector in a fan-out row renders visible
 * glyphs (not blank space) at its column position.
 */
function assertConnectorsVisible(
  connectors: Connector[],
  rendered: GraphChar[],
  rowIndex: number,
) {
  for (const conn of connectors) {
    if (conn.type === "empty") continue;
    let charWidth = 0;
    let colStr = "";
    for (const gc of rendered) {
      const start = charWidth;
      charWidth += gc.char.length;
      if (start >= conn.column * 2 && start < (conn.column + 1) * 2) {
        colStr += gc.char;
      }
    }
    if (colStr.length > 0) {
      assert(colStr.trim().length > 0,
        `Fan-out row ${rowIndex}, col ${conn.column} (${conn.type}) should not be empty space, got "${colStr}"`);
    }
  }
}

// ============================================================
// Test 7: Integration test with buildGraph — opposite-side merge
// with corner-top connector renders correctly
//
// Graph (buildGraph output, same topology as test1 with different branches):
//   col: 0  1  2
//   ─────────────
//        █        p1  (prod)
//        │
//        │  █     h1  (fix-H)
//        │  │
//        │  │  █  k1  (fix-K)
//        │  │  │
//        █─█─╯    s1  (staging, merge: parents [s0, p1])
//        │  │
//        █  │     p0
//           │
//           █     s0
//
// Verifies that all non-empty connectors in the RENDERED fan-out
// rows produce visible glyphs (no blank spaces at glyph positions).
// Also checks that ╭/╮ or ┬ glyphs appear where expected.
// ============================================================
function test7() {
  console.log("\nTest 7: Integration — rendered merged fan-out row has visible corner glyphs");

  const commits = [
    makeCommit("p1", ["p0"], [{ name: "prod", type: "branch", isCurrent: false }], "prod tip"),
    makeCommit("h1", ["s1"], [{ name: "fix-H", type: "branch", isCurrent: false }], "fix-H"),
    makeCommit("k1", ["s1"], [{ name: "fix-K", type: "branch", isCurrent: false }], "fix-K"),
    makeCommit("s1", ["s0", "p1"], [{ name: "staging", type: "branch", isCurrent: true }], "merge prod into staging"),
    makeCommit("p0", [], [], "prod base"),
    makeCommit("s0", [], [], "staging base"),
  ];

  const rows = buildGraph(commits);
  printGraph(rows);
  const s1Row = rows.find(r => r.commit.hash === "s1");
  assert(s1Row !== undefined, "s1 row should exist");
  assert(s1Row.fanOutRows !== undefined && s1Row.fanOutRows.length > 0,
    "s1 should have fan-out rows");

  for (let i = 0; i < s1Row.fanOutRows.length; i++) {
    const foRow = s1Row.fanOutRows[i];
    const rendered = renderFanOutRow(foRow, { themeColors: THEME_COLORS });
    const str = charsToString(rendered);

    // Non-empty connectors must render visible glyphs at their column
    assertConnectorsVisible(foRow, rendered, i);

    // Corner-top-left should show ╭ or ┬
    if (foRow.some(c => c.type === "corner-top-left")) {
      assert(str.includes("╭") || str.includes("┬"),
        `Fan-out row ${i} with corner-top-left should render ╭ or ┬, got "${str}"`);
    }
    // Corner-top-right should show ╮ or ┬
    if (foRow.some(c => c.type === "corner-top-right")) {
      assert(str.includes("╮") || str.includes("┬"),
        `Fan-out row ${i} with corner-top-right should render ╮ or ┬, got "${str}"`);
    }
  }
}

// ============================================================
// Run all tests
// ============================================================
console.log("Fan-Out Corner Tests (corner-top-left/right in renderFanOutRow)");
console.log("=".repeat(60));

runTest(test1);
runTest(test2);
runTest(test3);
runTest(test4);
runTest(test6);
runTest(test7);

const { failedTests } = (await import("./test-helpers")).getResults();
printResults("fan-out-corner");

if (failedTests > 0) {
  process.exit(1);
}
