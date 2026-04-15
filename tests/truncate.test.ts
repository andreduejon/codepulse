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

  it("handles maxLen of 3 (only ellipsis)", () => {
    expect(truncateName("abcdefg", 3)).toBe("...");
  });

  it("handles empty string", () => {
    expect(truncateName("", 20)).toBe("");
  });
});
