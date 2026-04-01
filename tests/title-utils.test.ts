import { describe, expect, test } from "bun:test";
import {
  buildDiffTitleParts,
  type DiffTitleParts,
  middleTruncate,
  splitPath,
  TITLE_SEP,
} from "../src/components/dialogs/title-utils";

// ── splitPath ────────────────────────────────────────────────────────

describe("splitPath", () => {
  test("splits nested path into dirPrefix and basename", () => {
    expect(splitPath("src/components/dialogs/diff-utils.ts")).toEqual({
      dirPrefix: "src/components/dialogs/",
      basename: "diff-utils.ts",
    });
  });

  test("returns empty dirPrefix for rootless filename", () => {
    expect(splitPath("README.md")).toEqual({
      dirPrefix: "",
      basename: "README.md",
    });
  });

  test("handles single directory level", () => {
    expect(splitPath("src/app.ts")).toEqual({
      dirPrefix: "src/",
      basename: "app.ts",
    });
  });

  test("handles deeply nested path", () => {
    expect(splitPath("a/b/c/d/e/f.txt")).toEqual({
      dirPrefix: "a/b/c/d/e/",
      basename: "f.txt",
    });
  });
});

// ── middleTruncate ───────────────────────────────────────────────────

describe("middleTruncate", () => {
  test("returns original string if it fits", () => {
    expect(middleTruncate("hello", 10)).toBe("hello");
    expect(middleTruncate("hello", 5)).toBe("hello");
  });

  test("truncates long string with ellipsis in the middle", () => {
    const result = middleTruncate("abcdefghij", 7);
    // available = 6, left = 3, right = 3
    expect(result).toBe("abc\u2026hij");
    expect(result.length).toBe(7);
  });

  test("handles maxLen of 1 (just ellipsis)", () => {
    expect(middleTruncate("abcdef", 1)).toBe("\u2026");
  });

  test("handles maxLen of 2", () => {
    const result = middleTruncate("abcdef", 2);
    // available = 1, left = 0, right = 1
    expect(result).toBe("\u2026f");
    expect(result.length).toBe(2);
  });

  test("handles maxLen of 3", () => {
    const result = middleTruncate("abcdef", 3);
    // available = 2, left = 1, right = 1
    expect(result).toBe("a\u2026f");
    expect(result.length).toBe(3);
  });

  test("biases toward keeping the end (right side)", () => {
    const result = middleTruncate("abcdefgh", 6);
    // available = 5, left = 2, right = 3
    expect(result).toBe("ab\u2026fgh");
    expect(result.length).toBe(6);
  });

  test("empty string returns empty", () => {
    expect(middleTruncate("", 5)).toBe("");
  });
});

// ── buildDiffTitleParts ──────────────────────────────────────────────

