import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  groupSnykFixes,
  groupSnykVulnerabilities,
  isMatureExploit,
  isSnykScanResult,
  parseSnykOutput,
  shouldReplaceSnykResult,
  snykFixKind,
} from "./parser";

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

    expect(result.includesDev).toBe(true);
    expect(result.dependencyProjects).toEqual([]);
    expect(isSnykScanResult(result)).toBe(true);
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

  test.each([
    {
      displayTargetFile: "./packages/app/package.json",
      targetFile: "legacy.json",
      expected: "packages/app/package.json",
    },
    {
      displayTargetFile: ".\\packages\\app\\package.json",
      targetFile: "legacy.json",
      expected: "packages/app/package.json",
    },
    { displayTargetFile: "packages/app/package.json", expected: "packages/app/package.json" },
    { displayTargetFile: "/private/fixture/package.json", targetFile: "package.json", expected: "package.json" },
    { targetFile: "./legacy/package.json", expected: "legacy/package.json" },
    { targetFile: "packages/fixture app/package.json", expected: "packages/fixture app/package.json" },
  ])("prefers displayTargetFile with legacy fallback (%#)", ({ expected, ...targets }) => {
    const result = parseSnykOutput(
      { ...targets, vulnerabilities: [{ id: "A", severity: "high", name: "fixture", version: "1" }] },
      { sha: SHA },
    );

    expect(result.findings[0].targetFile).toBe(expected);
    expect(isSnykScanResult(result)).toBe(true);
  });

  test.each([
    "../package.json",
    "packages/../package.json",
    "/private/fixture/package.json",
    "C:\\fixture\\package.json",
    "C:package.json",
    "\\\\host\\share\\package.json",
    "package\0.json",
  ])("does not retain unsafe target fields %j", target => {
    for (const field of ["displayTargetFile", "targetFile"]) {
      const result = parseSnykOutput(
        { [field]: target, vulnerabilities: [{ id: "A", severity: "high", name: "fixture", version: "1" }] },
        { sha: SHA },
      );

      expect(result.findings[0].targetFile).toBeNull();
      expect(result.findings[0].project).toBeNull();
      expect(isSnykScanResult(result)).toBe(true);
    }
  });

  test.each(["/private/fixture/repo", "C:\\fixture\\repo", "\\\\host\\share\\repo"])(
    "drops absolute project names and never stores result.path (%j)",
    projectName => {
      const result = parseSnykOutput(
        {
          projectName,
          displayTargetFile: "packages/app/package.json",
          targetFile: "/private/fixture/target/package.json",
          path: "/private/fixture/raw-result-path",
          vulnerabilities: [{ id: "A", severity: "high", name: "fixture", version: "1" }],
        },
        { sha: SHA },
      );

      expect(result.findings[0]).toMatchObject({ project: null, targetFile: "packages/app/package.json" });
      expect(JSON.stringify(result)).not.toContain("/private/fixture");
      expect(JSON.stringify(result)).not.toContain(JSON.stringify(projectName).slice(1, -1));
      expect(isSnykScanResult(result)).toBe(true);
    },
  );

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

  test("counts one entry per vulnerability, manifest and package, not per path", () => {
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
    expect(groupSnykVulnerabilities(result.findings).map(entry => [entry.finding.id, entry.paths])).toEqual([
      ["SNYK-JS-BAR-2", 1],
      ["SNYK-JS-FOO-1", 3],
    ]);
    const twoManifests = parseSnykOutput(
      [
        {
          displayTargetFile: "api/pom.xml",
          vulnerabilities: [{ id: "S-1", severity: "high", name: "a", version: "1" }],
        },
        {
          displayTargetFile: "web/pom.xml",
          vulnerabilities: [{ id: "S-1", severity: "high", name: "a", version: "1" }],
        },
      ],
      { sha: SHA },
    );
    expect(twoManifests.counts.high).toBe(2);
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
        includesDev: true,
        dependencyProjects: [],
        counts: { critical: 0, high: 0, medium: 0, low: 0 },
        findings: [],
        failedProjects: 1,
      }),
    ).toBe(false);
  });
});

