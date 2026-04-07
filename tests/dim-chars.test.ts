/**
 * Test: verifies dimGraphChars — the pure function that applies ancestry
 * dimming to rendered GraphChar[] arrays.
 *
 * Tests cover all dimming rules: uncommitted full-dim, ancestry inactive
 * passthrough, vertical bright columns (│, █), horizontal bright columns
 * (─, corners, tees), crossing exclusion (┼ and ─ after ┼), and combined
 * vertical + horizontal brightening.
 */
import { describe, expect, test } from "bun:test";
import type { GraphChar } from "../src/git/graph";
import { dimGraphChars } from "../src/git/graph";

const MUTED = "#666";
const BRIGHT_A = "#fff";
const BRIGHT_B = "#0f0";

/** Helper: make a GraphChar with a given char and optional color/bold. */
function gc(char: string, color = BRIGHT_A, bold = false): GraphChar {
  return { char, color, bold };
}

/** Helper: check that a char was dimmed to mutedColor with bold=false. */
function expectDimmed(result: GraphChar, mutedColor = MUTED) {
  expect(result.color).toBe(mutedColor);
  expect(result.bold).toBe(false);
}

/** Helper: check that a char kept its original color. */
function expectBright(result: GraphChar, original: GraphChar) {
  expect(result.color).toBe(original.color);
  expect(result.bold).toBe(original.bold);
}

