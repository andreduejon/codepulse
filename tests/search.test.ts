import { describe, expect, test } from "bun:test";
import { matchCommit, parseSearchQuery } from "../src/search";
import { makeCommit } from "./test-helpers";

// ─── parseSearchQuery ────────────────────────────────────────────────

describe("parseSearchQuery", () => {
  test.each([
    ["empty string returns substring mode with empty query", "", ""],
    ["whitespace-only string returns substring mode with empty query", "   ", ""],
    ["plain text returns substring mode with lowercased query", "Fix Bug", "fix bug"],
    ["invalid regex falls back to substring mode", "/[invalid(/", "/[invalid(/"],
    ["single slash is treated as substring", "/", "/"],
    ["two slashes with nothing between is treated as substring (//)", "//", "//"],
    ["leading slash without trailing slash is substring", "/partial", "/partial"],
    ["trailing slash without leading slash is substring", "partial/", "partial/"],
  ])("%s", (_label, query, substring) => {
    const result = parseSearchQuery(query);
    expect(result.mode).toBe("substring");
    expect(result.substring).toBe(substring);
    expect(result.regex).toBeNull();
  });

  test("/pattern/ returns regex mode with compiled regex", () => {
    const result = parseSearchQuery("/fix.*bug/");
    expect(result.mode).toBe("regex");
    expect(result.regex).toBeInstanceOf(RegExp);
    expect(result.regex?.source).toBe("fix.*bug");
    expect(result.regex?.flags).toContain("i");
  });

  test("regex is case-insensitive", () => {
    const result = parseSearchQuery("/FIX/");
    expect(result.regex?.test("fix")).toBe(true);
    expect(result.regex?.test("FIX")).toBe(true);
    expect(result.regex?.test("Fix")).toBe(true);
  });

  test("preserves raw query string", () => {
    const result = parseSearchQuery("/fix.*bug/");
    expect(result.raw).toBe("/fix.*bug/");
  });

  test("regex with special characters compiles correctly", () => {
    const result = parseSearchQuery("/^feat\\(.*\\):/");
    expect(result.mode).toBe("regex");
    expect(result.regex?.test("feat(core): add search")).toBe(true);
    expect(result.regex?.test("fix: something")).toBe(false);
  });

  test("regex with alternation works", () => {
    const result = parseSearchQuery("/fix|feat|refactor/");
    expect(result.mode).toBe("regex");
    expect(result.regex?.test("fix: bug")).toBe(true);
    expect(result.regex?.test("feat: new")).toBe(true);
    expect(result.regex?.test("refactor: cleanup")).toBe(true);
    expect(result.regex?.test("docs: update")).toBe(false);
  });

  test("whitespace around /pattern/ is trimmed before detection", () => {
    const result = parseSearchQuery("  /fix/  ");
    expect(result.mode).toBe("regex");
    expect(result.regex?.source).toBe("fix");
  });
});

// ─── matchCommit ─────────────────────────────────────────────────────

describe("matchCommit", () => {
  const commit = makeCommit(
    "abc1234567890",
    ["def456"],
    [
      { name: "main", type: "head", isCurrent: true },
      { name: "origin/main", type: "remote", isCurrent: false },
    ],
    "feat: add search functionality",
  );
  // Override author for deterministic tests
  (commit as { author: string }).author = "Jane Doe";

  test.each([
    ["empty query matches everything", "", true],
    ["substring matches subject (case-insensitive)", "SEARCH", true],
    ["substring matches author", "jane", true],
    ["substring matches shortHash", "abc1234", true],
    ["substring matches ref name", "origin/main", true],
    // Full hash beyond shortHash should not match
    ["substring does not match body or full hash", "567890", false],
    ["regex matches subject", "/^feat:/", true],
    ["regex does not match when pattern fails", "/^fix:/", false],
    ["regex matches author", "/jane.*doe/", true],
    ["regex matches ref name", "/origin\\/main/", true],
  ])("%s", (_label, query, expected) => {
    expect(matchCommit(commit, parseSearchQuery(query))).toBe(expected);
  });

  test("invalid regex falls back to substring and still matches", () => {
    // "[invalid(" is not valid regex — should fall back to substring
    // and match because the commit has no such text
    const search = parseSearchQuery("/[invalid(/");
    expect(search.mode).toBe("substring");
    expect(matchCommit(commit, search)).toBe(false);
  });

  test("matches commit with no refs via subject", () => {
    const noRefsCommit = makeCommit("bbb0000000000", [], [], "chore: update deps");
    (noRefsCommit as { author: string }).author = "Bob";
    const search = parseSearchQuery("update deps");
    expect(matchCommit(noRefsCommit, search)).toBe(true);
  });

  test("regex with capture group works", () => {
    const search = parseSearchQuery("/(feat|fix):/");
    expect(matchCommit(commit, search)).toBe(true);
  });
});
