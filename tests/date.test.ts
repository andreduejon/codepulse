/**
 * Test: verifies the formatRelativeDate function in date.ts.
 *
 * Covers all 7 time-range branches (just now, minutes, hours, yesterday,
 * days, same-year absolute, different-year absolute), empty string guard,
 * and cache behavior.
 */
import { describe, expect, test } from "bun:test";
import { formatRelativeDate } from "../src/utils/date";

/** Create an ISO date string offset from now by the given milliseconds. */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeDate", () => {
  test("empty string returns empty string", () => {
    expect(formatRelativeDate("")).toBe("");
  });

  test("just now — less than 1 minute ago", () => {
    const result = formatRelativeDate(ago(10_000)); // 10 seconds ago
    expect(result).toBe("just now");
  });

  test("minutes ago — between 1 and 59 minutes", () => {
    const r5 = formatRelativeDate(ago(5 * MINUTE));
    expect(r5).toBe("5m ago");

    const r30 = formatRelativeDate(ago(30 * MINUTE));
    expect(r30).toBe("30m ago");

    const r59 = formatRelativeDate(ago(59 * MINUTE));
    expect(r59).toBe("59m ago");
  });

  test("hours ago — between 1 and 23 hours", () => {
    const r1 = formatRelativeDate(ago(1 * HOUR + MINUTE));
    expect(r1).toBe("1h ago");

    const r12 = formatRelativeDate(ago(12 * HOUR));
    expect(r12).toBe("12h ago");

    const r23 = formatRelativeDate(ago(23 * HOUR));
    expect(r23).toBe("23h ago");
  });

  test("yesterday — between 24 and 47 hours ago", () => {
    const result = formatRelativeDate(ago(36 * HOUR));
    expect(result).toBe("Yesterday");
  });

  test("days ago — between 2 and 6 days", () => {
    const r2 = formatRelativeDate(ago(2 * DAY));
    expect(r2).toBe("2d ago");

    const r6 = formatRelativeDate(ago(6 * DAY));
    expect(r6).toBe("6d ago");
  });

  test("same year absolute — 7+ days ago, same year", () => {
    // Use Jan 2 of the current year at a fixed time.
    // From Jan 10 onwards this is always >7 days ago and in the current year.
    // During Jan 1-9, Jan 2 may be <7 days ago, so the test would not exercise
    // the "same year absolute" branch — guard with a conditional and always
    // assert so the test is never vacuous.
    const now = new Date();
    const pastDate = new Date(now.getFullYear(), 0, 2, 14, 25);
    const diffMs = now.getTime() - pastDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays >= 7) {
      const result = formatRelativeDate(pastDate.toISOString());
      const day = String(pastDate.getDate()).padStart(2, "0");
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const month = months[pastDate.getMonth()];
      const hours = String(pastDate.getHours()).padStart(2, "0");
      const mins = String(pastDate.getMinutes()).padStart(2, "0");
      expect(result).toBe(`${day}. ${month} ${hours}:${mins}`);
    } else {
      // Early January: no same-year date is >7 days ago — verify it falls into
      // the "days ago" bucket instead, so the test is never vacuous.
      const result = formatRelativeDate(pastDate.toISOString());
      expect(result).toMatch(/^\d+d ago$/);
    }
  });

  test("different year absolute — date from a previous year", () => {
    const pastDate = new Date(2023, 5, 15); // June 15, 2023
    const result = formatRelativeDate(pastDate.toISOString());
    expect(result).toBe("15. Jun 2023");
  });

  test("another different year format", () => {
    const pastDate = new Date(2021, 0, 3); // Jan 3, 2021
    const result = formatRelativeDate(pastDate.toISOString());
    expect(result).toBe("03. Jan 2021");
  });

  test("cache returns consistent results for same input", () => {
    const dateStr = new Date(2022, 11, 25).toISOString(); // stable date
    const first = formatRelativeDate(dateStr);
    const second = formatRelativeDate(dateStr);
    expect(first).toBe(second);
  });

  test("boundary: exactly 1 minute ago shows 1m ago", () => {
    const result = formatRelativeDate(ago(1 * MINUTE));
    expect(result).toBe("1m ago");
  });

  test("boundary: exactly 1 hour ago shows 1h ago", () => {
    // 60 minutes = 1 hour, diffDays < 1
    const result = formatRelativeDate(ago(1 * HOUR));
    expect(result).toBe("1h ago");
  });

  test("boundary: exactly 7 days ago uses absolute format", () => {
    const result = formatRelativeDate(ago(7 * DAY));
    // Should NOT be "7d ago" — 7 days triggers the absolute format
    expect(result).not.toContain("d ago");
    expect(result).not.toBe("Yesterday");
    // Should match "DD. Mon HH:MM" or "DD. Mon YYYY" pattern
    expect(result).toMatch(/^\d{2}\. \w{3} /);
  });
});
