import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyOverrideRules,
  highestSatisfying,
  markRemovableOverrides,
  type OverrideRule,
  overrideTarget,
  parseNpmOverrides,
  parsePnpmLockfileOverrides,
  parseYarnResolutions,
  projectOverrideRules,
} from "../src/providers/snyk/overrides";
import type { RegistryLookup } from "../src/providers/snyk/registry";
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
      { name: "path-to-regexp", spec: "0.1.12", parent: "express" },
    ]);
  });

  test("is empty without an overrides section", () => {
    expect(parsePnpmLockfileOverrides("lockfileVersion: '9.0'\nimporters: {}\n")).toEqual([]);
  });
});

describe("parseNpmOverrides", () => {
  test("nested objects limit rules to their parent, and `.` overrides the parent itself", () => {
    expect(
      parseNpmOverrides({
        foo: "1.0.0",
        "@scope/bar@^2": "2.1.0",
        express: { ".": "4.21.0", "path-to-regexp": "0.1.12", body: { qs: "6.13.0" } },
      }),
    ).toEqual([
      { name: "foo", spec: "1.0.0" },
      { name: "@scope/bar", spec: "2.1.0" },
      { name: "express", spec: "4.21.0" },
      { name: "path-to-regexp", spec: "0.1.12", parent: "express" },
      { name: "qs", spec: "6.13.0", parent: "body" },
    ]);
  });

  test("`$name` takes the project's own range, and is dropped without one", () => {
    expect(parseNpmOverrides({ foo: "$foo", bar: "$bar" }, { foo: "^1.2.0" })).toEqual([
      { name: "foo", spec: "^1.2.0" },
    ]);
  });

  test("is empty for anything but an object", () => {
    expect(parseNpmOverrides(undefined)).toEqual([]);
    expect(parseNpmOverrides(["foo"])).toEqual([]);
  });
});

describe("parseYarnResolutions", () => {
  test("reads the target and its direct parent, keeping scopes together", () => {
    expect(
      parseYarnResolutions({
        foo: "1.0.0",
        "**/bar": "^2.0.0",
        "express/path-to-regexp": "0.1.12",
        "@scope/a/@scope/b": "3.0.0",
        "webpack/**/qs": "6.13.0",
        "baz@npm:^1.0.0": "npm:1.4.0",
        skipped: 1,
      }),
    ).toEqual([
      { name: "foo", spec: "1.0.0" },
      { name: "bar", spec: "^2.0.0" },
      { name: "path-to-regexp", spec: "0.1.12", parent: "express" },
      { name: "@scope/b", spec: "3.0.0", parent: "@scope/a" },
      { name: "qs", spec: "6.13.0" },
      { name: "baz", spec: "npm:1.4.0" },
    ]);
  });
});

