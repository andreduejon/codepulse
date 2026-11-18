import { describe, expect, test } from "bun:test";
import {
  formatDebugDuration,
  formatDebugMessage,
  formatDebugStatus,
  formatDebugTimestamp,
  isFailedDebugStatus,
} from "../src/tui/debug/format";

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

describe("failed Debug events", () => {
  test("a source that says whether it failed is taken at its word; otherwise the status tells", () => {
    // Snyk's exit 1 is findings, not a failure: its scanner says so.
    expect(isFailedDebugStatus({ status: "1", failed: false })).toBe(false);
    expect(isFailedDebugStatus({ status: "2", failed: true })).toBe(true);
    expect(isFailedDebugStatus({ status: "error" })).toBe(true);
    expect(isFailedDebugStatus({ status: "exit 128" })).toBe(true);
    expect(isFailedDebugStatus({ status: "exit 0" })).toBe(false);
    expect(isFailedDebugStatus({ status: "404" })).toBe(true);
    expect(isFailedDebugStatus({ status: "200" })).toBe(false);
  });
});
