import { describe, expect, test } from "bun:test";
import { snykPartialScanNotice, snykProjectNotice } from "../src/providers/snyk/project-notice";
import type { SnykDependencyProjectResult } from "../src/providers/snyk/types";

const project = (
  targetFile: string,
  status: SnykDependencyProjectResult["status"],
  reason: string | null = null,
): SnykDependencyProjectResult => ({ targetFile, packageManager: "npm", status, graphs: [], reason });

describe("snykProjectNotice", () => {
  test("is empty when every project has a graph", () => {
    expect(snykProjectNotice([project("package.json", "scanned")])).toBeNull();
  });

  test("lists failed projects before skipped ones, with their reasons", () => {
    const notice = snykProjectNotice([
      project("skipped/package.json", "skipped", "No lockfile."),
      project("web/package.json", "failed", "Missing node_modules folder."),
      project("api/package.json", "failed"),
    ]);
    expect(notice).toEqual({
      kind: "warning",
      title: "2 projects failed, 1 skipped",
      detail: [],
      entries: [
        { label: "web/package.json", text: "Missing node_modules folder." },
        { label: "api/package.json", text: "failed" },
        { label: "skipped/package.json", text: "No lockfile." },
      ],
    });
  });

  test("is informational when projects were only skipped", () => {
    expect(snykProjectNotice([project("a/package.json", "skipped", "No lockfile.")])).toMatchObject({
      kind: "info",
      title: "1 project skipped",
    });
  });

  test("collapses projects beyond five into a count", () => {
    const notice = snykProjectNotice(Array.from({ length: 7 }, (_, i) => project(`p${i}/package.json`, "failed")));
    expect(notice?.entries).toHaveLength(5);
    expect(notice?.footer).toBe("+2 more");
  });
});

describe("snykPartialScanNotice", () => {
  test("is empty for a complete scan", () => {
    expect(snykPartialScanNotice({})).toBeNull();
  });

  test("names the failed manifests", () => {
    expect(
      snykPartialScanNotice({ partial: true, failedProjects: 2, failedTargets: ["a/package.json", "b/pom.xml"] }),
    ).toEqual({
      kind: "warning",
      title: "Partial scan · 2 projects failed",
      detail: ["Findings cover the other projects."],
      entries: [{ label: "a/package.json" }, { label: "b/pom.xml" }],
    });
  });

  test("shows Snyk's reason under each failed manifest when it printed one", () => {
    expect(
      snykPartialScanNotice({
        partial: true,
        failedProjects: 2,
        failedTargets: ["a/package.json", "b/pom.xml"],
        failureReasons: { "b/pom.xml": "Could not resolve dependencies." },
      })?.entries,
    ).toEqual([{ label: "a/package.json" }, { label: "b/pom.xml", text: "Could not resolve dependencies." }]);
  });

  test("counts failures Snyk did not name", () => {
    expect(
      snykPartialScanNotice({ partial: true, failedProjects: 3, failedTargets: ["a/package.json"] }),
    ).toMatchObject({
      title: "Partial scan · 3 projects failed",
      entries: [{ label: "a/package.json" }],
      footer: "2 not named by Snyk",
    });
    expect(snykPartialScanNotice({ partial: true, failedProjects: 1 })).toMatchObject({
      title: "Partial scan · 1 project failed",
      entries: [],
      footer: "1 not named by Snyk",
    });
  });
});
