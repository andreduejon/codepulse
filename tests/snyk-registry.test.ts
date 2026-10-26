import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeProviderCaches } from "../src/providers/shared/sha-sqlite-cache";
import { createRegistryLookup, RegistryCache } from "../src/providers/snyk/registry";
import type { SnykCommandRunner } from "../src/providers/snyk/scanner";

const roots: string[] = [];
async function cacheRoot() {
  const root = await mkdtemp(join(tmpdir(), "codepulse-registry-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    closeProviderCaches(root);
    await rm(root, { recursive: true, force: true });
  }
});

function runner(outputs: Record<string, string>) {
  const calls: string[][] = [];
  const run: SnykCommandRunner = async command => {
    calls.push(command);
    const stdout = outputs[command.slice(2, -1).join(" ")];
    return stdout === undefined ? { stdout: "", stderr: "E404", exitCode: 1 } : { stdout, exitCode: 0 };
  };
  return { run, calls };
}

describe("registry lookup", () => {
  test("asks pnpm view, keeps only dependency ranges, and caches across lookups", async () => {
    const root = await cacheRoot();
    const { run, calls } = runner({
      "path-to-regexp versions": JSON.stringify(["0.1.10", "0.1.12"]),
      "express@4.21.2": JSON.stringify({
        name: "express",
        dependencies: { "path-to-regexp": "0.1.12", qs: "6.13.0" },
        optionalDependencies: { fsevents: "^2" },
        readme: "large",
      }),
    });
    const make = () =>
      createRegistryLookup({
        runCommand: run,
        cwd: "/repo",
        which: name => (name === "pnpm" ? "/usr/local/bin/pnpm" : null),
        cache: new RegistryCache(root),
      });
    const lookup = make();
    expect(await lookup?.versions("path-to-regexp")).toEqual(["0.1.10", "0.1.12"]);
    expect(await lookup?.dependencies("express", "4.21.2")).toEqual({
      fsevents: "^2",
      "path-to-regexp": "0.1.12",
      qs: "6.13.0",
    });
    expect(calls).toEqual([
      ["pnpm", "view", "path-to-regexp", "versions", "--json"],
      ["pnpm", "view", "express@4.21.2", "--json"],
    ]);
    // A later scan reads the cache instead of the registry.
    const again = make();
    expect(await again?.dependencies("express", "4.21.2")).toMatchObject({ qs: "6.13.0" });
    expect(await again?.versions("path-to-regexp")).toEqual(["0.1.10", "0.1.12"]);
    expect(calls).toHaveLength(2);
  });

  test("answers null when the registry fails, without caching the failure", async () => {
    const root = await cacheRoot();
    const { run, calls } = runner({});
    const lookup = createRegistryLookup({
      runCommand: run,
      cwd: "/repo",
      which: () => "/usr/bin/npm",
      cache: new RegistryCache(root),
    });
    expect(await lookup?.versions("missing")).toBeNull();
    expect(await lookup?.dependencies("missing", "1.0.0")).toBeNull();
    expect(calls[0][0]).toBe("pnpm");
    expect(new RegistryCache(root).read("versions:missing")).toBeUndefined();
  });

  test("falls back to npm, and skips tools that need a shell", async () => {
    const { run } = runner({});
    const which = (paths: Record<string, string>) => (name: string) => paths[name] ?? null;
    const options = { runCommand: run, cwd: "/repo", cache: new RegistryCache(await cacheRoot()) };
    expect(createRegistryLookup({ ...options, which: which({ npm: "/usr/bin/npm" }) })).not.toBeNull();
    expect(createRegistryLookup({ ...options, which: which({ pnpm: "C:\\pnpm.cmd", npm: "C:\\npm.cmd" }) })).toBeNull();
    expect(createRegistryLookup({ ...options, which: which({}) })).toBeNull();
  });
});
