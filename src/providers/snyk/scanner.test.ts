import { afterEach, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { closeProviderCaches } from "../shared/sha-sqlite-cache";
import { SnykCache } from "./cache";
import {
  applyManifestScopes,
  killSnykProcessGroup,
  parseSnykProjectFailures,
  removeOrphanedScanWorktrees,
  runSnykCommand,
  type SnykCommandResult,
  type SnykCommandRunner,
  scanSnykCommit,
} from "./scanner";
import type { SnykDependencyGraph, SnykScanResult } from "./types";

const SHA = "a".repeat(40);
const roots: string[] = [];

afterEach(async () => {
  for (const path of roots) {
    closeProviderCaches(path);
    closeProviderCaches(join(path, "cache"));
  }
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "codepulse-snyk-scanner-test-"));
  roots.push(path);
  return path;
}

async function runLocal(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout.trim();
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function fakeSnyk(binPath: string, script: string, local = false): Promise<Record<string, string | undefined>> {
  await mkdir(binPath, { recursive: true });
  const packagePath = local ? join(binPath, "..", "snyk") : join(binPath, "node_modules", "snyk");
  await mkdir(packagePath, { recursive: true });
  const entryPath = join(packagePath, "cli.js");
  await writeFile(join(packagePath, "package.json"), JSON.stringify({ bin: { snyk: "cli.js" } }));
  await writeFile(entryPath, script);
  if (process.platform === "win32") {
    await copyFile(process.execPath, join(binPath, "node.exe"));
    const relativeEntry = local ? "..\\snyk\\cli.js" : "node_modules\\snyk\\cli.js";
    await writeFile(join(binPath, "snyk.cmd"), `@echo off\r\n"%~dp0node.exe" "%~dp0${relativeEntry}" %*\r\n`);
  } else {
    const executable = join(binPath, "snyk");
    await writeFile(executable, '#!/bin/sh\nexec "$FAKE_SNYK_BUN" "$FAKE_SNYK_ENTRY" "$@"\n');
    await chmod(executable, 0o755);
  }
  return {
    ...process.env,
    PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
    FAKE_SNYK_BUN: process.execPath,
    FAKE_SNYK_ENTRY: entryPath,
  };
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await Bun.sleep(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function dependencyGraph(packageManager = "yarn", target = "yarn.lock"): string {
  return `DepGraph data:\n${JSON.stringify({
    schemaVersion: "1.3.0",
    pkgManager: { name: packageManager },
    pkgs: [
      { id: "fixture@1.0.0", info: { name: "fixture", version: "1.0.0" } },
      { id: "dep@1.0.0", info: { name: "dep", version: "1.0.0" } },
    ],
    graph: {
      rootNodeId: "root",
      nodes: [
        { nodeId: "root", pkgId: "fixture@1.0.0", deps: [{ nodeId: "dep" }] },
        { nodeId: "dep", pkgId: "dep@1.0.0", deps: [], info: { labels: { scope: "prod" } } },
      ],
    },
  })}\nDepGraph target:\n${target}\nDepGraph end\n`;
}

async function dependencyFixture(files: Record<string, string>) {
  const testRoot = await root();
  const repoPath = join(testRoot, "repo");
  await mkdir(repoPath);
  let worktreePath = "";
  const calls: { command: string[]; cwd: string }[] = [];
  const output: { findings: SnykCommandResult; graph: SnykCommandResult; bun: SnykCommandResult } = {
    findings: {
      stdout: JSON.stringify({ packageManager: "yarn", displayTargetFile: "yarn.lock", vulnerabilities: [] }),
      exitCode: 0,
    },
    graph: { stdout: dependencyGraph(), exitCode: 0 },
    bun: { stdout: "", exitCode: 0 },
  };
  const runner: SnykCommandRunner = async (command, options) => {
    calls.push({ command, cwd: options.cwd });
    if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
    if (command[1] === "worktree" && command[2] === "add") {
      worktreePath = command[4];
      await mkdir(worktreePath);
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(worktreePath, path)), { recursive: true });
        await writeFile(join(worktreePath, path), content);
      }
    }
    if (command[1] === "ls-files") return { stdout: Object.keys(files).join("\0"), exitCode: 0 };
    if (command[0] === "bun") {
      if (output.bun.exitCode === 0) await writeFile(join(options.cwd, "yarn.lock"), "# yarn lockfile v1\n");
      return output.bun;
    }
    if (command[0] === "snyk") return command.includes("--print-graph") ? output.graph : output.findings;
    return { stdout: "", exitCode: 0 };
  };
  return { repoPath, cacheRoot: join(testRoot, "cache"), runner, output, calls, worktreePath: () => worktreePath };
}

