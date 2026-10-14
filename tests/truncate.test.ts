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
      "origin/feature/JI...",
    ],
    ["truncates to exactly maxLen characters including ellipsis", "abcdefghijklmnopqrstuvwxyz", 10, "abcdefg..."],
    ["handles empty string", "", 20, ""],
    ["maxLen=3 returns hard slice without ellipsis", "abcdefg", 3, "abc"],
    ["maxLen=2 returns hard slice without ellipsis", "abcdefg", 2, "ab"],
    ["maxLen=1 returns single character", "abcdefg", 1, "a"],
    ["maxLen=0 returns empty string", "abcdefg", 0, ""],
    ["maxLen negative returns empty string", "abcdefg", -5, ""],
  ])("%s", (_label, name, maxLen, expected) => {
    expect(truncateName(name, maxLen)).toBe(expected);
  });
});
