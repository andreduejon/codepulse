import { describe, expect, test } from "bun:test";
import { applyOverrideRules, overrideTarget, parsePnpmLockfileOverrides } from "../src/providers/snyk/overrides";
import type { SnykDependencyGraph } from "../src/providers/snyk/types";

describe("overrideTarget", () => {
  test("is the last step of a selector, without its version", () => {
    expect(overrideTarget("lodash")).toBe("lodash");
    expect(overrideTarget("lodash@<4.17.21")).toBe("lodash");
    expect(overrideTarget("@scope/pkg")).toBe("@scope/pkg");
    expect(overrideTarget("@scope/pkg@^1")).toBe("@scope/pkg");
    expect(overrideTarget("express@4>path-to-regexp")).toBe("path-to-regexp");
    expect(overrideTarget("a>@scope/b@<2")).toBe("@scope/b");
  });
});

describe("parsePnpmLockfileOverrides", () => {
  test("reads the top-level overrides section only", () => {
    const lockfile = [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "",
      "overrides:",
      "  lodash: 4.17.21",
      "  '@babel/core@<7.26': ^7.26.0",
      "  express@4>path-to-regexp: 0.1.12",
      "  removed-pkg: '-'",
      "",
      "importers:",
      "  .:",
      "    dependencies:",
      "      lodash:",
      "        specifier: ^4.17.0",
    ].join("\n");
    expect(parsePnpmLockfileOverrides(lockfile)).toEqual([
      { name: "lodash", spec: "4.17.21" },
      { name: "@babel/core", spec: "^7.26.0" },
      { name: "path-to-regexp", spec: "0.1.12" },
    ]);
  });

  test("is empty without an overrides section", () => {
    expect(parsePnpmLockfileOverrides("lockfileVersion: '9.0'\nimporters: {}\n")).toEqual([]);
  });
});

describe("applyOverrideRules", () => {
  const graph = (): SnykDependencyGraph => ({
    targetFile: "package.json",
    packageManager: "pnpm",
    rootNodeId: "root",
    packages: [
      { id: "app@1.0.0", name: "app", version: "1.0.0" },
      { id: "lodash@4.17.21", name: "lodash", version: "4.17.21" },
      { id: "semver@6.3.1", name: "semver", version: "6.3.1" },
      { id: "semver@7.6.3", name: "semver", version: "7.6.3" },
      { id: "alias@1.0.0", name: "alias", version: "1.0.0" },
    ],
    nodes: [{ nodeId: "root", pkgId: "app@1.0.0", deps: [], scope: "prod", referenceNodeId: null }],
  });

  test("marks packages by name, within the override's range when it has one", () => {
    const g = graph();
    applyOverrideRules(g, [
      { name: "lodash", spec: "4.17.21" },
      { name: "semver", spec: "^7.5.2" },
      { name: "alias", spec: "npm:other@1.0.0" },
      { name: "app", spec: "*" },
    ]);
    expect(Object.fromEntries(g.packages.map(pkg => [pkg.id, pkg.pin ?? null]))).toEqual({
      "app@1.0.0": null,
      "lodash@4.17.21": "override",
      "semver@6.3.1": null,
      "semver@7.6.3": "override",
      "alias@1.0.0": "override",
    });
  });
});
