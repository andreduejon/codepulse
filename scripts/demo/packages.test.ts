import { describe, expect, test } from "bun:test";
import { parseSnykDepGraphs } from "../../src/providers/snyk/dep-graph";
import { parseSnykOutput } from "../../src/providers/snyk/parser";
import {
  ADMIN_MANIFEST,
  compareVersions,
  dependencyTree,
  lockfile,
  registryView,
  SHOP_MANIFESTS,
  vulnerabilities,
} from "./packages";

const ids = (manifest: Parameters<typeof dependencyTree>[0]) =>
  new Set(vulnerabilities(dependencyTree(manifest)).map(finding => `${finding.packageName}@${finding.version}`));

describe("the demo's npm world", () => {
  test("compares versions, a prerelease before its release", () => {
    expect(compareVersions("4.17.20", "4.17.21")).toBe(-1);
    expect(compareVersions("2.14.0-beta.3", "2.14.0")).toBe(-1);
    expect(compareVersions("2.14.1", "2.14.0-beta.3")).toBe(1);
    expect(compareVersions("1.2.6", "1.2.6")).toBe(0);
  });

  test("findings follow the commits: axios fixed, jsonwebtoken new, the override fixes minimist", () => {
    expect(ids(SHOP_MANIFESTS.initial)).toEqual(new Set(["braces@3.0.2"]));
    expect(ids(SHOP_MANIFESTS.cart)).toEqual(
      new Set(["lodash@4.17.15", "axios@1.5.1", "minimist@1.2.5", "braces@3.0.2"]),
    );
    expect(ids(SHOP_MANIFESTS.rounding)).toEqual(
      new Set(["lodash@4.17.20", "minimist@1.2.5", "jsonwebtoken@8.5.1", "braces@3.0.2"]),
    );
    expect(ids(SHOP_MANIFESTS.payments)).toEqual(
      new Set([
        "lodash@4.17.20",
        "jsonwebtoken@8.5.1",
        "@company/payments-gateway-client-with-a-very-long-package-name@2.14.0-beta.3",
        "braces@3.0.2",
      ]),
    );
    expect(ids(ADMIN_MANIFEST)).toEqual(new Set());
  });

  test("the fake Snyk's graph and findings are what the app's parsers accept", () => {
    const tree = dependencyTree(SHOP_MANIFESTS.payments);
    const [graph] = parseSnykDepGraphs(
      `DepGraph data:\n${JSON.stringify(tree.graph)}\nDepGraph target:\npackage-lock.json\nDepGraph end`,
    );
    expect(graph.packages.some(pkg => pkg.name === "minimist" && pkg.version === "1.2.6")).toBe(true);
    expect(graph.nodes.find(node => node.pkgId === "jest@29.7.0")?.scope).toBe("dev");
    expect(graph.nodes.some(node => node.referenceNodeId !== null)).toBe(true);

    const scan = parseSnykOutput(
      [
        {
          ok: false,
          projectName: "shop",
          displayTargetFile: "package-lock.json",
          targetFile: "package-lock.json",
          packageManager: "npm",
          vulnerabilities: vulnerabilities(tree),
        },
      ],
      { sha: "a".repeat(40) },
    );
    expect(scan.counts).toMatchObject({ critical: 1, high: 3, medium: 0, low: 0 });
  });

  test("npm view answers versions and manifests, and nothing it does not know", () => {
    expect(registryView("minimist", "versions")).toEqual(["1.2.5", "1.2.6", "1.2.7", "1.2.8"]);
    expect(registryView("mkdirp@0.5.5", undefined)).toEqual({
      name: "mkdirp",
      version: "0.5.5",
      dependencies: { minimist: "^1.2.5" },
    });
    expect(registryView("@company/payments-gateway-client-with-a-very-long-package-name", "versions")).toContain(
      "2.14.1",
    );
    expect(registryView("left-pad", "versions")).toBeUndefined();
    expect(registryView("mkdirp@9.9.9", undefined)).toBeUndefined();
  });

  test("the lockfile lists the installed versions", () => {
    const lock = JSON.parse(lockfile(SHOP_MANIFESTS.payments));
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages["node_modules/minimist"]).toEqual({ version: "1.2.6" });
    expect(lock.packages["node_modules/jest"]).toEqual({ version: "29.7.0", dev: true });
  });
});
