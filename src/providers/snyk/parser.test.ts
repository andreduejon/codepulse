import { describe, expect, test } from "bun:test";
import { groupFindingsById, isSnykScanResult, parseSnykOutput, shouldReplaceSnykResult } from "./parser";

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
            from: ["service@1.0.0", "alpha@1.0.0"],
            fixedIn: ["1.1.0"],
            identifiers: { CVE: ["CVE-2026-1234", "CVE-2026-1234"], CWE: ["CWE-287"] },
          },
          {
            id: "H",
            title: "High",
            severity: "high",
            name: "beta",
            version: "2.0.0",
            from: ["service@1.0.0", "parent@3.0.0", "beta@2.0.0"],
            upgradePath: [false, "parent@3.1.0", "beta@2.1.0"],
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
      dependencyType: "direct",
      dependencyPath: ["alpha@1.0.0"],
      cves: ["CVE-2026-1234"],
      project: "service",
      targetFile: "package.json",
    });
    expect(result.findings[1]).toMatchObject({
      fixedVersion: "2.1.0",
      dependencyType: "transitive",
      dependencyPath: ["parent@3.0.0", "beta@2.0.0"],
      upgradeDependency: "parent",
      upgradeVersion: "3.1.0",
    });
    expect(result.findings[2]).toMatchObject({
      dependency: "gamma",
      installedVersion: "3.0.0",
      dependencyType: "direct",
    });
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
    expect(() => parseSnykOutput({}, { sha: SHA })).toThrow("Snyk output contains no project results.");
    expect(() => parseSnykOutput({ error: "project failed" }, { sha: SHA })).toThrow(
      "Snyk output contains no project results.",
    );
  });

  test("treats a project error as failed even when vulnerabilities is present", () => {
    const result = parseSnykOutput(
      [
        {
          error: "maven failed",
          projectName: "broken",
          vulnerabilities: [{ id: "A", severity: "high", name: "a", version: "1" }],
        },
        { projectName: "working", vulnerabilities: [{ id: "B", severity: "low", name: "b", version: "2" }] },
      ],
      { sha: SHA },
    );

    expect(result.findings.map(finding => finding.project)).toEqual(["working"]);
    expect(result.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 1 });
    expect(result.partial).toBe(true);
    expect(result.failedProjects).toBe(1);
  });

  test("keeps successful projects when another project fails", () => {
    const result = parseSnykOutput(
      [
        { error: "broken project" },
        { projectName: "working", vulnerabilities: [{ id: "A", severity: "high", name: "a", version: "1" }] },
      ],
      { sha: SHA },
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].project).toBe("working");
    expect(result.partial).toBe(true);
    expect(result.failedProjects).toBe(1);
  });

  test("counts unique Snyk IDs not path occurrences", () => {
    const result = parseSnykOutput(
      {
        vulnerabilities: [
          { id: "SNYK-JS-FOO-1", severity: "critical", name: "foo", version: "1.0.0", from: ["app@1", "foo@1.0.0"] },
          {
            id: "SNYK-JS-FOO-1",
            severity: "critical",
            name: "foo",
            version: "1.0.0",
            from: ["app@1", "a@1", "foo@1.0.0"],
          },
          {
            id: "SNYK-JS-FOO-1",
            severity: "critical",
            name: "foo",
            version: "1.0.0",
            from: ["app@1", "b@1", "foo@1.0.0"],
          },
          { id: "SNYK-JS-BAR-2", severity: "critical", name: "bar", version: "2.0.0" },
        ],
      },
      { sha: SHA },
    );

    expect(result.findings).toHaveLength(4);
    expect(result.counts).toEqual({ critical: 2, high: 0, medium: 0, low: 0 });
    expect(groupFindingsById(result.findings).map(group => [group.finding.id, group.occurrences])).toEqual([
      ["SNYK-JS-FOO-1", 3],
      ["SNYK-JS-BAR-2", 1],
    ]);
    expect(
      isSnykScanResult({
        ...result,
        counts: { critical: 4, high: 0, medium: 0, low: 0 },
      }),
    ).toBe(false);
  });

  test("extracts CVEs from fallback fields", () => {
    const result = parseSnykOutput(
      {
        vulnerabilities: [
          { id: "SNYK-CVE-2025-12345", title: "Related to CVE-2024-9999", severity: "high", name: "a", version: "1" },
        ],
      },
      { sha: SHA },
    );

    expect(result.findings[0].cves).toEqual(["CVE-2025-12345", "CVE-2024-9999"]);
  });

  test("does not replace a complete result with a later partial", () => {
    const complete = parseSnykOutput({ vulnerabilities: [] }, { sha: SHA, scannedAt: "2026-08-21T10:00:00.000Z" });
    const partial = parseSnykOutput([{ error: "broken project" }, { projectName: "working", vulnerabilities: [] }], {
      sha: SHA,
      scannedAt: "2026-08-24T10:00:00.000Z",
    });

    expect(shouldReplaceSnykResult(undefined, partial)).toBe(true);
    expect(shouldReplaceSnykResult(partial, complete)).toBe(false);
    expect(shouldReplaceSnykResult(complete, partial)).toBe(false);
    expect(shouldReplaceSnykResult(partial, { ...complete, scannedAt: "2026-08-25T10:00:00.000Z" })).toBe(true);
    expect(shouldReplaceSnykResult(complete, { ...complete, scannedAt: "2026-08-25T10:00:00.000Z" })).toBe(true);
  });

  test("rejects failed project counts without partial status", () => {
    expect(
      isSnykScanResult({
        sha: SHA,
        scannedAt: "2026-08-21T10:00:00.000Z",
        counts: { critical: 0, high: 0, medium: 0, low: 0 },
        findings: [],
        failedProjects: 1,
      }),
    ).toBe(false);
  });
});
