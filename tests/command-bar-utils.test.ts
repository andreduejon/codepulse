import { describe, expect, test } from "bun:test";
import {
  commandBarInputValue,
  commandBarPlaceholder,
  commitCountText,
  modeBadgeLabel,
} from "../src/utils/command-bar-utils";

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

// ── commandBarInputValue ─────────────────────────────────────────────────────

describe("commandBarInputValue", () => {
  const base = {
    commandBarValue: ":ancestry",
    searchInputValue: "fix",
    highlightMode: null as null | "search" | "path" | "ancestry",
    pathFilter: null as string | null,
  };

  test("shows commandBarValue in command mode", () => {
    expect(commandBarInputValue({ ...base, commandBarMode: "command" })).toBe(":ancestry");
  });

  test("shows commandBarValue in path mode", () => {
    expect(commandBarInputValue({ ...base, commandBarMode: "path" })).toBe(":ancestry");
  });

  test("shows searchInputValue in search mode", () => {
    expect(commandBarInputValue({ ...base, commandBarMode: "search" })).toBe("fix");
  });

  test("in idle mode with search highlight, shows searchInputValue", () => {
    expect(commandBarInputValue({ ...base, commandBarMode: "idle", highlightMode: "search" })).toBe("fix");
  });

  test("in idle mode with path highlight, shows pathFilter", () => {
    expect(
      commandBarInputValue({ ...base, commandBarMode: "idle", highlightMode: "path", pathFilter: "src/git/" }),
    ).toBe("src/git/");
  });

  test("in idle mode with path highlight and null pathFilter, shows empty string", () => {
    expect(commandBarInputValue({ ...base, commandBarMode: "idle", highlightMode: "path", pathFilter: null })).toBe("");
  });

  test("in idle mode with ancestry highlight, shows empty string", () => {
    expect(commandBarInputValue({ ...base, commandBarMode: "idle", highlightMode: "ancestry" })).toBe("");
  });

  test("in idle mode with no highlight, shows empty string", () => {
    expect(commandBarInputValue({ ...base, commandBarMode: "idle", highlightMode: null })).toBe("");
  });
});

// ── modeBadgeLabel ───────────────────────────────────────────────────────────

describe("modeBadgeLabel", () => {
  test("shows 'command' when command bar is in command mode", () => {
    expect(modeBadgeLabel("command", null)).toBe(" command ");
  });

  test("shows 'search' when command bar is in search mode", () => {
    expect(modeBadgeLabel("search", null)).toBe(" search ");
  });

  test("shows 'path' when command bar is in path mode", () => {
    expect(modeBadgeLabel("path", null)).toBe(" path ");
  });

  test("command bar mode takes priority over highlight mode", () => {
    expect(modeBadgeLabel("command", "ancestry")).toBe(" command ");
    expect(modeBadgeLabel("search", "path")).toBe(" search ");
  });

  test("in idle mode shows search highlight", () => {
    expect(modeBadgeLabel("idle", "search")).toBe(" search ");
  });

  test("in idle mode shows path highlight", () => {
    expect(modeBadgeLabel("idle", "path")).toBe(" path ");
  });

  test("in idle mode shows ancestry highlight", () => {
    expect(modeBadgeLabel("idle", "ancestry")).toBe(" ancestry ");
  });

  test("in idle mode with no highlight shows normal", () => {
    expect(modeBadgeLabel("idle", null)).toBe(" normal ");
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