describe("isSnykScanResult", () => {
  test.each([
    { includesDev: undefined },
    { includesDev: false },
    { dependencyProjects: undefined },
    { dependencyProjects: null },
    { dependencyProjects: {} },
  ])("rejects old or malformed snapshot metadata (%#)", fields => {
    const scan = parseSnykOutput({ vulnerabilities: [] }, { sha: SHA });
    expect(isSnykScanResult({ ...scan, ...fields })).toBe(false);
  });

  test.each([
    { targetFile: "/private/fixture/package.json" },
    { targetFile: "../package.json" },
    { targetFile: "./package.json" },
    { targetFile: "packages\\app\\package.json" },
    { project: "/private/fixture/repo" },
    { project: "C:\\fixture\\repo" },
  ])("rejects cached findings with unsafe or unnormalized paths (%#)", fields => {
    const scan = parseSnykOutput(
      { vulnerabilities: [{ id: "A", severity: "high", name: "fixture", version: "1" }] },
      { sha: SHA },
    );
    expect(isSnykScanResult({ ...scan, findings: [{ ...scan.findings[0], ...fields }] })).toBe(false);
  });
});

describe("fix-oriented vulnerability entries", () => {
  const base = {
    id: "SNYK-1",
    title: "Bypass",
    severity: "high" as const,
    dependency: "core",
    installedVersion: "11.0.24",
    fixedVersion: "11.0.25",
    project: "app",
    fixedIn: [],
    exploit: null,
    cvssScore: null,
    targetFile: "pom.xml",
    cves: ["CVE-2026-1"],
  };

  test("fixedIn prefers the lowest fix above the installed version, else lists all", () => {
    const parse = (fixedIn: string[], version = "11.0.24") =>
      parseSnykOutput(
        {
          vulnerabilities: [
            { id: "x", severity: "high", packageName: "core", version, fixedIn, from: ["app@1", `core@${version}`] },
          ],
        },
        { sha: SHA, scannedAt: "now" },
      ).findings[0].fixedVersion;
    expect(parse(["9.0.122", "10.1.47", "11.0.25", "11.0.30"])).toBe("11.0.25");
    expect(parse(["9.1.4.Final"], "9.1.3.Final")).toBe("9.1.4.Final");
    expect(parse(["1.0.0", "2.0.0"], "3.0.0")).toBe("1.0.0, 2.0.0");
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
  });

  test("fix kind: upgrade path or direct fix → upgrade, transitive fix → override, none → no fix", () => {
    expect(
      snykFixKind({ ...base, dependencyType: "transitive", upgradeDependency: "parent", upgradeVersion: "2" }),
    ).toBe("upgrade");
    expect(snykFixKind({ ...base, dependencyType: "direct" })).toBe("upgrade");
    expect(snykFixKind({ ...base, dependencyType: "transitive" })).toBe("override");
    expect(snykFixKind({ ...base, fixedVersion: null })).toBe("no fix");
  });

  test("one entry per vulnerability, manifest and package; paths merge; fixable first", () => {
    const entries = groupSnykVulnerabilities([
      { ...base, fixedVersion: null },
      { ...base, targetFile: "api/pom.xml", dependencyType: "transitive" },
      { ...base, targetFile: "api/pom.xml", dependencyType: "transitive" },
      { ...base, targetFile: "api/pom.xml", dependency: "websocket", dependencyType: "direct" },
      { ...base, id: "SNYK-2", cves: [] },
    ]);
    expect(
      entries.map(entry => [entry.label, entry.finding.targetFile, entry.finding.dependency, entry.fix, entry.paths]),
    ).toEqual([
      ["CVE-2026-1", "api/pom.xml", "websocket", "upgrade", 1],
      ["CVE-2026-1", "api/pom.xml", "core", "override", 2],
      ["SNYK-2", "pom.xml", "core", "override", 1],
      ["CVE-2026-1", "pom.xml", "core", "no fix", 1],
    ]);
  });
});