describe("projectOverrideRules", () => {
  const withManifest = async (manifest: unknown, run: (root: string) => Promise<void>) => {
    const root = await mkdtemp(join(tmpdir(), "codepulse-overrides-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
      await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
  const manifest = { overrides: { a: "1.0.0" }, resolutions: { b: "2.0.0" } };

  test("npm reads overrides, Yarn resolutions, Bun both", async () => {
    await withManifest(manifest, async root => {
      const rules = (packageManager: string, targetFile: string) =>
        projectOverrideRules(root, { packageManager, targetFile });
      expect(await rules("npm", "package-lock.json")).toEqual([{ name: "a", spec: "1.0.0" }]);
      expect(await rules("yarn", "yarn.lock")).toEqual([{ name: "b", spec: "2.0.0" }]);
      expect(await rules("bun", "bun.lock")).toEqual([
        { name: "a", spec: "1.0.0" },
        { name: "b", spec: "2.0.0" },
      ]);
      expect(await rules("maven", "pom.xml")).toEqual([]);
    });
  });

  test("is empty without a readable manifest", async () => {
    expect(
      await projectOverrideRules(tmpdir(), { packageManager: "npm", targetFile: "missing/package-lock.json" }),
    ).toEqual([]);
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

describe("highestSatisfying", () => {
  const versions = ["0.1.7", "0.1.10", "0.1.12", "0.2.0", "1.0.0-beta.1", "1.0.0"];

  test("picks the highest version in range, like pnpm and npm", () => {
    expect(highestSatisfying(versions, "~0.1.7")).toBe("0.1.12");
    expect(highestSatisfying(versions, "0.1.10")).toBe("0.1.10");
    expect(highestSatisfying(versions, "^0.2.0")).toBe("0.2.0");
    expect(highestSatisfying(versions, ">=0.2.0")).toBe("1.0.0");
    expect(highestSatisfying(versions, "^2.0.0")).toBeNull();
  });

  test("skips prereleases unless the range names one", () => {
    expect(highestSatisfying(["1.0.0-beta.1"], ">=0.2.0")).toBeNull();
    expect(highestSatisfying(versions, "1.0.0-beta.1")).toBe("1.0.0-beta.1");
  });
});

describe("markRemovableOverrides", () => {
  /** app → express@4.21.2 → path-to-regexp@0.1.12 (overridden), app → path-to-regexp directly when `direct`. */
  const graph = (direct = false): SnykDependencyGraph => ({
    targetFile: "package.json",
    packageManager: "pnpm",
    rootNodeId: "root",
    packages: [
      { id: "app@1.0.0", name: "app", version: "1.0.0" },
      { id: "express@4.21.2", name: "express", version: "4.21.2" },
      { id: "path-to-regexp@0.1.12", name: "path-to-regexp", version: "0.1.12", pin: "override" },
    ],
    nodes: [
      {
        nodeId: "root",
        pkgId: "app@1.0.0",
        deps: direct ? ["express", "ptr"] : ["express"],
        scope: "prod",
        referenceNodeId: null,
      },
      { nodeId: "express", pkgId: "express@4.21.2", deps: ["ptr"], scope: "prod", referenceNodeId: null },
      { nodeId: "ptr", pkgId: "path-to-regexp@0.1.12", deps: [], scope: "prod", referenceNodeId: null },
    ],
  });
  const lookup = (expressAsks: string | undefined, versions = ["0.1.10", "0.1.12"]) => {
    const calls: string[] = [];
    const registry: RegistryLookup = {
      versions: async name => {
        calls.push(`versions ${name}`);
        return versions;
      },
      dependencies: async (name, version) => {
        calls.push(`dependencies ${name}@${version}`);
        return expressAsks === undefined ? null : { "path-to-regexp": expressAsks };
      },
    };
    return { registry, calls };
  };
  const noRoot = async () => ({});
  const rule: OverrideRule = { name: "path-to-regexp", spec: ">=0.1.12" };
  const removable = (g: SnykDependencyGraph) => g.packages[2].removable ?? false;

  test("is removable when the parent's own range already resolves into the override", async () => {
    const g = graph();
    const { registry, calls } = lookup("~0.1.10");
    await markRemovableOverrides([g], [rule], registry, noRoot);
    expect(removable(g)).toBe(true);
    expect(calls.sort()).toEqual(["dependencies express@4.21.2", "versions path-to-regexp"]);
  });

  test("stays when a parent pins a version outside the override", async () => {
    const g = graph();
    await markRemovableOverrides([g], [rule], lookup("0.1.10").registry, noRoot);
    expect(removable(g)).toBe(false);
  });

  test("stays when the registry can't answer", async () => {
    const g = graph();
    await markRemovableOverrides([g], [rule], lookup(undefined).registry, noRoot);
    expect(removable(g)).toBe(false);
  });

  test("checks the project's own range for a direct dependency", async () => {
    const g = graph(true);
    const { registry } = lookup("~0.1.10");
    await markRemovableOverrides([g], [rule], registry, async () => ({ "path-to-regexp": "0.1.7" }));
    expect(removable(g)).toBe(false);
    const again = graph(true);
    await markRemovableOverrides([again], [rule], registry, async () => ({ "path-to-regexp": "^0.1.10" }));
    expect(removable(again)).toBe(true);
  });

  test("a parent selector only asks that parent", async () => {
    const g = graph(true);
    const { registry, calls } = lookup("~0.1.10");
    await markRemovableOverrides([g], [{ ...rule, parent: "express" }], registry, async () => ({}));
    expect(removable(g)).toBe(true);
    expect(calls).toContain("dependencies express@4.21.2");
  });

  test("exact pins and aliases are never removable", async () => {
    const g = graph();
    await markRemovableOverrides(
      [g],
      [{ name: "path-to-regexp", spec: "npm:other@1.0.0" }],
      lookup("~0.1.10").registry,
      noRoot,
    );
    expect(removable(g)).toBe(false);
  });
});
