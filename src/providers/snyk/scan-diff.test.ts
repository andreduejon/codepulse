import { expect, test } from "bun:test";
import { compareSnykScans, diffSnykScans, findSnykBaseline, snykBaselineNote } from "./scan-diff";
import type { SnykFinding, SnykScanResult } from "./types";

export const finding = (id: string, dependency: string, installedVersion: string, extra: Partial<SnykFinding> = {}) =>
  ({
    id,
    title: `${id} title`,
    severity: "high",
    dependency,
    installedVersion,
    fixedVersion: null,
    fixedIn: [],
    exploit: null,
    cvssScore: 7.5,
    project: null,
    targetFile: "package.json",
    ...extra,
  }) as SnykFinding;

test("new findings are the ones the parent did not have; fixed ones the parent had and this commit has not", () => {
  const kept = finding("SNYK-JS-MINIMIST-1", "minimist", "1.2.5");
  const added = finding("SNYK-JS-LODASH-1", "lodash", "4.17.20");
  const gone = finding("SNYK-JS-AXIOS-1", "axios", "0.21.0");
  const diff = diffSnykScans([kept, added], [kept, gone]);
  expect([...diff.added]).toEqual([added]);
  expect(diff.fixed).toEqual([gone]);
});

test("a dependency bump that keeps the same vulnerability is neither new nor fixed", () => {
  const before = finding("SNYK-JS-LODASH-1", "lodash", "4.17.19");
  const after = finding("SNYK-JS-LODASH-1", "lodash", "4.17.20");
  const diff = diffSnykScans([after], [before]);
  expect(diff.added.size).toBe(0);
  expect(diff.fixed).toEqual([]);
});

test("compares with the first parent's scan, or else the nearest scanned commit down the first-parent line", () => {
  const firstParent: Record<string, string> = { d: "c", c: "b", b: "a" };
  const scans = new Map<string, SnykScanResult>([["a", { sha: "a" } as SnykScanResult]]);
  const baseline = (sha: string) =>
    findSnykBaseline(
      sha,
      commit => firstParent[commit],
      commit => scans.get(commit),
    );
  expect(baseline("d")).toEqual({ sha: "a", scan: scans.get("a") as SnykScanResult, stepsBack: 3 });
  scans.set("c", { sha: "c" } as SnykScanResult);
  expect(baseline("d")).toEqual({ sha: "c", scan: scans.get("c") as SnykScanResult, stepsBack: 1 });
  // The root has no parent; nothing scanned below means nothing to compare with.
  expect(baseline("a")).toBeNull();
  scans.clear();
  expect(baseline("d")).toBeNull();
});

test("the note names the parent, or how far back the compared commit is", () => {
  const scan = { sha: "x" } as SnykScanResult;
  expect(snykBaselineNote({ sha: "4c5d6e7f".repeat(5), scan, stepsBack: 1 })).toBe("vs parent 4c5d6e7");
  expect(snykBaselineNote({ sha: "1a2b3c4d".repeat(5), scan, stepsBack: 3 })).toBe("vs 1a2b3c4, 3 commits back");
});

const scanOf = (findings: SnykFinding[], extra: Partial<SnykScanResult> = {}) =>
  ({ sha: "a".repeat(40), findings, ...extra }) as SnykScanResult;

test("a project a partial scan could not resolve is left out on both sides, not listed as fixed or new", () => {
  const root = finding("SNYK-JS-AXIOS-1", "axios", "0.21.0");
  const admin = finding("SNYK-JS-MINIMIST-1", "minimist", "1.2.5", { targetFile: "admin/package.json" });
  const failedHere = compareSnykScans(
    scanOf([root], { partial: true, failedProjects: 1, failedTargets: ["admin/package.json"] }),
    scanOf([root, admin]),
  );
  expect(failedHere?.fixed).toEqual([]);
  const failedInParent = compareSnykScans(
    scanOf([root, admin]),
    scanOf([root], { partial: true, failedProjects: 1, failedTargets: ["admin/package.json"] }),
  );
  expect(failedInParent?.added.size).toBe(0);
});

test("nothing is compared when a partial scan does not say which projects failed", () => {
  const root = finding("SNYK-JS-AXIOS-1", "axios", "0.21.0");
  expect(compareSnykScans(scanOf([]), scanOf([root], { partial: true, failedProjects: 1 }))).toBeNull();
  expect(
    compareSnykScans(scanOf([], { partial: true, failedProjects: 2, failedTargets: ["a"] }), scanOf([root])),
  ).toBeNull();
  expect(compareSnykScans(scanOf([]), scanOf([root]))?.fixed).toEqual([root]);
});