describe("scanSnykCommit", () => {
  test("scans an exact commit with real git and a PATH-resolved Snyk executable", async () => {
    const testRoot = await root();
    const repoPath = join(testRoot, "repo");
    const binPath = join(testRoot, "bin space & (literal) %PATH% 'quote'");
    const cacheRoot = join(testRoot, "cache");
    const capturePath = join(testRoot, "snyk-capture.txt");
    await Promise.all([mkdir(repoPath), mkdir(binPath)]);

    await runLocal(["git", "init"], repoPath);
    await runLocal(["git", "config", "user.name", "Scanner Test"], repoPath);
    await runLocal(["git", "config", "user.email", "scanner@example.test"], repoPath);
    await writeFile(join(repoPath, "marker.txt"), "target commit\n");
    await runLocal(["git", "add", "marker.txt"], repoPath);
    await runLocal(["git", "commit", "-m", "target"], repoPath);
    const targetSha = await runLocal(["git", "rev-parse", "HEAD"], repoPath);
    await writeFile(join(repoPath, "marker.txt"), "current checkout\n");
    await runLocal(["git", "commit", "-am", "current"], repoPath);

    const checkoutBefore = {
      sha: await runLocal(["git", "rev-parse", "HEAD"], repoPath),
      branch: await runLocal(["git", "branch", "--show-current"], repoPath),
      status: await runLocal(["git", "status", "--porcelain"], repoPath),
      marker: await readFile(join(repoPath, "marker.txt"), "utf8"),
      worktrees: await runLocal(["git", "worktree", "list", "--porcelain"], repoPath),
    };

    const fixtureEnv = await fakeSnyk(
      binPath,
      `const { writeFileSync } = require("node:fs");
const git = (...args) => Bun.spawnSync(["git", ...args]);
writeFileSync(process.env.FAKE_SNYK_CAPTURE, [
  "sha=" + git("rev-parse", "HEAD").stdout.toString().trim(),
  "detached=" + (git("symbolic-ref", "-q", "HEAD").exitCode !== 0),
  "marker=" + git("show", "HEAD:marker.txt").stdout.toString().trim(),
  "token=" + process.env.SNYK_TOKEN,
  "args=" + process.argv.slice(2).join(" "),
].join("\\n"));
console.log(JSON.stringify({vulnerabilities:[{id:"SNYK-INTEGRATION",severity:"high",packageName:"dep",version:"1.0.0"}]}));
process.exit(1);
`,
    );

    const originalPath = process.env.PATH;
    const originalToken = process.env.CODEPULSE_TEST_SNYK_TOKEN;
    const originalCapture = process.env.FAKE_SNYK_CAPTURE;
    const originalBun = process.env.FAKE_SNYK_BUN;
    const originalEntry = process.env.FAKE_SNYK_ENTRY;
    let result: SnykScanResult;
    try {
      process.env.PATH = fixtureEnv.PATH;
      process.env.FAKE_SNYK_BUN = fixtureEnv.FAKE_SNYK_BUN;
      process.env.FAKE_SNYK_ENTRY = fixtureEnv.FAKE_SNYK_ENTRY;
      process.env.CODEPULSE_TEST_SNYK_TOKEN = "custom-token-value";
      process.env.FAKE_SNYK_CAPTURE = capturePath;
      result = await scanSnykCommit(
        { repoPath, sha: targetSha, tokenEnvVar: "CODEPULSE_TEST_SNYK_TOKEN" },
        { cacheRoot },
      );
    } finally {
      restoreEnv("PATH", originalPath);
      restoreEnv("CODEPULSE_TEST_SNYK_TOKEN", originalToken);
      restoreEnv("FAKE_SNYK_CAPTURE", originalCapture);
      restoreEnv("FAKE_SNYK_BUN", originalBun);
      restoreEnv("FAKE_SNYK_ENTRY", originalEntry);
    }

    expect(result.sha).toBe(targetSha);
    expect(result.counts.high).toBe(1);
    expect((await readFile(capturePath, "utf8")).trim().split("\n")).toEqual([
      `sha=${targetSha}`,
      "detached=true",
      "marker=target commit",
      "token=custom-token-value",
      "args=test --json --all-projects --dev",
    ]);
    expect(await new SnykCache({ root: cacheRoot }).read(repoPath, targetSha)).toEqual(result);
    expect({
      sha: await runLocal(["git", "rev-parse", "HEAD"], repoPath),
      branch: await runLocal(["git", "branch", "--show-current"], repoPath),
      status: await runLocal(["git", "status", "--porcelain"], repoPath),
      marker: await readFile(join(repoPath, "marker.txt"), "utf8"),
      worktrees: await runLocal(["git", "worktree", "list", "--porcelain"], repoPath),
    }).toEqual(checkoutBefore);
  });

  test("scans a detached worktree and caches exit 1 results", async () => {
    const cacheRoot = await root();
    const commands: { command: string[]; cwd: string; hasSignal: boolean }[] = [];
    const runner: SnykCommandRunner = async (command, options) => {
      commands.push({ command, cwd: options.cwd, hasSignal: !!options.signal });
      if (command[1] === "rev-parse") return { stdout: `${SHA}\n`, exitCode: 0 };
      if (command[0] === "snyk") {
        return {
          stdout: JSON.stringify({
            vulnerabilities: [{ id: "SNYK-1", severity: "high", packageName: "dep", version: "1.0.0" }],
          }),
          exitCode: 1,
        };
      }
      return { stdout: "", exitCode: 0 };
    };
    const controller = new AbortController();

    const result = await scanSnykCommit(
      { repoPath: "/repo", sha: SHA.slice(0, 8), signal: controller.signal },
      { cacheRoot, runCommand: runner, now: () => new Date("2026-08-21T10:00:00.000Z") },
    );

    expect(result.sha).toBe(SHA);
    expect(result.counts.high).toBe(1);
    expect(commands.find(call => call.command[0] === "snyk")?.command).toEqual([
      "snyk",
      "test",
      "--json",
      "--all-projects",
      "--dev",
    ]);
    expect(commands.find(call => call.command[0] === "snyk")?.cwd).toContain("codepulse-snyk-");
    expect(commands.some(call => call.command.slice(0, 4).join(" ") === "git worktree remove --force")).toBe(true);
    expect(await new SnykCache({ root: cacheRoot }).read("/repo", SHA)).toEqual(result);
  });

  test("cleans up and preserves an old cache entry when Snyk exits 2", async () => {
    const cacheRoot = await root();
    const cache = new SnykCache({ root: cacheRoot });
    const old: SnykScanResult = {
      sha: SHA,
      scannedAt: "2026-08-20T10:00:00.000Z",
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
      includesDev: true,
      dependencyProjects: [],
    };
    await cache.write("/repo", old);
    const commands: string[][] = [];
    const runner: SnykCommandRunner = async command => {
      commands.push(command);
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") return { stdout: "sensitive raw output", exitCode: 2 };
      return { stdout: "", exitCode: 0 };
    };

    await expect(
      scanSnykCommit({ repoPath: "/repo", sha: SHA, force: true }, { cacheRoot, runCommand: runner }),
    ).rejects.toThrow("Snyk scan failed.");
    expect(commands.some(command => command.slice(0, 4).join(" ") === "git worktree remove --force")).toBe(true);
    expect(await cache.read("/repo", SHA)).toEqual(old);
  });

  test("does not replace a complete cache entry with a partial rescan", async () => {
    const cacheRoot = await root();
    const cache = new SnykCache({ root: cacheRoot });
    const complete: SnykScanResult = {
      sha: SHA,
      scannedAt: "2026-08-20T10:00:00.000Z",
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      includesDev: true,
      dependencyProjects: [],
      findings: [
        {
          id: "SNYK-OLD",
          title: "Old",
          severity: "high",
          dependency: "dep",
          installedVersion: "1.0.0",
          fixedVersion: null,
          fixedIn: [],
          exploit: null,
          cvssScore: null,
          project: "working",
          targetFile: null,
        },
      ],
    };
    await cache.write("/repo", complete);
    const runner: SnykCommandRunner = async command => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") {
        return {
          stdout: JSON.stringify([{ error: "unsupported project" }, { projectName: "working", vulnerabilities: [] }]),
          exitCode: 2,
        };
      }
      return { stdout: "", exitCode: 0 };
    };

    await expect(
      scanSnykCommit({ repoPath: "/repo", sha: SHA, force: true }, { cacheRoot, runCommand: runner }),
    ).rejects.toThrow("Partial scan. Kept last complete snapshot.");
    expect(await cache.read("/repo", SHA)).toEqual(complete);
  });

  test("caches successful projects from partial exit 2 output", async () => {
    const cacheRoot = await root();
    const runner: SnykCommandRunner = async command => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") {
        return {
          stdout: JSON.stringify([
            { error: "unsupported project" },
            {
              projectName: "working",
              vulnerabilities: [{ id: "SNYK-1", severity: "high", packageName: "dep", version: "1.0.0" }],
            },
          ]),
          exitCode: 2,
        };
      }
      return { stdout: "", exitCode: 0 };
    };

    const result = await scanSnykCommit({ repoPath: "/repo", sha: SHA }, { cacheRoot, runCommand: runner });

    expect(result).toMatchObject({ partial: true, failedProjects: 1, counts: { high: 1 } });
    expect(await new SnykCache({ root: cacheRoot }).read("/repo", SHA)).toEqual(result);
  });

  test("converts Bun only in the worktree, scans sequentially with dev dependencies and caches graphs", async () => {
    const f = await dependencyFixture({
      "package.json": '{"packageManager":"bun@1.4.3"}',
      "bun.lock": "committed lockfile",
    });
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => process.execPath },
    );
    expect(result.includesDev).toBe(true);
    expect(result.dependencyProjects).toMatchObject([
      {
        targetFile: "bun.lock",
        packageManager: "bun",
        status: "scanned",
        reason: null,
        graphs: [{ targetFile: "yarn.lock" }],
      },
    ]);
    expect(f.calls.filter(call => call.command[0] !== "git").map(call => call.command)).toEqual([
      ["bun", "install", "--yarn", "--frozen-lockfile", "--ignore-scripts"],
      ["snyk", "test", "--json", "--all-projects", "--dev"],
      ["snyk", "test", "--print-graph", "--all-projects", "--dev"],
    ]);
    expect(f.calls.filter(call => call.command[0] !== "git").every(call => call.cwd === f.worktreePath())).toBe(true);
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toEqual(result);
    await expect(stat(join(f.repoPath, "yarn.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(f.worktreePath())).rejects.toMatchObject({ code: "ENOENT" });

    const callCount = f.calls.length;
    expect(
      await scanSnykCommit({ repoPath: f.repoPath, sha: SHA }, { cacheRoot: f.cacheRoot, runCommand: f.runner }),
    ).toEqual(result);
    expect(f.calls.length).toBe(callCount + 1);
  });

  test("groups pnpm workspace graphs under the committed lockfile without running pnpm", async () => {
    const f = await dependencyFixture({
      "package.json": '{"packageManager":"pnpm@10.0.0"}',
      "pnpm-lock.yaml": "lockfileVersion: 9",
      "pnpm-workspace.yaml": "packages: [packages/*]",
      "packages/a/package.json": "{}",
      "packages/b/package.json": "{}",
    });
    f.output.findings.stdout = JSON.stringify({
      packageManager: "pnpm",
      displayTargetFile: "pnpm-lock.yaml",
      vulnerabilities: [],
    });
    f.output.graph.stdout =
      dependencyGraph("pnpm", "packages/a/package.json") + dependencyGraph("pnpm", "packages/b/package.json");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner },
    );
    expect(result.dependencyProjects).toHaveLength(1);
    expect(result.dependencyProjects[0]).toMatchObject({
      targetFile: "pnpm-lock.yaml",
      packageManager: "pnpm",
      status: "scanned",
    });
    expect(result.dependencyProjects[0].graphs.map(graph => graph.targetFile)).toEqual([
      "packages/a/package.json",
      "packages/b/package.json",
    ]);
    expect(f.calls.filter(call => call.command[0] !== "git").map(call => call.command[0])).toEqual(["snyk", "snyk"]);
  });

  test("scans native Yarn v1 without a local Yarn command", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "yarn.lock": "# yarn lockfile v1\n" });
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => null },
    );
    expect(result.dependencyProjects[0]).toMatchObject({
      targetFile: "yarn.lock",
      packageManager: "yarn",
      status: "scanned",
    });
    expect(f.calls.some(call => call.command[0] === "yarn")).toBe(false);
  });

  test("matches the nearest project, including Yarn 2-4 graphs", async () => {
    const f = await dependencyFixture({
      "package.json": "{}",
      "bun.lock": "lock",
      "a/package.json": "{}",
      "a/yarn.lock": "# yarn lockfile v1\n",
      "modern/package.json": '{"packageManager":"yarn@4.0.0"}',
      "modern/yarn.lock": "__metadata:\n  version: 8\n",
    });
    f.output.graph.stdout =
      dependencyGraph() + dependencyGraph("yarn", "a/yarn.lock") + dependencyGraph("yarn", "modern/yarn.lock");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => process.execPath },
    );
    expect(
      result.dependencyProjects.map(project => [project.targetFile, project.graphs.map(graph => graph.targetFile)]),
    ).toEqual([
      ["bun.lock", ["yarn.lock"]],
      ["a/yarn.lock", ["a/yarn.lock"]],
      ["modern/yarn.lock", ["modern/yarn.lock"]],
    ]);
  });

  test("captures npm graphs from package-lock.json without running npm, with package.json scopes", async () => {
    const f = await dependencyFixture({
      "package.json": '{"devDependencies":{"dep":"1.0.0"}}',
      "package-lock.json": "{}",
    });
    f.output.findings.stdout = JSON.stringify({
      packageManager: "npm",
      displayTargetFile: "package-lock.json",
      vulnerabilities: [],
    });
    f.output.graph.stdout = dependencyGraph("npm", "package-lock.json");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => null },
    );
    expect(result.dependencyProjects).toMatchObject([
      {
        targetFile: "package-lock.json",
        packageManager: "npm",
        status: "scanned",
        graphs: [{ targetFile: "package-lock.json", packageManager: "npm" }],
      },
    ]);
    // Snyk flagged `dep` prod; package.json declares it in devDependencies.
    expect(result.dependencyProjects[0].graphs[0].nodes.find(node => node.nodeId === "dep")?.scope).toBe("dev");
    expect(f.calls.filter(call => call.command[0] !== "git").map(call => call.command[0])).toEqual(["snyk", "snyk"]);
  });

  test("captures Maven graphs per pom.xml by exact path, with scopes from node IDs", async () => {
    const mavenGraph = (target: string, artifact: string) =>
      `DepGraph data:\n${JSON.stringify({
        schemaVersion: "1.3.0",
        pkgManager: { name: "maven" },
        pkgs: [
          { id: `x:${artifact}@1.0`, info: { name: `x:${artifact}`, version: "1.0" } },
          { id: "junit:junit@4.13", info: { name: "junit:junit", version: "4.13" } },
          { id: "x:api@1.0", info: { name: "x:api", version: "1.0" } },
        ],
        graph: {
          rootNodeId: "root-node",
          nodes: [
            {
              nodeId: "root-node",
              pkgId: `x:${artifact}@1.0`,
              deps: [{ nodeId: "junit:junit:jar:4.13:test" }, { nodeId: "x:api:jar:1.0:provided" }],
            },
            { nodeId: "junit:junit:jar:4.13:test", pkgId: "junit:junit@4.13", deps: [] },
            { nodeId: "x:api:jar:1.0:provided", pkgId: "x:api@1.0", deps: [] },
          ],
        },
      })}\nDepGraph target:\n${target}\nDepGraph end\n`;
    const f = await dependencyFixture({ "pom.xml": "<project/>", "core/pom.xml": "<project/>" });
    f.output.findings.stdout = JSON.stringify([
      { packageManager: "maven", displayTargetFile: "pom.xml", vulnerabilities: [] },
      { packageManager: "maven", displayTargetFile: "core/pom.xml", vulnerabilities: [] },
    ]);
    f.output.graph.stdout = mavenGraph("pom.xml", "parent") + mavenGraph("core/pom.xml", "core");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: command => (command.startsWith("mvn") ? command : null) },
    );
    expect(
      result.dependencyProjects.map(project => [
        project.targetFile,
        project.packageManager,
        project.status,
        project.graphs.map(graph => graph.targetFile),
      ]),
    ).toEqual([
      ["core/pom.xml", "maven", "scanned", ["core/pom.xml"]],
      ["pom.xml", "maven", "scanned", ["pom.xml"]],
    ]);
    expect(result.dependencyProjects[0].graphs[0].nodes.map(node => node.scope)).toEqual(["unknown", "dev", "prod"]);
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toEqual(result);
  });

  test("skips Maven projects without mvn or a wrapper; a tracked wrapper is enough", async () => {
    const wrapper = process.platform === "win32" ? "mvnw.cmd" : "mvnw";
    const findings = JSON.stringify({ packageManager: "maven", displayTargetFile: "pom.xml", vulnerabilities: [] });
    const bare = await dependencyFixture({ "pom.xml": "<project/>" });
    bare.output.findings.stdout = findings;
    const skipped = await scanSnykCommit(
      { repoPath: bare.repoPath, sha: SHA },
      { cacheRoot: bare.cacheRoot, runCommand: bare.runner, which: () => null },
    );
    expect(skipped.dependencyProjects).toEqual([
      {
        targetFile: "pom.xml",
        packageManager: "maven",
        status: "skipped",
        graphs: [],
        reason: "Maven not found on PATH. Install Maven or commit the Maven Wrapper (mvnw) to scan pom.xml.",
      },
    ]);
    expect(bare.calls.some(call => call.command.includes("--print-graph"))).toBe(false);

    const wrapped = await dependencyFixture({ "pom.xml": "<project/>", [wrapper]: "" });
    wrapped.output.findings.stdout = findings;
    wrapped.output.graph.stdout = "";
    const failed = await scanSnykCommit(
      { repoPath: wrapped.repoPath, sha: SHA },
      { cacheRoot: wrapped.cacheRoot, runCommand: wrapped.runner, which: () => null },
    );
    expect(wrapped.calls.some(call => call.command.includes("--print-graph"))).toBe(true);
    expect(failed.dependencyProjects[0]).toMatchObject({ status: "failed", graphs: [] });
  });

  test("a pom.xml without a graph names Java and Maven, and never claims a JavaScript graph", async () => {
    const f = await dependencyFixture({ "pom.xml": "<project/>", "web/package.json": "{}", "web/yarn.lock": "" });
    f.output.graph.stdout = dependencyGraph("yarn", "web/yarn.lock");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => "mvn" },
    );
    expect(result.dependencyProjects).toMatchObject([
      { targetFile: "web/yarn.lock", status: "scanned", graphs: [{ targetFile: "web/yarn.lock" }] },
      {
        targetFile: "pom.xml",
        status: "failed",
        graphs: [],
        reason:
          "Snyk returned no dependency graph for this pom.xml. Check that Java and Maven can resolve its dependencies, then rescan.",
      },
    ]);
  });

  test("keeps existing vulnerability-only scans for unsupported dependency managers", async () => {
    const f = await dependencyFixture({ Gemfile: "", "Gemfile.lock": "" });
    f.output.findings.stdout = JSON.stringify({
      packageManager: "rubygems",
      displayTargetFile: "Gemfile.lock",
      vulnerabilities: [],
    });
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner },
    );
    expect(result.dependencyProjects).toEqual([]);
    expect(f.calls.filter(call => call.command[0] === "snyk")).toHaveLength(1);
  });

  test("missing Bun reports an actionable error instead of accepting npm fallback as a clean scan", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "bun.lock": "lock" });
    f.output.findings.stdout = JSON.stringify({
      packageManager: "npm",
      displayTargetFile: "package.json",
      vulnerabilities: [],
    });
    await expect(
      scanSnykCommit(
        { repoPath: f.repoPath, sha: SHA },
        { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => null },
      ),
    ).rejects.toThrow("Bun not found on PATH. Install Bun to scan bun.lock.");
    expect(f.calls.some(call => call.command[0] === "bun" || call.command.includes("--print-graph"))).toBe(false);
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toBeNull();
    await expect(stat(f.worktreePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("retains successful projects when a Bun project is skipped", async () => {
    const f = await dependencyFixture({
      "package.json": "{}",
      "bun.lock": "lock",
      "a/package.json": "{}",
      "a/pnpm-lock.yaml": "lockfileVersion: 9",
    });
    f.output.findings.stdout = JSON.stringify([
      { packageManager: "npm", displayTargetFile: "package.json", vulnerabilities: [] },
      {
        packageManager: "pnpm",
        displayTargetFile: "a/pnpm-lock.yaml",
        vulnerabilities: [{ id: "SNYK-FIXTURE", severity: "high", name: "dep", version: "1.0.0" }],
      },
    ]);
    f.output.findings.exitCode = 1;
    f.output.graph.stdout = dependencyGraph("pnpm", "a/package.json");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => null },
    );
    expect(result).toMatchObject({ partial: true, failedProjects: 1, counts: { high: 1 } });
    expect(result.dependencyProjects).toMatchObject([
      {
        targetFile: "bun.lock",
        status: "skipped",
        graphs: [],
        reason: "Bun not found on PATH. Install Bun to scan bun.lock.",
      },
      { targetFile: "a/pnpm-lock.yaml", status: "scanned", graphs: [{ targetFile: "a/package.json" }] },
    ]);
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toEqual(result);
  });

  test("skipped Bun cannot swallow an independent npm shrinkwrap project's findings", async () => {
    const f = await dependencyFixture({
      "package.json": "{}",
      "bun.lock": "lock",
      "app/package.json": "{}",
      "app/npm-shrinkwrap.json": "{}",
    });
    f.output.findings.stdout = JSON.stringify([
      { displayTargetFile: "package.json", vulnerabilities: [] },
      {
        packageManager: "npm",
        displayTargetFile: "app/package.json",
        vulnerabilities: [{ id: "SNYK-FIXTURE", severity: "high", name: "dep", version: "1.0.0" }],
      },
    ]);
    f.output.graph.stdout = dependencyGraph("npm", "app/npm-shrinkwrap.json");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => null },
    );
    expect(result).toMatchObject({ partial: true, failedProjects: 1, counts: { high: 1 } });
    expect(result.findings[0].targetFile).toBe("app/package.json");
    // The shrinkwrap project is an npm graph project of its own; the skipped Bun one keeps its reason.
    expect(result.dependencyProjects).toMatchObject([
      { targetFile: "bun.lock", status: "skipped" },
      { targetFile: "app/npm-shrinkwrap.json", packageManager: "npm", status: "scanned" },
    ]);
  });

  test("a broken nested manifest does not discard findings or graphs from a valid project", async () => {
    const f = await dependencyFixture({
      "package.json": "{}",
      "bun.lock": "lock",
      "broken/package.json": "invalid JSON",
      "broken/yarn.lock": "# yarn lockfile v1\n",
    });
    f.output.findings = {
      stdout: JSON.stringify([
        { displayTargetFile: "yarn.lock", vulnerabilities: [] },
        { displayTargetFile: "broken/yarn.lock", error: "Fixture project failed" },
      ]),
      exitCode: 2,
    };
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => process.execPath },
    );
    expect(result).toMatchObject({ partial: true, failedProjects: 1 });
    expect(result.dependencyProjects).toMatchObject([
      { targetFile: "bun.lock", status: "scanned", graphs: [{ targetFile: "yarn.lock" }] },
      { targetFile: "broken/yarn.lock", status: "failed", graphs: [] },
    ]);
    expect(result.dependencyProjects[1].reason).toContain("readable regular files without symlinks");
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toEqual(result);
  });

  test("Bun conversion failure never caches a fallback project result", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "bun.lock": "lock" });
    f.output.bun.exitCode = 1;
    await expect(
      scanSnykCommit(
        { repoPath: f.repoPath, sha: SHA },
        { cacheRoot: f.cacheRoot, runCommand: f.runner, which: () => process.execPath },
      ),
    ).rejects.toThrow("Bun lockfile conversion failed.");
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toBeNull();
  });

  test("rejects Bun conversions that change the committed lockfile", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "bun.lock": "lock" });
    const runner: SnykCommandRunner = async (command, options) => {
      const output = await f.runner(command, options);
      if (command[0] === "bun") await writeFile(join(options.cwd, "bun.lock"), "changed");
      return output;
    };
    await expect(
      scanSnykCommit(
        { repoPath: f.repoPath, sha: SHA },
        { cacheRoot: f.cacheRoot, runCommand: runner, which: () => process.execPath },
      ),
    ).rejects.toThrow("Bun conversion changed bun.lock.");
  });

  test("graph format failures keep valid findings and record failed dependency coverage", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "yarn.lock": "# yarn lockfile v1\n" });
    f.output.graph.stdout = "unexpected graph format";
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner },
    );
    expect(result.partial).toBeUndefined();
    expect(result.dependencyProjects[0]).toMatchObject({
      status: "failed",
      graphs: [],
      reason: "Unsupported Snyk CLI output.",
    });
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toEqual(result);
  });

  test("projects Snyk reports only on graph-run stderr make the scan partial and are named", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "yarn.lock": "# yarn lockfile v1\n" });
    const runner: SnykCommandRunner = async (command, options) => {
      const output = await f.runner(command, options);
      if (!command.includes("--print-graph")) return output;
      const manifest = join(await realpath(options.cwd), "vendor", "lib", "package.json");
      return {
        ...output,
        stderr: `${manifest}:\n  Missing node_modules folder: we can't test without dependencies.\nPlease run 'npm install' first.\n✗ 1/2 potential projects failed to get dependencies.\n`,
      };
    };
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: runner },
    );
    expect(result).toMatchObject({ partial: true, failedProjects: 1, failedTargets: ["vendor/lib/package.json"] });
    expect(result.dependencyProjects[0]).toMatchObject({ status: "scanned" });
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toEqual(result);
  });

  test("graph-run failures add to findings failures without counting them twice", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "yarn.lock": "# yarn lockfile v1\n" });
    f.output.findings = {
      stdout: JSON.stringify([
        { error: "Could not resolve dependencies." },
        { packageManager: "yarn", displayTargetFile: "yarn.lock", vulnerabilities: [] },
      ]),
      exitCode: 2,
    };
    f.output.graph.stderr = "✗ 2/3 potential projects failed to get dependencies.\n";
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner },
    );
    expect(result).toMatchObject({ partial: true, failedProjects: 2 });
    expect(result.failedTargets).toBeUndefined();
  });

  test("graph exit 2 retains returned graphs but never labels their coverage complete", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "yarn.lock": "# yarn lockfile v1\n" });
    f.output.graph.exitCode = 2;
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner },
    );
    expect(result.dependencyProjects[0]).toMatchObject({
      status: "failed",
      reason: "Snyk dependency graph scan was incomplete. Returned graphs are partial results.",
    });
    expect(result.dependencyProjects[0].graphs).toHaveLength(1);
  });

  test("a missing graph is a failure, not an empty successful tree", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "yarn.lock": "# yarn lockfile v1\n" });
    f.output.graph.stdout = dependencyGraph("pnpm", "package.json");
    const result = await scanSnykCommit(
      { repoPath: f.repoPath, sha: SHA },
      { cacheRoot: f.cacheRoot, runCommand: f.runner },
    );
    expect(result.dependencyProjects[0]).toMatchObject({
      status: "failed",
      graphs: [],
      reason: "Snyk returned no dependency graph for this project.",
    });
  });

  test("cancellation during Bun conversion prevents Snyk and cache writes", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "bun.lock": "lock" });
    const controller = new AbortController();
    const runner: SnykCommandRunner = async (command, options) => {
      const output = await f.runner(command, options);
      if (command[0] === "bun") controller.abort();
      return output;
    };
    await expect(
      scanSnykCommit(
        { repoPath: f.repoPath, sha: SHA, signal: controller.signal },
        { cacheRoot: f.cacheRoot, runCommand: runner, which: () => process.execPath },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(f.calls.some(call => call.command[0] === "snyk")).toBe(false);
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toBeNull();
    await expect(stat(f.worktreePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cancellation during graph scanning prevents partial cache writes", async () => {
    const f = await dependencyFixture({ "package.json": "{}", "yarn.lock": "# yarn lockfile v1\n" });
    const controller = new AbortController();
    const runner: SnykCommandRunner = async (command, options) => {
      const output = await f.runner(command, options);
      if (command.includes("--print-graph")) controller.abort();
      return output;
    };
    await expect(
      scanSnykCommit(
        { repoPath: f.repoPath, sha: SHA, signal: controller.signal },
        { cacheRoot: f.cacheRoot, runCommand: runner },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await new SnykCache({ root: f.cacheRoot }).read(f.repoPath, SHA)).toBeNull();
    await expect(stat(f.worktreePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("passes shell metacharacters as literal Snyk arguments", async () => {
    const testRoot = await root();
    const env = await fakeSnyk(
      join(testRoot, "bin & space %PATH%"),
      "console.log(JSON.stringify(process.argv.slice(2)));process.exit(3);",
      true,
    );
    const args = ["test", "space value", "a&b", "%PATH%", "$(echo injected)", 'a"quote', "a'b", "end\\"];
    const result = await runSnykCommand(["snyk", ...args], { cwd: testRoot, env });
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(result.exitCode).toBe(3);
  });

  test("resolves a Yarn-global Snyk package without passing arguments through cmd.exe", async () => {
    const testRoot = await root();
    const bin = join(testRoot, "Yarn", "bin");
    const env = await fakeSnyk(bin, "console.log(JSON.stringify(process.argv.slice(2)));process.exit(1);");
    const globalPackage = join(bin, "..", "Data", "global", "node_modules", "snyk");
    await mkdir(dirname(globalPackage), { recursive: true });
    await rename(join(bin, "node_modules", "snyk"), globalPackage);
    env.FAKE_SNYK_ENTRY = join(globalPackage, "cli.js");
    const result = await runSnykCommand(["snyk", "test", "space & literal", "%PATH%"], { cwd: testRoot, env });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual(["test", "space & literal", "%PATH%"]);
  });

  test("missing Snyk CLI reports an actionable installation error", async () => {
    const testRoot = await root();
    await expect(
      runSnykCommand(["snyk", "test"], { cwd: testRoot, env: { ...process.env, PATH: "" } }),
    ).rejects.toThrow("Snyk CLI not found on PATH. Install Snyk CLI to scan.");
  });

  test("pre-abort never starts Snyk", async () => {
    const testRoot = await root();
    const capture = join(testRoot, "started");
    const env = await fakeSnyk(
      join(testRoot, "bin"),
      `require("node:fs").writeFileSync(${JSON.stringify(capture)}, "started");`,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSnykCommand(["snyk", "test"], { cwd: testRoot, env, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(capture)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cleans the worktree after a command startup error", async () => {
    const testRoot = await root();
    let worktreePath = "";
    let removed = false;
    const runner: SnykCommandRunner = async (command, options) => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") {
        return runSnykCommand([join(testRoot, "missing-executable")], options);
      }
      if (command[2] === "add") {
        worktreePath = command[4] ?? "";
        await mkdir(worktreePath);
      } else if (command[2] === "remove") {
        removed = true;
      }
      return { stdout: "", exitCode: 0 };
    };
    await expect(
      scanSnykCommit({ repoPath: testRoot, sha: SHA }, { cacheRoot: join(testRoot, "cache"), runCommand: runner }),
    ).rejects.toThrow();
    expect(removed).toBe(true);
    await expect(readFile(worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("awaits cancellation of a Bun parent and descendant before worktree removal", async () => {
    const testRoot = await root();
    const ready = join(testRoot, "ready");
    const heartbeat = join(testRoot, "heartbeat");
    const descendantPath = join(testRoot, "descendant.js");
    await writeFile(
      descendantPath,
      `
const { writeFileSync, renameSync, existsSync } = require("node:fs");
process.on("SIGTERM", () => {});
const publish = (path, text) => {
  writeFileSync(path + ".tmp", text);
  renameSync(path + ".tmp", path);
};
publish(process.env.FAKE_READY, JSON.stringify({ pid: process.pid, parentPid: process.ppid }));
setInterval(() => publish(process.env.FAKE_HEARTBEAT, String(Date.now()) + ":" + existsSync(process.cwd())), 10);
`,
    );
    const env = await fakeSnyk(
      join(testRoot, "bin"),
      `
const child = Bun.spawn([process.env.FAKE_SNYK_BUN, ${JSON.stringify(descendantPath)}], { stdout: "ignore", stderr: "ignore" });
setInterval(() => {}, 1000);
`,
    );
    env.FAKE_READY = ready;
    env.FAKE_HEARTBEAT = heartbeat;
    const controller = new AbortController();
    let parentPid: number | undefined;
    let descendantPid: number | undefined;
    let worktreePath = "";
    let cleanupHeartbeat: { before: string; after: string } | undefined;
    let finished = false;
    const runner: SnykCommandRunner = async (command, options) => {
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[1] === "worktree" && command[2] === "add") {
        worktreePath = command[4] ?? "";
        await mkdir(worktreePath);
        return { stdout: "", exitCode: 0 };
      }
      if (command[1] === "ls-files") return { stdout: "", exitCode: 0 };
      if (command[0] === "snyk") {
        return runSnykCommand(command, { ...options, env });
      }
      // The runner must finish tree cleanup before scanSnykCommit reaches here.
      const before = await readFile(heartbeat, "utf8");
      await Bun.sleep(100);
      cleanupHeartbeat = { before, after: await readFile(heartbeat, "utf8") };
      return { stdout: "", exitCode: 0 };
    };
    const scan = scanSnykCommit(
      { repoPath: testRoot, sha: SHA, signal: controller.signal },
      { cacheRoot: join(testRoot, "cache"), runCommand: runner },
    );
    const outcome = scan.then(
      () => null,
      error => error,
    );
    try {
      const pids = JSON.parse(await waitForFile(ready));
      descendantPid = pids.pid;
      parentPid = pids.parentPid;
      await waitForFile(heartbeat);
      controller.abort();
      expect(await outcome).toMatchObject({ name: "AbortError" });
      expect(cleanupHeartbeat).toBeDefined();
      expect(cleanupHeartbeat?.after).toBe(cleanupHeartbeat?.before);
      expect(cleanupHeartbeat?.before.endsWith(":true")).toBe(true);
      if (!parentPid) throw new Error("Fixture did not report its parent PID.");
      const stoppedParentPid = parentPid;
      expect(() => process.kill(stoppedParentPid, 0)).toThrow();
      await expect(readFile(worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
      finished = true;
    } finally {
      controller.abort();
      await scan.catch(() => {});
      // Also stop the fixture if an assertion failed before cancellation completed.
      if (!finished && parentPid) await killSnykProcessGroup(parentPid, "SIGKILL");
      if (!finished && descendantPid) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {}
      }
    }
  }, 15000);

  test("aborts an active scan and still removes the worktree", async () => {
    const cacheRoot = await root();
    const controller = new AbortController();
    const commands: string[][] = [];
    const runner: SnykCommandRunner = async command => {
      commands.push(command);
      if (command[1] === "rev-parse") return { stdout: SHA, exitCode: 0 };
      if (command[0] === "snyk") controller.abort();
      return { stdout: "{}", exitCode: 0 };
    };

    await expect(
      scanSnykCommit({ repoPath: "/repo", sha: SHA, signal: controller.signal }, { cacheRoot, runCommand: runner }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(commands.some(command => command.slice(0, 4).join(" ") === "git worktree remove --force")).toBe(true);
  });

  test("removes only scan worktrees whose codepulse process is gone", async () => {
    const testRoot = await root();
    const repoPath = join(testRoot, "repo");
    await mkdir(repoPath);
    await runLocal(["git", "init"], repoPath);
    await runLocal(
      ["git", "-c", "user.name=T", "-c", "user.email=t@example.test", "commit", "--allow-empty", "-m", "i"],
      repoPath,
    );
    const exited = Bun.spawn(["git", "--version"], { stdout: "ignore" });
    await exited.exited;
    const orphan = join(testRoot, `codepulse-snyk-${exited.pid}-old`, "worktree");
    const live = join(testRoot, `codepulse-snyk-${process.ppid}-now`, "worktree");
    const user = join(testRoot, "user-worktree");
    for (const path of [orphan, live, user]) await runLocal(["git", "worktree", "add", "--detach", path], repoPath);

    await removeOrphanedScanWorktrees(repoPath);

    const listed = await runLocal(["git", "worktree", "list", "--porcelain"], repoPath);
    expect(listed).not.toContain(`codepulse-snyk-${exited.pid}-old`);
    expect(listed).toContain(`codepulse-snyk-${process.ppid}-now`);
    expect(listed).toContain("user-worktree");
    await expect(stat(dirname(orphan))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(live)).isDirectory()).toBe(true);
  });
});

test("direct dependency scopes come from package.json, falling back to Snyk's flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-manifest-"));
  try {
    const graph = (packageManager: string): SnykDependencyGraph => ({
      targetFile: "web/package.json",
      packageManager,
      rootNodeId: "root",
      packages: ["app", "core", "tooling", "peer", "unlisted"].map(name => ({ id: name, name, version: "1.0.0" })),
      nodes: [
        {
          nodeId: "root",
          pkgId: "app",
          deps: ["core", "tooling", "peer", "unlisted"],
          scope: "unknown",
          referenceNodeId: null,
        },
        { nodeId: "core", pkgId: "core", deps: ["deep"], scope: "dev", referenceNodeId: null },
        { nodeId: "tooling", pkgId: "tooling", deps: [], scope: "prod", referenceNodeId: null },
        { nodeId: "peer", pkgId: "peer", deps: [], scope: "dev", referenceNodeId: null },
        { nodeId: "unlisted", pkgId: "unlisted", deps: [], scope: "dev", referenceNodeId: null },
        { nodeId: "deep", pkgId: "core", deps: [], scope: "dev", referenceNodeId: null },
      ],
    });
    const scopes = (input: SnykDependencyGraph) => input.nodes.map(node => node.scope);
    // No manifest: Snyk's flags stay.
    const missing = graph("pnpm");
    await applyManifestScopes(missing, root);
    expect(scopes(missing)).toEqual(scopes(graph("pnpm")));
    await mkdir(join(root, "web"));
    await writeFile(
      join(root, "web/package.json"),
      JSON.stringify({
        dependencies: { core: "1" },
        devDependencies: { core: "1", tooling: "1" },
        peerDependencies: { peer: "1" },
      }),
    );
    const fixed = graph("pnpm");
    await applyManifestScopes(fixed, root);
    // Direct only: prod wins over dev; unlisted and nested nodes keep Snyk's flags.
    expect(scopes(fixed)).toEqual(["unknown", "prod", "dev", "prod", "dev", "dev"]);
    const maven = graph("maven");
    await applyManifestScopes(maven, root);
    expect(scopes(maven)).toEqual(scopes(graph("maven")));
    await writeFile(join(root, "web/package.json"), "{ invalid");
    const invalid = graph("yarn");
    await applyManifestScopes(invalid, root);
    expect(scopes(invalid)).toEqual(scopes(graph("yarn")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("parseSnykProjectFailures", () => {
  test("counts Snyk's summary and names manifests below either worktree spelling", () => {
    const stderr = [
      "/private/var/scan/worktree/vendor/lib/package.json:",
      "  Missing node_modules folder: we can't test without dependencies.",
      "/var/scan/worktree/tools/pom.xml:",
      "  Could not resolve dependencies.",
      "/elsewhere/package.json:",
      "✗ 3/6 potential projects failed to get dependencies.",
    ].join("\n");
    expect(parseSnykProjectFailures(stderr, ["/var/scan/worktree", "/private/var/scan/worktree"])).toEqual({
      count: 3,
      targets: ["tools/pom.xml", "vendor/lib/package.json"],
    });
  });

  test("ignores stderr without Snyk's failure summary", () => {
    expect(parseSnykProjectFailures("/repo/package.json:\n  warning\n", ["/repo"])).toEqual({ count: 0, targets: [] });
    expect(parseSnykProjectFailures("", ["/repo"])).toEqual({ count: 0, targets: [] });
  });
});
