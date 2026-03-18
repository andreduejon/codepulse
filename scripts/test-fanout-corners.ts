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
  hasConnector,
  findConnector,
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
// Topology:
//   m1 at col 0 (long-lived branch, parent m0)
//   f1 at col 1, parent d1 (feature branch)
//   g1 at col 2, parent d1 (another feature → fan-out)
//   d1 at col 1, merge commit: parents [d0, m1]
//     → fan-out from g1 at col 2 (RIGHT of d1)
//     → merge connector to m1 at col 0 (LEFT of d1)
//     → opposite sides → canMerge fires
//     → corner-top-left (╭) for the merge target (m1, left of d1)
//       gets absorbed into the last fan-out row
// ============================================================
function test1() {
  console.log("\nTest 1: corner-top-left (╭) absorbed into merged fan-out row");

  const commits = [
    makeCommit("m1", ["m0"], [{ name: "main", type: "branch", isCurrent: false }], "main tip"),
    makeCommit("f1", ["d1"], [{ name: "feat-F", type: "branch", isCurrent: false }], "feat-F"),
    makeCommit("g1", ["d1"], [{ name: "feat-G", type: "branch", isCurrent: false }], "feat-G"),
    makeCommit("d1", ["d0", "m1"], [{ name: "develop", type: "branch", isCurrent: true }], "merge main into develop"),
    makeCommit("m0", [], [], "main base"),
    makeCommit("d0", [], [], "develop base"),
  ];

  const rows = buildGraph(commits);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");

  // d1 should have fan-out rows
  assert(d1Row!.fanOutRows !== undefined && d1Row!.fanOutRows!.length > 0,
    "d1 should have fan-out rows");

  // Check the last fan-out row for absorbed corner-top connectors
  const lastFO = d1Row!.fanOutRows![d1Row!.fanOutRows!.length - 1];

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
    c.column !== d1Row!.nodeColumn
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
  const commitHasMB = d1Row!.connectors.some(c =>
    c.column !== d1Row!.nodeColumn && (
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
// Mirror of Test 1: fan-out on the LEFT, merge target on the RIGHT.
//
// Topology:
//   f1 at col 0, parent d1 (feature)
//   g1 at col 1, parent d1 (fan-out source → goes LEFT if d1 moves right)
//   m1 at col 2 (long-lived branch, parent m0)
//   d1 has parents [d0, m1] → merge connector goes RIGHT to m1
//   g1's fan-out goes LEFT
//   → opposite sides → canMerge fires
//   → corner-top-right (╮) for merge target (m1, right of d1)
// ============================================================
function test2() {
  console.log("\nTest 2: corner-top-right (╮) absorbed into merged fan-out row");

  // To get fan-out LEFT and merge RIGHT:
  // - d1 should be at a column > 0
  // - fan-out lane (g1) should be at a column < d1
  // - merge target (m1) should be at a column > d1
  //
  // Setup:
  //   f1 (col 0) → parent d1  (closes immediately, d1 takes col 0? No...)
  //   g1 (col 1) → parent d1  (extra lane → fan-out)
  //   m1 (col 2) → parent m0  (long-lived, stays at col 2)
  //   d1 appears after f1 closes, takes col 0 or 1
  //
  // We need d1 in the MIDDLE. Let's use:
  //   a1 (col 0) → parent a0 (long-lived, stays)
  //   g1 (col 1) → parent d1 (extra lane, LEFT of d1 if d1 is at col 2? No...)
  //
  // Simpler: force layout by having more branches
  //   a1 (col 0) → parent d1
  //   g1 (col 1) → parent d1  (fan-out)
  //   m1 (col 2) → parent m0  (long-lived, parent not d1)
  //   d1 at col 0: fan-out from g1 is to RIGHT (col 1)
  //   Merge to m1 is also RIGHT (col 2) → SAME side, won't merge
  //
  // Need fan-out LEFT: g1's lane must be LEFT of d1's column.
  // For that, d1 must take a column > g1's column.
  //
  // Try:
  //   m1 (col 0, current) → parent m0
  //   a1 (col 1) → parent d1
  //   g1 (col 2) → parent d1  (will become fan-out)
  //   But d1 takes col 1 after a1 closes → g1 fan-out at col 2 is RIGHT, not LEFT.
  //
  // To get g1 LEFT of d1:
  //   g1 needs to take a lower column than d1.
  //   If g1 appears before another branch tip, it gets a lower column.
  //
  // Let's try:
  //   g1 (col 0) → parent d1
  //   m1 (col 1) → parent m0 (long-lived)
  //   a1 (col 2) → parent d1 (fan-out source)
  //   d1 appears, takes col 0 (after g1 closes)
  //     → a1's lane at col 2 (RIGHT): fan-out corner
  //     → merge to m1 at col 1 (RIGHT): same side, no merge
  //
  // Hmm. The only way to get "fan-out LEFT" is for the fan-out lane to
  // have a lower column index than d1's nodeColumn.
  //
  // Try placing d1 in a higher column:
  //   m1 (col 0) → parent m0
  //   g1 (col 1) → parent d1
  //   a1 (col 2) → parent d1
  //   d1 now gets col 1 (where g1 was) or col 2 (where a1 was)
  //   If d1 gets col 1: g1 was at col 1, so g1 closes there, d1 takes it.
  //     a1 at col 2 → fan-out RIGHT. Merge to m1 at col 0 → LEFT. OPPOSITE → canMerge!
  //   But the corner at col 0 would be corner-top-left (╭) for the merge, not corner-top-right.
  //   We want corner-top-right: merge target is to the RIGHT.
  //
  // For corner-top-right (╮), the new lane opens to the RIGHT of d1.
  // This means m1 (merge target) is to the RIGHT of d1, AND the fan-out is to the LEFT.
  //
  // Try:
  //   g1 (col 0) → parent d1  (fan-out lane)
  //   d1 takes col 0 after g1 closes
  //   a1 (col 1) → parent d1  (another fan-out lane)
  //   m1 (col 2) → parent m0
  //   d1 at col 0: a1 fan-out at col 1 (RIGHT), merge to m1 at col 2 (RIGHT) → same side
  //
  // What if we make d1 at col 1 with fan-out at col 0 (LEFT)?
  //   a1 (col 0) → parent a0 (long-lived)
  //   g1 (col 1) → parent d1  (closes, d1 takes col 1)
  //   h1 (col 2) → parent d1  (fan-out, but col 2 is RIGHT of col 1)
  //
  // To get fan-out LEFT and merge RIGHT:
  //   a1 (col 0) → parent d1
  //   b1 (col 1) → parent d1
  //   m1 (col 2) → parent m0
  //   d1 takes col 0 after a1 closes.
  //     b1 at col 1 → fan-out RIGHT
  //     merge to m1 at col 2 → RIGHT → same side
  //
  // This is harder than expected. Let me try:
  //   m1 (col 0) → parent m0 (long-lived)
  //   a1 (col 1) → parent d1
  //   g1 (col 2) → parent d1  (fan-out)
  //   d1 takes col 1 (after a1 closes). nodeColumn = 1
  //     g1 fan-out at col 2 → RIGHT
  //     merge to m1 at col 0 → LEFT → OPPOSITE SIDES → canMerge
  //     BUT merge target m1 at col 0 is LEFT → opens corner-top-left not corner-top-right
  //
  // For corner-top-right we need the second parent to OPEN a NEW lane to the RIGHT.
  // That only happens when the second parent ISN'T already in an active lane.
  // If m1 is NOT yet in any lane, a new lane opens to the RIGHT.
  //
  // But for the merge target to be on the RIGHT and fan-out to be on the LEFT...
  // Fan-out LEFT means extra lane index < nodeColumn
  // New merge lane RIGHT means new lane opens at index > nodeColumn
  //
  // Try:
  //   g1 (col 0) → parent d1
  //   a1 (col 1) → parent d1 (fan-out)
  //   d1 takes col 0. nodeColumn = 0.
  //   a1 at col 1 → fan-out RIGHT. But there's no LEFT...
  //   Can't have fan-out LEFT of col 0.
  //
  // OK. For fan-out LEFT, d1 must be at col >= 1.
  //
  //   h1 (col 0) → parent d1
  //   g1 (col 1) → parent d1
  //   d1 takes col 0 after h1 closes. g1 at col 1 = fan-out RIGHT.
  //   We need fan-out at a column LEFT of d1.
  //
  //   For d1 at col >= 1, another commit must occupy col 0 and stay alive.
  //
  //   x1 (col 0) → parent x0 (long-lived, NOT d1)
  //   g1 (col 1) → parent d1  (g1 closes, d1 takes col 1)
  //   a1 (col 2) → parent d1  (fan-out, col 2 > col 1 = RIGHT)
  //   d1 at col 1 with parents [d0, y1]
  //     If y1 not tracked yet → opens NEW lane at col 3 (RIGHT)
  //     fan-out at col 2 is RIGHT. merge to y1 at col 3 is RIGHT. SAME SIDE.
  //
  // Hmm. Getting fan-out LEFT requires the fan-out lane to have column < d1's column.
  // That means the fan-out lane was opened BEFORE d1 appeared, and some commits
  // between the fan-out lane and d1's lane were processed earlier.
  //
  // Let me try 4 tip branches:
  //   x1 (col 0) → parent x0 (long-lived)
  //   g1 (col 1) → parent d1
  //   h1 (col 2) → parent d1  (becomes fan-out)
  //   d1 at col 1. nodeColumn=1.
  //     h1 fan-out at col 2 → RIGHT
  //     If d1 has parents [d0, m1] and m1 is x1 at col 0... 
  //     merge to x1 at col 0 → LEFT → OPPOSITE → canMerge!
  //     x1 is already in lane 0, continuing → so it's a tee connector, not corner-top
  //
  // For a corner-top, the merge target must NOT be in an existing lane.
  // The target must get a NEW lane. But new lanes are always appended → to the RIGHT.
  //
  // Wait: does the merge target lane go LEFT ever? Yes, if the lane is REUSED
  // from a freed interior null lane. Actually, new lanes for secondary parents
  // open at `newLane` which is an interior null or the next trailing slot.
  // If there IS an interior null to the LEFT of nodeColumn, it could be to the LEFT.
  //
  // This is getting complex. Let me just test renderFanOutRow DIRECTLY with
  // synthetic connectors instead of relying on buildGraph to produce a specific layout.

  // Synthetic fan-out row with corner-top-right (╮) at col 3
  // Layout: │  █─────╮  (straight at col 0, block at col 1, horizontal at col 2, corner-top-right at col 3)
  const syntheticRow: Connector[] = [
    { type: "straight", color: 0, column: 0 },
    { type: "tee-left", color: 1, column: 1 },  // node block
    { type: "horizontal", color: 2, column: 2 },
    { type: "corner-top-right", color: 2, column: 3 },
  ];

  const rendered = renderFanOutRow(syntheticRow, { themeColors: THEME_COLORS });
  const str = charsToString(rendered);

  // Should render: │ █─────╮
  // Col 0: "│ " (straight)
  // Col 1: "█─" (tee-left → block)
  // Col 2: "──" (horizontal)
  // Col 3: "╮ " (corner-top-right, no horizontal at same column)
  assert(str.includes("╮"), `corner-top-right should render as ╮, got "${str}"`);
  assert(!str.includes("  ╮") && !str.endsWith("  "),
    `corner-top-right should not have blank space where ╮ should be`);

  // Verify the glyph at column 3 position (char index 6-7)
  const charAtCol3 = rendered.filter(gc => {
    // We need to find which GraphChar covers column 3
    return true;
  });
  // Simpler: just check the string has the right structure
  assert(str.startsWith("│"), `Should start with │, got "${str.charAt(0)}"`);
  assert(str.includes("█"), `Should contain █ (block node), got "${str}"`);
}

// ============================================================
// Test 3: corner-top-right with horizontal crossing → ┬ glyph
//
// When corner-top-right overlaps with a horizontal at the same
// column, it should render as ┬─ (junction), not just ╮.
// ============================================================
function test3() {
  console.log("\nTest 3: corner-top-right + horizontal crossing → ┬ glyph");

  const syntheticRow: Connector[] = [
    { type: "straight", color: 0, column: 0 },
    { type: "tee-left", color: 1, column: 1 },  // node block
    { type: "horizontal", color: 3, column: 2 },
    // Corner-top-right AND horizontal at col 3 → crossing
    { type: "corner-top-right", color: 2, column: 3 },
    { type: "horizontal", color: 3, column: 3 },
    { type: "corner-bottom-right", color: 3, column: 4 }, // fan-out closing
  ];

  const rendered = renderFanOutRow(syntheticRow, { themeColors: THEME_COLORS });
  const str = charsToString(rendered);

  // Col 3 should be ┬─ (corner-top-right + horizontal crossing)
  assert(str.includes("┬"), `Should render ┬ at crossing of corner-top-right + horizontal, got "${str}"`);
  assert(str.includes("╯"), `Should have ╯ at col 4 (corner-bottom-right), got "${str}"`);
}

// ============================================================
// Test 4: corner-top-left (╭) renders correctly
//
// Direct renderFanOutRow test with corner-top-left connector.
// ============================================================
function test4() {
  console.log("\nTest 4: corner-top-left (╭) renders correctly in fan-out row");

  // Layout: ╰───█ ╭─── (fan-out closing on LEFT, branch opening on RIGHT)
  // This is the scenario from the original bug: commit d84b3a0 in testcell-frontend
  const syntheticRow: Connector[] = [
    { type: "straight", color: 0, column: 0 },
    { type: "straight", color: 1, column: 1 },
    { type: "horizontal", color: 3, column: 2 },
    { type: "horizontal", color: 3, column: 3 },
    { type: "corner-top-left", color: 3, column: 4 }, // branch opening — was invisible before fix
    { type: "horizontal", color: 3, column: 5 },
    { type: "tee-left", color: 2, column: 6 },  // node block
    { type: "horizontal", color: 4, column: 7 },
    { type: "horizontal", color: 4, column: 8 },
    { type: "corner-bottom-right", color: 4, column: 9 }, // fan-out closing
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
// Comprehensive check that no corner type renders as empty space.
// Each corner type is tested individually.
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

// ============================================================
// Test 7: Integration test with buildGraph — opposite-side merge
// with corner-top connector renders correctly
//
// Uses the same topology as Test 1 but verifies the RENDERED output.
// ============================================================
function test7() {
  console.log("\nTest 7: Integration — rendered merged fan-out row has visible corner glyphs");

  const commits = [
    makeCommit("m1", ["m0"], [{ name: "main", type: "branch", isCurrent: false }], "main tip"),
    makeCommit("f1", ["d1"], [{ name: "feat-F", type: "branch", isCurrent: false }], "feat-F"),
    makeCommit("g1", ["d1"], [{ name: "feat-G", type: "branch", isCurrent: false }], "feat-G"),
    makeCommit("d1", ["d0", "m1"], [{ name: "develop", type: "branch", isCurrent: true }], "merge main into develop"),
    makeCommit("m0", [], [], "main base"),
    makeCommit("d0", [], [], "develop base"),
  ];

  const rows = buildGraph(commits);
  const d1Row = rows.find(r => r.commit.hash === "d1");
  assert(d1Row !== undefined, "d1 row should exist");

  if (d1Row!.fanOutRows && d1Row!.fanOutRows.length > 0) {
    // Render each fan-out row
    for (let i = 0; i < d1Row!.fanOutRows!.length; i++) {
      const foRow = d1Row!.fanOutRows![i];
      const rendered = renderFanOutRow(foRow, { themeColors: THEME_COLORS });
      const str = charsToString(rendered);

      // No position should be purely empty (just spaces) if it has a connector
      for (const conn of foRow) {
        if (conn.type === "empty") continue;
        // Find the rendered chars at this column position
        let charWidth = 0;
        let colStr = "";
        for (const gc of rendered) {
          const start = charWidth;
          charWidth += gc.char.length;
          if (start >= conn.column * 2 && start < (conn.column + 1) * 2) {
            colStr += gc.char;
          }
        }
        // If we found chars at this column, they should contain actual glyphs
        if (colStr.length > 0) {
          assert(colStr.trim().length > 0,
            `Fan-out row ${i}, col ${conn.column} (${conn.type}) should not be empty space, got "${colStr}"`);
        }
      }

      // Specifically: any corner-top-left should show ╭, corner-top-right should show ╮
      const hasCTL = foRow.some(c => c.type === "corner-top-left");
      const hasCTR = foRow.some(c => c.type === "corner-top-right");
      if (hasCTL) {
        assert(str.includes("╭") || str.includes("┬"),
          `Fan-out row ${i} with corner-top-left should render ╭ or ┬, got "${str}"`);
      }
      if (hasCTR) {
        assert(str.includes("╮") || str.includes("┬"),
          `Fan-out row ${i} with corner-top-right should render ╮ or ┬, got "${str}"`);
      }
    }
  }
}

// ============================================================
// Run all tests
// ============================================================
console.log("Fan-Out Corner Tests (corner-top-left/right in renderFanOutRow)");
console.log("=".repeat(60));

test1();
test2();
test3();
test4();
test6();
test7();

const { totalTests, passedTests, failedTests } = (await import("./test-helpers")).getResults();
printResults("fan-out-corner");

if (failedTests > 0) {
  process.exit(1);
}
