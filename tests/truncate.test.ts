import { describe, expect, it } from "bun:test";
import { truncateName } from "../src/utils/truncate";

describe("truncateName", () => {
  it("returns the name unchanged when shorter than maxLen", () => {
    expect(truncateName("main", 20)).toBe("main");
  });

  it("returns the name unchanged when equal to maxLen", () => {
    expect(truncateName("12345678901234567890", 20)).toBe("12345678901234567890");
  });

  it("truncates with ellipsis when longer than maxLen", () => {
    expect(truncateName("origin/feature/JIRA-1234-long-name", 20)).toBe("origin/feature/JI...");
  });

  it("truncates to exactly maxLen characters including ellipsis", () => {
    const result = truncateName("abcdefghijklmnopqrstuvwxyz", 10);
    expect(result).toBe("abcdefg...");
    expect(result.length).toBe(10);
  });

  it("handles empty string", () => {
    expect(truncateName("", 20)).toBe("");
  });

  it("maxLen=3 returns hard slice without ellipsis", () => {
    expect(truncateName("abcdefg", 3)).toBe("abc");
    expect(truncateName("abcdefg", 3).length).toBeLessThanOrEqual(3);
  });

  it("maxLen=2 returns hard slice without ellipsis", () => {
    expect(truncateName("abcdefg", 2)).toBe("ab");
    expect(truncateName("abcdefg", 2).length).toBeLessThanOrEqual(2);
  });

  it("maxLen=1 returns single character", () => {
    expect(truncateName("abcdefg", 1)).toBe("a");
  });

  it("maxLen=0 returns empty string", () => {
    expect(truncateName("abcdefg", 0)).toBe("");
  });

  it("maxLen negative returns empty string", () => {
    expect(truncateName("abcdefg", -5)).toBe("");
  });
});
