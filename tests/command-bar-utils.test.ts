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
  test.each([
    ["empty string in idle mode", "idle", ""],
    ["command prompt in command mode", "command", "Enter command..."],
    ["search prompt in search mode", "search", "Search commits..."],
    ["path prompt in path mode", "path", "Enter path..."],
  ] as const)("returns %s", (_label, mode, expected) => {
    expect(commandBarPlaceholder(mode)).toBe(expected);
  });
});

// ── commitCountText ──────────────────────────────────────────────────────────

describe("commitCountText", () => {
  test.each([
    ["total only when no highlight is active", null, 42, "42"],
    ["'matches / total' when highlight is active", new Set(["abc", "def"]), 100, "2 / 100"],
    ["'0 / total' when highlight is active but nothing matches", new Set<string>(), 50, "0 / 50"],
    ["'total / total' when every row matches", new Set(["a", "b", "c"]), 3, "3 / 3"],
    ["'0' for empty repo with no highlight", null, 0, "0"],
  ])("shows %s", (_label, highlightSet, total, expected) => {
    expect(commitCountText(highlightSet, total)).toBe(expected);
  });
});