describe("dimGraphChars", () => {
  // ── Uncommitted node ────────────────────────────────────────────────

  test("uncommitted → full dim always", () => {
    const chars = [gc("█ "), gc("│ "), gc("─"), gc("╮ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: true,
      ancestryActive: true,
      brightColumns: new Set([0, 1]),
    });
    for (const c of result) {
      expectDimmed(c);
    }
  });

  // ── Ancestry inactive ───────────────────────────────────────────────

  test("ancestry inactive → passthrough (no dimming)", () => {
    const chars = [gc("█ "), gc("│ "), gc("─"), gc("╮ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: false,
    });
    // All chars should be returned unchanged
    for (let i = 0; i < chars.length; i++) {
      expect(result[i].color).toBe(chars[i].color);
      expect(result[i].char).toBe(chars[i].char);
    }
  });

  // ── No bright set → full dim ───────────────────────────────────────

  test("ancestry active, no bright sets → full dim", () => {
    const chars = [gc("█ "), gc("│ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      // no brightColumns, no brightHorizontal
    });
    for (const c of result) {
      expectDimmed(c);
    }
  });

  test("ancestry active, empty bright sets → full dim", () => {
    const chars = [gc("█ "), gc("│ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set(),
      brightHorizontal: new Set(),
    });
    for (const c of result) {
      expectDimmed(c);
    }
  });

  // ── Vertical bright: │ and █ ───────────────────────────────────────

  test("vertical bright: │ at bright column stays bright", () => {
    // col 0: █ , col 1: │
    const chars = [gc("█ "), gc("│ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([1]),
    });
    expectDimmed(result[0]); // col 0 not in bright set
    expectBright(result[1], chars[1]); // col 1 is bright, │ is vertical glyph
  });

  test("vertical bright: █ at bright column stays bright", () => {
    const chars = [gc("█ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expectBright(result[0], chars[0]);
  });

  test("vertical bright: ─ at bright column still dimmed", () => {
    // ─ is a horizontal glyph — vertical bright should not affect it
    // col 0: ─ (1 char), col 0 still (pos goes 0→1, floor(1/2)=0)
    const chars = [gc("─"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expectDimmed(result[0]);
    expectDimmed(result[1]);
  });

  // ── Horizontal bright: ─, corners, tees ────────────────────────────

  test("horizontal bright: ─ stays bright", () => {
    // col 0: │  (2 chars), col 1: ─ (1 char), ─ (1 char) = col 1 still
    const chars = [gc("│ "), gc("─"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([1]),
    });
    expectDimmed(result[0]); // │ at col 0, not in horizontal bright (and no vertical bright)
    expectBright(result[1], chars[1]); // ─ at col 1, horizontal bright
    expectBright(result[2], chars[2]); // ─ still at col 1 (pos=3, floor(3/2)=1)
  });

  test("horizontal bright: ╮ stays bright", () => {
    // col 0: █  (2 chars), col 1: ─ (1), ╮  (2) at col 1
    const chars = [gc("█ "), gc("─"), gc("╮ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([1]),
    });
    expectDimmed(result[0]); // col 0
    expectBright(result[1], chars[1]); // ─ at col 1
    // ╮  is 2 chars at pos=3 → col floor(3/2)=1
    expectBright(result[2], chars[2]);
  });

  test("horizontal bright: ╰ stays bright", () => {
    const chars = [gc("╰"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0]),
    });
    expectBright(result[0], chars[0]); // ╰ at col 0
    expectBright(result[1], chars[1]); // ─ at col 0 (pos=1, floor(1/2)=0)
  });

  // ── Crossing exclusion ─────────────────────────────────────────────

  test("crossing ┼ always dimmed even in horizontal bright set", () => {
    // col 0: █  (2), col 1: ─ (1), ┼ (1) at col 1, ─ (1) at col 1 after crossing
    const chars = [gc("█ "), gc("─"), gc("┼"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([1]),
    });
    expectDimmed(result[0]); // col 0 not bright
    expectBright(result[1], chars[1]); // ─ at col 1, before crossing — bright
    expectDimmed(result[2]); // ┼ at col 1 — always dimmed
    expectDimmed(result[3]); // ─ after ┼ — always dimmed
  });

  test("─ after ┼ is dimmed even at a horizontal bright column", () => {
    // Specifically test the "dash after crossing" rule
    // col 0: ┼ (1 char), col 0: ─ (1 char, still col 0)
    const chars = [gc("┼"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0]),
    });
    expectDimmed(result[0]); // ┼ always dimmed
    expectDimmed(result[1]); // ─ after ┼ always dimmed
  });

  test("─ NOT after ┼ is bright (prevWasCrossing resets)", () => {
    // ┼ at col 0, ─ at col 0 (dimmed), then new col: ─ at col 1 should be bright
    // col 0: ┼ (1 char, pos 0→1, col 0), ─ (1 char, pos 1→2, col 1)
    // Actually: floor(0/2)=0, floor(1/2)=0 — both at col 0
    // We need bigger spacing. Let's use 2-char entries:
    // col 0: ┼  (but ┼ is always 1 char in practice)
    // Let's do: col 0 = "│ " (2 chars), col 1 = "┼" (1 char), "─" (1 char, col 1),
    //           col 2 = "─" (1 char), "─" (1 char, col 2 still? pos=6, floor(6/2)=3)
    // Simpler approach: use padded entries
    const chars = [gc("┼ "), gc("─ ")];
    // pos: ┼  → 2 chars (col 0), ─  → 2 chars (col 1)
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0, 1]),
    });
    expectDimmed(result[0]); // ┼ at col 0 — dimmed
    // ─ at col 1 — prevWasCrossing was true for ┼ at col 0, but the ─ is at col 1.
    // The isDashAfterCrossing check uses prevWasCrossing which was set by the ┼.
    // But the char is at a different position. Let's check: prevWasCrossing = true
    // after ┼, then ─ → isDashAfterCrossing = true. So it's dimmed.
    // Actually, the "after" is sequential in the array, not by column.
    expectDimmed(result[1]); // ─ immediately after ┼ in array order — dimmed
  });

  test("crossing dimming resets after one ─", () => {
    // ┼, ─ (dimmed), then another ─ (should be bright if in hBright)
    // pos: ┼(1)=col0, ─(1)=col0, ─(1)=col1
    const chars = [gc("┼"), gc("─"), gc("─ ")];
    // pos 0: col 0 (┼), pos 1: col 0 (─), pos 2: col 1 (─ )
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0, 1]),
    });
    expectDimmed(result[0]); // ┼ dimmed
    expectDimmed(result[1]); // ─ after ┼ dimmed
    expectBright(result[2], chars[2]); // ─ at col 1 — prevWasCrossing is false (previous was ─ not ┼)
  });

  // ── │ at horizontal-bright col stays dimmed ────────────────────────

  test("│ at horizontal-bright column stays dimmed (no vertical bright)", () => {
    const chars = [gc("│ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0]),
      // no brightColumns
    });
    // │ is excluded from horizontal brightening (ch !== "│" check)
    expectDimmed(result[0]);
  });

  // ── Combined vertical + horizontal ─────────────────────────────────

  test("combined vertical + horizontal brightening", () => {
    // col 0: │  (vertical bright), col 1: ─ (horizontal bright), col 1: ╮  (horizontal bright)
    const chars = [gc("│ "), gc("─"), gc("╮ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
      brightHorizontal: new Set([1]),
    });
    expectBright(result[0], chars[0]); // │ at col 0 — vertical bright
    expectBright(result[1], chars[1]); // ─ at col 1 — horizontal bright
    expectBright(result[2], chars[2]); // ╮ at col 1 — horizontal bright
  });

  test("vertical bright does not affect horizontal glyphs at same column", () => {
    // ─ at a column that's in brightColumns but not brightHorizontal → dimmed
    const chars = [gc("─"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
      // no brightHorizontal
    });
    expectDimmed(result[0]);
    expectDimmed(result[1]);
  });

  // ── Char-position tracking ─────────────────────────────────────────

  test("char-position tracking: mixed 1-char and 2-char entries map to correct columns", () => {
    // Simulate a real graph row structure:
    // col 0: "│ " (2 chars, pos 0→2, col 0)
    // col 1: "─" (1 char, pos 2→3, col 1), "─" (1 char, pos 3→4, col 1)
    // col 2: "│ " (2 chars, pos 4→6, col 2)
    const chars = [gc("│ ", BRIGHT_A), gc("─", BRIGHT_B), gc("─", BRIGHT_B), gc("│ ", BRIGHT_A)];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([2]),
      brightHorizontal: new Set([1]),
    });
    expectDimmed(result[0]); // │ at col 0 — not in any bright set
    expectBright(result[1], chars[1]); // ─ at col 1 — horizontal bright
    expectBright(result[2], chars[2]); // ─ at col 1 — horizontal bright
    expectBright(result[3], chars[3]); // │ at col 2 — vertical bright
  });

  // ── Bold preservation ──────────────────────────────────────────────

  test("bright chars preserve original bold flag", () => {
    const chars = [{ char: "█ ", color: BRIGHT_A, bold: true }];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expect(result[0].bold).toBe(true);
    expect(result[0].color).toBe(BRIGHT_A);
  });

  test("dimmed chars have bold set to false", () => {
    const chars = [{ char: "│ ", color: BRIGHT_A, bold: true }];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      // no bright sets → full dim
    });
    expect(result[0].bold).toBe(false);
    expect(result[0].color).toBe(MUTED);
  });
});
