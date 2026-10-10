import { describe, expect, test } from "bun:test";
import { commandBarPlaceholder, commitCountText, filterBadgeLabel } from "../src/utils/command-bar-utils";

describe("filterBadgeLabel", () => {
  test("omits empty and unapplied terms", () => {
    expect(filterBadgeLabel("Search", "")).toBe(" Search ");
    expect(filterBadgeLabel("Path", null)).toBe(" Path ");
  });

  test("preserves terms through ten characters and truncates longer terms to nine plus ellipsis", () => {
    expect(filterBadgeLabel("Search", "123456789")).toBe(" Search · 123456789 ");
    expect(filterBadgeLabel("Search", "1234567890")).toBe(" Search · 1234567890 ");
    expect(filterBadgeLabel("Path", "12345678901")).toBe(" Path · 123456789… ");
    expect(filterBadgeLabel("Path", "src/components/command-bar.tsx")).toBe(" Path · src/compo… ");
  });
});

// ── commandBarPlaceholder ────────────────────────────────────────────────────

describe("commandBarPlaceholder", () => {
  test("returns empty string in idle mode", () => {
    expect(commandBarPlaceholder("idle")).toBe("");
  });

  test("returns command prompt in command mode", () => {
    expect(commandBarPlaceholder("command")).toBe("Enter command...");
  });

  test("returns search prompt in search mode", () => {
    expect(commandBarPlaceholder("search")).toBe("Search commits...");
  });

  test("returns path prompt in path mode", () => {
    expect(commandBarPlaceholder("path")).toBe("Enter path...");
  });
});

// ── commitCountText ──────────────────────────────────────────────────────────

describe("commitCountText", () => {
  test("shows total only when no highlight is active", () => {
    expect(commitCountText(null, 42)).toBe("42");
  });

  test("shows 'matches / total' when highlight is active", () => {
    const hSet = new Set(["abc", "def"]);
    expect(commitCountText(hSet, 100)).toBe("2 / 100");
  });

  test("shows '0 / total' when highlight is active but nothing matches", () => {
    expect(commitCountText(new Set(), 50)).toBe("0 / 50");
  });

  test("shows 'total / total' when every row matches", () => {
    const hSet = new Set(["a", "b", "c"]);
    expect(commitCountText(hSet, 3)).toBe("3 / 3");
  });

  test("shows '0' for empty repo with no highlight", () => {
    expect(commitCountText(null, 0)).toBe("0");
  });
});
