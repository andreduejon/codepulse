import { describe, expect, test } from "bun:test";
import { formatDebugEvent, formatDebugTimestamp } from "../src/debug/format";

describe("debug format", () => {
  test("formats timestamp as HH:MM:SS", () => {
    expect(formatDebugTimestamp(new Date("2024-01-01T02:03:04Z").getTime())).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test("formats event with status and duration", () => {
    expect(
      formatDebugEvent({ timestamp: 0, source: "git", message: "git status", status: "ok", durationMs: 12 }),
    ).toContain("git status  ok  12ms");
  });
});
