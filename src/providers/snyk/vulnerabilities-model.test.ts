import { expect, test } from "bun:test";
import { partialScanText } from "./vulnerabilities-model";

test("the partial scan line names failed manifests and marks unnamed ones", () => {
  expect(partialScanText({ failedProjects: 1 })).toBe("partial scan · 1 project failed");
  expect(partialScanText({ failedProjects: 2, failedTargets: ["a/package.json", "b/pom.xml"] })).toBe(
    "partial scan · 2 projects failed: a/package.json, b/pom.xml",
  );
  expect(partialScanText({ failedProjects: 3, failedTargets: ["a/package.json"] })).toBe(
    "partial scan · 3 projects failed: a/package.json, …",
  );
});
