import { expect, test } from "bun:test";
import { diffSnykScans } from "./scan-diff";
import type { SnykFinding } from "./types";

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
