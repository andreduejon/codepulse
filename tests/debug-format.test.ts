import { describe, expect, test } from "bun:test";
import { formatDebugDuration, formatDebugMessage, formatDebugStatus, formatDebugTimestamp } from "../src/debug/format";

describe("debug format", () => {
  test("formats timestamp as HH:MM:SS", () => {
    expect(formatDebugTimestamp(new Date(2024, 0, 1, 2, 3, 4).getTime())).toBe("02:03:04");
  });

  test("formats duration and message columns", () => {
    expect(formatDebugDuration(12)).toBe("12ms");
    expect(formatDebugStatus("ok")).toBe("ok");
    expect(formatDebugMessage({ timestamp: 0, source: "Git", message: "git status", status: "ok" })).toBe("git status");
  });
});
