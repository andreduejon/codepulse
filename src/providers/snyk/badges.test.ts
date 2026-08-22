import { describe, expect, test } from "bun:test";
import { buildSnykGraphBadges, snykSeverityCountsToGraphBadge } from "./badges";
import type { SnykScanResult } from "./types";

const SHA = "a".repeat(40);
const SCANNED_AT = "2026-08-21T10:00:00.000Z";

describe("snykSeverityCountsToGraphBadge", () => {
  test("adapts all four severity counts to a failed graph badge", () => {
    expect(snykSeverityCountsToGraphBadge(SHA, { critical: 1, high: 2, medium: 3, low: 4 }, SCANNED_AT)).toEqual({
      sha: SHA,
      badge: "fail",
      passCount: 0,
      failCount: 10,
      runningCount: 0,
      resourceCount: 10,
      severityCounts: { critical: 1, high: 2, medium: 3, low: 4 },
      latestRunAt: SCANNED_AT,
      latestStatus: "fail",
    });
  });

  test("uses a passing badge when the scan has no findings", () => {
    const badge = snykSeverityCountsToGraphBadge(SHA, { critical: 0, high: 0, medium: 0, low: 0 }, SCANNED_AT);

    expect(badge.badge).toBe("pass");
    expect(badge.passCount).toBe(1);
    expect(badge.failCount).toBe(0);
  });
});

test("buildSnykGraphBadges keys badges by exact scan SHA", () => {
  const result: SnykScanResult = {
    sha: SHA,
    scannedAt: SCANNED_AT,
    counts: { critical: 0, high: 1, medium: 0, low: 0 },
    findings: [],
  };

  expect(buildSnykGraphBadges([result]).get(SHA)?.failCount).toBe(1);
});
