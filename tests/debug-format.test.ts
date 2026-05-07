import { describe, expect, test } from "bun:test";
import { formatDebugDuration, formatDebugEvent, formatDebugMessage, formatDebugStatus, formatDebugTimestamp } from "../src/debug/format";

describe("debug format", () => {
  test("formats timestamp as HH:MM:SS", () => {
    expect(formatDebugTimestamp(new Date("2024-01-01T02:03:04Z").getTime())).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test("formats event with status and duration", () => {
    expect(
      formatDebugEvent({ timestamp: 0, source: "Git", message: "git status", status: "ok", durationMs: 12 }),
    ).toContain("Git  ok  12ms  00:00:00  git status");
  });

  test("formats duration and message columns", () => {
    expect(formatDebugDuration(12)).toBe("12ms");
    expect(formatDebugStatus("ok")).toBe("ok");
    expect(formatDebugMessage({ timestamp: 0, source: "Git", message: "git status", status: "ok" })).toBe("git status");
  });
});
