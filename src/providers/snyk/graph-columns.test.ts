import { describe, expect, test } from "bun:test";
import { UNCOMMITTED_PLACEHOLDER } from "../../constants";
import { severityColumnWidth, snykScanLabel } from "./graph-columns";
import type { SnykScanResult } from "./types";

const scan = (partial = false): SnykScanResult => ({
  sha: "a".repeat(40),
  scannedAt: "2026-08-21T10:00:00.000Z",
  counts: { critical: 0, high: 0, medium: 0, low: 0 },
  findings: [],
  ...(partial ? { partial: true, failedProjects: 1 } : {}),
});

describe("snykScanLabel", () => {
  test("keeps the scan date for partial and complete scans", () => {
    expect(snykScanLabel(scan(true))).toBe(snykScanLabel(scan()));
    expect(snykScanLabel(scan())).not.toBe(UNCOMMITTED_PLACEHOLDER);
    expect(snykScanLabel(scan())).not.toBe("partial");
  });

  test("shows a placeholder when the commit has not been scanned", () => {
    expect(snykScanLabel(null)).toBe(UNCOMMITTED_PLACEHOLDER);
  });
});

describe("severityColumnWidth", () => {
  test("fits four single-digit chips", () => {
    expect(
      severityColumnWidth([
        {
          sha: "a".repeat(40),
          badge: "pass",
          passCount: 1,
          failCount: 0,
          runningCount: 0,
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
          latestRunAt: "2026-08-21T10:00:00.000Z",
          latestStatus: "pass",
        },
      ]),
    ).toBe(21);
  });
});
