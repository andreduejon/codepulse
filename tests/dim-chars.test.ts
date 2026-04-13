/**
 * Test: verifies dimGraphChars — the pure function that applies ancestry
 * dimming to rendered GraphChar[] arrays.
 *
 * Tests cover all dimming rules: uncommitted full-dim, ancestry inactive
 * passthrough, vertical bright columns (│, █), horizontal bright columns
 * (─, corners, tees), junction replacement (┼/├/┤/┬/┴ → │ on ancestry
 * columns), and combined vertical + horizontal brightening.
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

  // ── Junction replacement (┼, ├, ┤, ┬, ┴) ────────────────────────────
  // Junction glyphs on vertical-bright columns are replaced with │ to give
  // the ancestry line a clean appearance. The ─ that follows (always a
  // separate entry) is dimmed normally by the standard bright-check logic.
  // Junctions on horizontal-bright (but NOT vertical-bright) columns are
  // replaced with ─ (the vertical arm is removed).
  // When neither the vertical nor horizontal arm is bright, junctions
  // are dimmed normally — no replacement occurs.

  test("crossing ┼ replaced with ─ when only horizontal arm is bright", () => {
    // col 0: █  (2), col 1: ─ (1), ┼ (1) at col 1, ─ (1) at col 2
    const chars = [gc("█ "), gc("─"), gc("┼"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([1]),
    });
    expectDimmed(result[0]); // col 0 not bright
    expectBright(result[1], chars[1]); // ─ at col 1 — bright (horizontal arm)
    expect(result[2].char).toBe("─"); // ┼ at col 1 → ─ (horizontal bright replaces vertical arm)
    expectDimmed(result[3]); // ─ at col 2 — not in bright set
  });

  test("crossing ┼ replaced with ─ uses horizontal color, not vertical", () => {
    // ┼ has vertical color (BRIGHT_A), adjacent ─ has horizontal color (BRIGHT_B)
    const chars = [gc("┼", BRIGHT_A), gc("─", BRIGHT_B)];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0]),
    });
    expect(result[0].char).toBe("─"); // ┼ → ─
    expect(result[0].color).toBe(BRIGHT_B); // uses adjacent ─ color, not ┼ color
  });

  test("crossing ┼ replaced with │ when vertical lane is bright", () => {
    const chars = [gc("┼"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expect(result[0].char).toBe("│"); // ┼ replaced with │
    expect(result[0].color).toBe(chars[0].color); // keeps original color
    expectDimmed(result[1]); // ─ dimmed normally (no suppression)
  });

  test("crossing ┼ dimmed when neither vertical nor horizontal is bright", () => {
    const chars = [gc("┼"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([1]), // different column
      brightHorizontal: new Set([1]), // different column
    });
    expectDimmed(result[0]); // ┼ at col 0 — not bright
    expectDimmed(result[1]); // ─ at col 0 — not bright
  });

  test("crossing ┼ replaced with │ when both vertical and horizontal are bright", () => {
    const chars = [gc("┼"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
      brightHorizontal: new Set([0]),
    });
    expect(result[0].char).toBe("│"); // ┼ replaced with │ (junction replacement takes priority)
    expectBright(result[1], chars[1]); // ─ at col 0 — horizontal bright (not suppressed)
  });

  test("┼ replaced with ─ when horizontal arm is bright and ┼ not on vertical ancestry", () => {
    // col 0: ┼  (2 chars), col 1: ─  (2 chars)
    const chars = [gc("┼ "), gc("─ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0, 1]),
    });
    expect(result[0].char).toBe("─ "); // ┼ at col 0 → ─ (horizontal bright, vertical arm removed)
    expectBright(result[1], chars[1]); // ─ at col 1 — bright (horizontal arm)
  });

  test("─ after replaced ┼ is not suppressed", () => {
    // ┼ at col 0 (vertical bright), ─ at col 0 (dimmed normally), ─  at col 1 (unrelated)
    const chars = [gc("┼"), gc("─"), gc("─ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expect(result[0].char).toBe("│"); // ┼ → │
    expectDimmed(result[1]); // ─ at col 0 — dimmed normally (no suppression)
    expectDimmed(result[2]); // ─ at col 1 — no bright sets for col 1
  });

  // ── Tee-left (├) replacement ──────────────────────────────────────

  test("tee-left ├ replaced with │ when vertical lane is bright, ─ dimmed", () => {
    // Renderer always emits ├ and ─ as separate 1-char entries.
    const chars = [gc("├"), gc("─"), gc("╮ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expect(result[0].char).toBe("│"); // ├ → │
    expect(result[0].color).toBe(chars[0].color); // keeps original color
    expectDimmed(result[1]); // ─ at col 0 — dimmed (not on ancestry)
    expectDimmed(result[2]); // ╮ at col 1 — not bright
  });

  test("tee-left ├ replaced with │ when vertical bright, ─ stays bright when horizontal bright", () => {
    const chars = [gc("├", BRIGHT_A), gc("─", BRIGHT_B), gc("╮ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
      brightHorizontal: new Set([0, 1]),
    });
    expect(result[0].char).toBe("│"); // ├ → │
    expect(result[0].color).toBe(BRIGHT_A); // keeps original color
    expectBright(result[1], chars[1]); // ─ at col 0 — horizontal bright
    expectBright(result[2], chars[2]); // ╮ at col 1 — horizontal bright
  });

  test("tee-left ├ replaced with ─ when only horizontal arm is bright", () => {
    // ├ has vertical color (BRIGHT_A), adjacent ─ has horizontal color (BRIGHT_B)
    const chars = [gc("├", BRIGHT_A), gc("─", BRIGHT_B), gc("╮ ")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([0, 1]),
    });
    expect(result[0].char).toBe("─"); // ├ at col 0 → ─ (horizontal bright, vertical arm removed)
    expect(result[0].color).toBe(BRIGHT_B); // uses adjacent ─ color (horizontal), not ├ color (vertical)
    expectBright(result[1], chars[1]); // ─ at col 0 — horizontal bright
    expectBright(result[2], chars[2]); // ╮ at col 1 — horizontal bright
  });

  // ── Tee-right (┤) replacement ─────────────────────────────────────

  test("tee-right ┤ replaced with │ when vertical lane is bright", () => {
    const chars = [gc("──"), gc("┤ ")];
    // pos 0→2 (──), col=0; pos 2→4 (┤ ), col=1
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([1]),
    });
    expectDimmed(result[0]); // ── at col 0 — not bright
    expect(result[1].char).toBe("│ "); // ┤  → │ (space)
    expect(result[1].color).toBe(chars[1].color); // keeps original color
  });

  // ── Junction ┬ and ┴ replacement ──────────────────────────────────

  test("junction ┬ replaced with │ when vertical lane is bright", () => {
    const chars = [gc("┬"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expect(result[0].char).toBe("│"); // ┬ → │
    expectDimmed(result[1]); // ─ at col 0 — dimmed normally
  });

  test("junction ┴ replaced with │ when vertical lane is bright", () => {
    const chars = [gc("┴"), gc("─")];
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightColumns: new Set([0]),
    });
    expect(result[0].char).toBe("│"); // ┴ → │
    expectDimmed(result[1]); // ─ at col 0 — dimmed normally
  });

  test("junction ┴ replaced with ─ when only horizontal arm is bright", () => {
    // ┴ has vertical color (BRIGHT_A), adjacent ─ has horizontal color (BRIGHT_B)
    const chars = [gc("──"), gc("┴", BRIGHT_A), gc("─", BRIGHT_B)];
    // pos 0→2 (──), col=0; pos 2→3 (┴), col=1; pos 3→4 (─), col=1
    const result = dimGraphChars(chars, MUTED, {
      isUncommitted: false,
      ancestryActive: true,
      brightHorizontal: new Set([1]),
    });
    expectDimmed(result[0]); // ── at col 0 — not in bright set
    expect(result[1].char).toBe("─"); // ┴ at col 1 → ─ (horizontal bright, vertical arm removed)
    expect(result[1].color).toBe(BRIGHT_B); // uses adjacent ─ color (horizontal), not ┴ color (vertical)
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
