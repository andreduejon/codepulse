import { describe, expect, test } from "bun:test";
import { parseSnykOutput } from "./parser";

const SHA = "a".repeat(40);

describe("parseSnykOutput", () => {
  test("normalizes one project and counts all severities", () => {
    const result = parseSnykOutput(
      {
        projectName: "service",
        targetFile: "package.json",
        vulnerabilities: [
          {
            id: "C",
            title: "Critical",
            severity: "critical",
            packageName: "alpha",
            version: "1.0.0",
            fixedIn: ["1.1.0"],
          },
          {
            id: "H",
            title: "High",
            severity: "high",
            name: "beta",
            version: "2.0.0",
            upgradePath: [false, "beta@2.1.0"],
          },
          { id: "M", severity: "medium", from: ["root@1.0.0", "gamma@3.0.0"] },
          { id: "L", severity: "low", packageName: "delta", version: "4.0.0" },
        ],
      },
      { sha: SHA, scannedAt: "2026-08-21T10:00:00.000Z" },
    );

    expect(result.counts).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
    expect(result.findings[0]).toMatchObject({
      dependency: "alpha",
      installedVersion: "1.0.0",
      fixedVersion: "1.1.0",
      project: "service",
      targetFile: "package.json",
    });
    expect(result.findings[1].fixedVersion).toBe("2.1.0");
    expect(result.findings[2]).toMatchObject({ dependency: "gamma", installedVersion: "3.0.0" });
  });

  test("normalizes all-projects array output", () => {
    const result = parseSnykOutput(
      [
        { projectName: "one", vulnerabilities: [{ id: "A", severity: "high", name: "a", version: "1" }] },
        { projectName: "two", vulnerabilities: [{ id: "B", severity: "low", name: "b", version: "2" }] },
      ],
      { sha: SHA },
    );

    expect(result.findings.map(finding => finding.project)).toEqual(["one", "two"]);
    expect(result.counts).toEqual({ critical: 0, high: 1, medium: 0, low: 1 });
  });

  test("rejects output without project results", () => {
    expect(() => parseSnykOutput({}, { sha: SHA })).toThrow("Snyk output contains no project results");
    expect(() => parseSnykOutput({ error: "project failed" }, { sha: SHA })).toThrow("project failed");
  });
});
