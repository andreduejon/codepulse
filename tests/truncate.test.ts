import { describe, expect, it } from "bun:test";
import { truncateName } from "../src/utils/truncate";

describe("truncateName", () => {
  it.each([
    ["returns the name unchanged when shorter than maxLen", "main", 20, "main"],
    ["returns the name unchanged when equal to maxLen", "12345678901234567890", 20, "12345678901234567890"],
    [
      "truncates with ellipsis when longer than maxLen",
      "origin/feature/JIRA-1234-long-name",
      20,
      "origin/feature/JIRA…",
    ],
    [
      "truncates to exactly maxLen characters including the single-character ellipsis",
      "abcdefghijklmnopqrstuvwxyz",
      10,
      "abcdefghi…",
    ],
    ["handles empty string", "", 20, ""],
    ["maxLen=3 keeps two characters and the ellipsis", "abcdefg", 3, "ab…"],
    ["maxLen=2 keeps one character and the ellipsis", "abcdefg", 2, "a…"],
    ["maxLen=1 returns only the ellipsis", "abcdefg", 1, "…"],
    ["maxLen=0 returns empty string", "abcdefg", 0, ""],
    ["maxLen negative returns empty string", "abcdefg", -5, ""],
  ])("%s", (_label, name, maxLen, expected) => {
    expect(truncateName(name, maxLen)).toBe(expected);
  });
});