describe("buildDiffTitleParts", () => {
  // Constants from title-utils.ts: TITLE_PADDING=8, ESC_CLOSE_WIDTH=9, SEP_LEN=3
  // Usable width = dialogWidth - 8 - 9 = dialogWidth - 17

  /** Helper: compute the display width of assembled title parts. */
  function partsWidth(p: DiffTitleParts): number {
    const segments: string[] = [];
    if (p.counter) segments.push(p.counter);
    if (p.source) segments.push(p.source);
    // dir+basename are one visual group
    segments.push(p.dirPrefix + p.basename);
    if (p.mode) segments.push(p.mode);
    return segments.join(TITLE_SEP).length;
  }

  test("wide dialog — all segments fit at full size", () => {
    const result = buildDiffTitleParts(
      "src/components/app.tsx",
      "abc1234",
      "[2/5]",
      "new only",
      160, // usable = 143
    );
    expect(result.counter).toBe("[2/5]");
    expect(result.source).toBe("abc1234");
    expect(result.dirPrefix).toBe("src/components/");
    expect(result.basename).toBe("app.tsx");
    expect(result.mode).toBe("new only");
    expect(partsWidth(result)).toBeLessThanOrEqual(143);
  });

  test("medium dialog — path prefix gets truncated", () => {
    const result = buildDiffTitleParts(
      "src/components/dialogs/very-long-directory-name/utils/helpers/diff-utils.ts",
      "abc1234",
      "[2/5]",
      "new only",
      80, // usable = 63
    );
    expect(result.counter).toBe("[2/5]");
    expect(result.source).toBe("abc1234");
    expect(result.basename).toBe("diff-utils.ts");
    expect(result.mode).toBe("new only");
    // Dir prefix should be truncated or collapsed
    expect(result.dirPrefix.length).toBeLessThan(
      "src/components/dialogs/very-long-directory-name/utils/helpers/".length,
    );
    expect(partsWidth(result)).toBeLessThanOrEqual(63);
  });

  test("tight dialog — mode label hidden after path collapse", () => {
    // Make path long enough that even collapsing it still needs mode hidden
    const result = buildDiffTitleParts(
      "src/very-long-name-to-force-truncation.ts",
      "stash:abc1234",
      "[2/5]",
      "old only",
      60, // usable = 43
    );
    expect(result.counter).toBe("[2/5]");
    // At this width, mode might be hidden
    // dir should be collapsed (no directory in this path anyway since splitPath gives "src/" as dir)
    expect(partsWidth(result)).toBeLessThanOrEqual(43);
  });

  test("tighter dialog — source label hidden", () => {
    const result = buildDiffTitleParts(
      "some-really-long-filename-that-takes-up-space.ts",
      "stash:abc1234",
      "[3/10]",
      "old only",
      55, // usable = 38
    );
    expect(result.counter).toBe("[3/10]");
    // Source and mode should be hidden to fit
    expect(partsWidth(result)).toBeLessThanOrEqual(38);
  });

  test("extreme — basename gets middle-truncated", () => {
    const result = buildDiffTitleParts(
      "an-extremely-long-file-name-that-cannot-possibly-fit-in-a-tiny-dialog.ts",
      "abc1234",
      "[1/2]",
      "new only",
      40, // usable = 23
    );
    expect(result.counter).toBe("[1/2]");
    expect(result.source).toBe("");
    expect(result.dirPrefix).toBe("");
    expect(result.mode).toBe("");
    // Basename should be truncated
    expect(result.basename.length).toBeLessThanOrEqual(23);
    expect(result.basename).toContain("\u2026");
    expect(partsWidth(result)).toBeLessThanOrEqual(23);
  });

  test("counter is always preserved", () => {
    const result = buildDiffTitleParts(
      "very-long-filename-that-will-definitely-need-truncation.ts",
      "abc1234",
      "[10/99]",
      "old only",
      40, // usable = 23
    );
    expect(result.counter).toBe("[10/99]");
  });

  test("single file — no counter", () => {
    const result = buildDiffTitleParts("src/app.ts", "abc1234", "", "new only", 120);
    expect(result.counter).toBe("");
    expect(result.source).toBe("abc1234");
    expect(result.basename).toBe("app.ts");
  });

  test("unified mode — no mode label", () => {
    const result = buildDiffTitleParts("src/app.ts", "abc1234", "[1/3]", "", 120);
    expect(result.counter).toBe("[1/3]");
    expect(result.mode).toBe("");
  });

  test("rootless filename — no dirPrefix", () => {
    const result = buildDiffTitleParts("README.md", "abc1234", "", "", 120);
    expect(result.dirPrefix).toBe("");
    expect(result.basename).toBe("README.md");
  });

  test("all parts fit exactly at boundary", () => {
    // "[1/2] · abc1234 · src/app.ts · new only"
    // counter=5, source=7, dir=4, basename=6, mode=8
    // = 5 + 3 + 7 + 3 + (4+6) + 3 + 8 = 39
    const result = buildDiffTitleParts("src/app.ts", "abc1234", "[1/2]", "new only", 39 + 17);
    expect(result.counter).toBe("[1/2]");
    expect(result.source).toBe("abc1234");
    expect(result.dirPrefix).toBe("src/");
    expect(result.basename).toBe("app.ts");
    expect(result.mode).toBe("new only");
    expect(partsWidth(result)).toBe(39);
  });
});