test("license issues are excluded and cache entries without fixedIn are rejected", () => {
  const result = parseSnykOutput(
    {
      vulnerabilities: [
        { id: "snyk:lic:maven:fixture:EPL-2.0", type: "license", severity: "medium", name: "fixture", version: "1" },
        { id: "SNYK-1", severity: "high", name: "fixture", version: "1", fixedIn: ["2"] },
      ],
    },
    { sha: SHA, scannedAt: "2026-10-20T00:00:00.000Z" },
  );
  expect(result.findings.map(finding => finding.id)).toEqual(["SNYK-1"]);
  expect(result.findings[0].fixedIn).toEqual(["2"]);
  const scan = { ...result, includesDev: true, dependencyProjects: [] };
  expect(isSnykScanResult(scan)).toBe(true);
  const { fixedIn: _omitted, ...legacy } = result.findings[0];
  expect(isSnykScanResult({ ...scan, findings: [legacy] })).toBe(false);
});

test("CVSS score and exploit maturity are parsed; higher scores sort first within a fix kind", () => {
  const [finding] = parseSnykOutput(
    { vulnerabilities: [{ id: "A", severity: "high", name: "a", version: "1", cvssScore: 8.1, exploit: "Mature" }] },
    { sha: SHA, scannedAt: "2026-10-20T00:00:00.000Z" },
  ).findings;
  expect([finding.cvssScore, finding.exploit, isMatureExploit(finding)]).toEqual([8.1, "Mature", true]);
  expect(isMatureExploit({ ...finding, exploit: "Proof of Concept" })).toBe(false);
  const entries = groupSnykVulnerabilities([
    { ...finding, id: "LOW", cvssScore: 5 },
    { ...finding, id: "NONE", cvssScore: null },
    { ...finding, id: "HIGH", cvssScore: 9.8 },
  ]);
  expect(entries.map(entry => entry.label)).toEqual(["HIGH", "LOW", "NONE"]);
});

test("dependency groups: one per direct dependency, sizes sum to the total, highest target version", () => {
  const base = {
    id: "S",
    title: "t",
    severity: "high" as const,
    installedVersion: "1.0.0",
    project: "app",
    targetFile: "pom.xml",
    fixedIn: [],
    exploit: null,
    cvssScore: null,
    dependencyType: "transitive" as const,
  };
  const findings = [
    {
      ...base,
      id: "A",
      dependency: "core",
      fixedVersion: "1.0.5",
      dependencyPath: ["starter@4.1.1", "core@1.0.0"],
      cvssScore: 9.3,
    },
    {
      ...base,
      id: "B",
      dependency: "core",
      fixedVersion: "1.0.9",
      dependencyPath: ["starter@4.1.1", "core@1.0.0"],
      cvssScore: 5,
    },
    { ...base, id: "C", dependency: "ws", fixedVersion: "1.0.7", dependencyPath: ["starter@4.1.1", "ws@1.0.0"] },
    { ...base, id: "D", dependency: "json", fixedVersion: null, dependencyPath: ["encoder@9", "json@1.0.0"] },
    {
      ...base,
      id: "E",
      dependency: "lib",
      fixedVersion: "2.0.0",
      dependencyPath: ["ui@3", "lib@1.0.0"],
      upgradeDependency: "ui",
      upgradeVersion: "3.1",
    },
  ];
  const entries = groupSnykVulnerabilities(findings);
  const groups = groupSnykFixes(entries);
  // Direct fix first, then override-only, then unfixable.
  expect(groups.map(group => [group.key, group.entries.length])).toEqual([
    ["ui@3", 1],
    ["starter@4.1.1", 3],
    // Unfixable entries stay under the dependency they come through.
    ["encoder@9", 1],
  ]);
  expect(groups.reduce((sum, group) => sum + group.entries.length, 0)).toBe(entries.length);
  const packages = (index: number) =>
    groups[index].packages.map(pkg => [pkg.name, pkg.from, pkg.version, pkg.entries.map(entry => entry.label)]);
  // Upgrade path: the direct dependency itself is the fix (self), no package rows.
  expect([groups[0].self?.from, groups[0].self?.version, groups[0].packages]).toEqual(["3", "3.1", []]);
  // Highest needed version per package; CVEs nest under the package they are fixed by.
  expect(groups[1].self).toBeNull();
  expect(packages(1)).toEqual([
    ["core", "1.0.0", "1.0.9", ["A", "B"]],
    ["ws", "1.0.0", "1.0.7", ["C"]],
  ]);
  expect(packages(2)).toEqual([["json", "1.0.0", null, ["D"]]]);
});
